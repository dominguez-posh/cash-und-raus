// Lokale Konten (Plattform-Admin, Notfallzugang): Passwort, danach zwingend TOTP oder Passkey.
// Ohne hinterlegten Faktor muss er direkt nach dem Passwort eingerichtet werden.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LokalesKonto } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { plattformDb } from '../db/index.ts';
import { clientIp } from '../ip.ts';
import { plattformProtokollieren } from '../mandant.ts';
import {
  anmelden,
  angemeldet,
  HttpFehler,
  type Kontext,
  mfaAbschliessen,
  mitSitzung,
  plattform,
  sitzungAendern,
  sitzungenBeenden,
} from '../sitzung.ts';
import { Bremse, DUMMY_HASH, passwortHash, passwortProblem, passwortPruefen } from './passwort.ts';
import { newRecoveryCodes, newTotpSecret, otpauthUri, recoveryHash, verifyTotp } from './totp.ts';
import {
  type AssertionJson,
  newChallenge,
  type RegistrationJson,
  relyingParty,
  type StoredPasskey,
  verifyAssertion,
  verifyRegistration,
} from './webauthn.ts';

const bremse = new Bremse();
const jetzt = () => new Date().toISOString();

type KontoZeile = Awaited<ReturnType<typeof kontoLesen>>;

async function kontoLesen(benutzername: string) {
  return plattformDb().selectFrom('lokales_konto').selectAll().where('benutzername', '=', benutzername).executeTakeFirst();
}

async function kontoAus(k: Kontext) {
  const konto = await kontoLesen(k.sitzung.email);
  if (!konto) throw new HttpFehler(401, 'Konto nicht gefunden');
  return konto;
}

const passkeysAus = (k: NonNullable<KontoZeile>) => JSON.parse(k.passkeys) as StoredPasskey[];
const hatFaktor = (k: NonNullable<KontoZeile>) => Boolean(k.totp_secret) || passkeysAus(k).length > 0;

function kontoInfo(k: NonNullable<KontoZeile>): LokalesKonto {
  return {
    benutzername: k.benutzername,
    name: k.name,
    aktiv: k.aktiv === 1,
    totp: Boolean(k.totp_secret),
    passkeys: passkeysAus(k).map((p) => ({ id: p.id, name: p.name, erstelltAm: p.createdAt, zuletztAm: p.lastUsedAt })),
    recoveryUebrig: (JSON.parse(k.recovery_hashes) as string[]).length,
    letzteAnmeldung: k.letzte_anmeldung,
  };
}

// Challenges (TOTP-Secret in Einrichtung, WebAuthn) liegen 5 Minuten in der Sitzung.
async function challengeSetzen(k: Kontext, typ: string, wert: string): Promise<void> {
  await sitzungAendern(k.sitzung.id, { challenge: `${typ}:${wert}`, challenge_bis: new Date(Date.now() + 5 * 60_000).toISOString() });
}

async function challengeHolen(k: Kontext, typ: string): Promise<string> {
  const c = k.sitzung.challenge;
  await sitzungAendern(k.sitzung.id, { challenge: null, challenge_bis: null });
  if (!c?.startsWith(`${typ}:`) || !k.sitzung.challenge_bis || k.sitzung.challenge_bis < jetzt()) {
    throw new HttpFehler(400, 'Vorgang abgelaufen, bitte neu beginnen.');
  }
  return c.slice(typ.length + 1);
}

/**
 * Einrichten eines Faktors ist erlaubt: direkt nach dem Passwort, solange noch keiner existiert,
 * oder in einer vollständig angemeldeten Sitzung (weiteren Faktor hinzufügen).
 */
async function einrichtenErlaubt(req: FastifyRequest) {
  const k = mitSitzung(req);
  if (k.sitzung.art !== 'lokal') throw new HttpFehler(403, 'Nur für lokale Konten');
  const konto = await kontoAus(k);
  if (k.mfaOffen && hatFaktor(konto)) throw new HttpFehler(403, 'Bitte zuerst mit dem vorhandenen Faktor anmelden.');
  return { k, konto };
}

/** Nach dem Passwort, Faktor vorhanden: Prüfschritt. */
async function pruefenErlaubt(req: FastifyRequest) {
  const k = mitSitzung(req);
  if (!k.mfaOffen) throw new HttpFehler(400, 'Bereits angemeldet');
  const ip = clientIp(req);
  const warten = bremse.gesperrt(ip);
  if (warten) throw new HttpFehler(429, `Zu viele Fehlversuche. Bitte ${warten} s warten.`);
  return { k, konto: await kontoAus(k), ip };
}

/** Beim ersten Faktor eines Kontos entstehen die Wiederherstellungscodes (nur einmal angezeigt). */
async function ersterFaktor(konto: NonNullable<KontoZeile>): Promise<string[] | null> {
  if ((JSON.parse(konto.recovery_hashes) as string[]).length) return null;
  const { codes, hashes } = newRecoveryCodes();
  await plattformDb().updateTable('lokales_konto').set({ recovery_hashes: JSON.stringify(hashes) }).where('benutzername', '=', konto.benutzername).execute();
  return codes;
}

async function anmeldungAbschliessen(k: Kontext, konto: NonNullable<KontoZeile>, wie: string): Promise<void> {
  await mfaAbschliessen(k);
  await plattformDb().updateTable('lokales_konto').set({ letzte_anmeldung: jetzt() }).where('benutzername', '=', konto.benutzername).execute();
  await plattformProtokollieren(konto.benutzername, 'Anmeldung lokal', konto.benutzername, { zweiterFaktor: wie });
}

/** Legt beim Start das erste lokale Konto aus CR_ADMIN_USER / CR_ADMIN_PASSWORD an, solange es keines gibt. */
export async function startAdminAnlegen(log: (msg: string) => void): Promise<void> {
  const p = plattformDb();
  const vorhanden = await p.selectFrom('lokales_konto').select('benutzername').limit(1).executeTakeFirst();
  if (vorhanden) return;
  const { benutzername, passwort } = config.startAdmin;
  if (!benutzername || !passwort) {
    log('Kein lokales Konto vorhanden: CR_ADMIN_USER und CR_ADMIN_PASSWORD setzen, um das erste Admin-Konto anzulegen.');
    return;
  }
  const problem = passwortProblem(passwort);
  if (problem) {
    log(`CR_ADMIN_PASSWORD ungeeignet: ${problem}`);
    return;
  }
  await p
    .insertInto('lokales_konto')
    .values({ benutzername, name: benutzername, passwort_hash: passwortHash(passwort), erstellt_am: jetzt(), aktiv: 1, totp_zaehler: -1, recovery_hashes: '[]', passkeys: '[]', totp_secret: null, letzte_anmeldung: null })
    .execute();
  await plattformProtokollieren('System', 'Lokales Konto angelegt', benutzername, 'aus CR_ADMIN_USER');
  log(`Lokales Admin-Konto „${benutzername}“ angelegt. Beim ersten Login wird TOTP oder Passkey eingerichtet.`);
}

const AnmeldeDaten = z.object({ benutzername: z.string().min(1).max(100), passwort: z.string().min(1).max(256) });
const Code = z.object({ code: z.string().min(1).max(20) });

export function lokaleRouten(app: FastifyInstance): void {
  app.post('/api/auth/lokal', async (req, reply) => {
    const ip = clientIp(req);
    const warten = bremse.gesperrt(ip);
    if (warten) throw new HttpFehler(429, `Zu viele Fehlversuche. Bitte ${warten} s warten.`);
    const d = AnmeldeDaten.parse(req.body);
    const konto = await kontoLesen(d.benutzername.trim());
    const ok = passwortPruefen(d.passwort, konto?.passwort_hash ?? DUMMY_HASH);
    if (!konto || !ok || konto.aktiv !== 1) {
      bremse.fehlschlag(ip);
      await plattformProtokollieren(d.benutzername.slice(0, 100), 'Anmeldung fehlgeschlagen', 'lokal', { ip });
      throw new HttpFehler(401, 'Benutzername oder Passwort falsch.');
    }
    bremse.erfolg(ip);
    await anmelden(req, reply, {
      art: 'lokal',
      email: konto.benutzername,
      name: konto.name,
      plattformAdmin: true,
      mfaOffen: true,
      mandantId: null,
      benutzerId: null,
    });
    return { ok: true };
  });

  // ---------- TOTP ----------

  app.post('/api/auth/mfa/totp/einrichten', async (req) => {
    const { k, konto } = await einrichtenErlaubt(req);
    const secret = newTotpSecret();
    await challengeSetzen(k, 'totp', secret);
    return { secret, uri: otpauthUri(secret, config.produktName, konto.benutzername) };
  });

  app.post('/api/auth/mfa/totp/bestaetigen', async (req) => {
    const { k, konto } = await einrichtenErlaubt(req);
    const { code } = Code.parse(req.body);
    const secret = await challengeHolen(k, 'totp');
    const zaehler = verifyTotp(secret, code);
    if (zaehler === null) throw new HttpFehler(400, 'Code falsch. Bitte die Einrichtung neu starten.');
    await plattformDb().updateTable('lokales_konto').set({ totp_secret: secret, totp_zaehler: zaehler }).where('benutzername', '=', konto.benutzername).execute();
    await plattformProtokollieren(konto.benutzername, 'TOTP eingerichtet', konto.benutzername);
    const recoveryCodes = await ersterFaktor(konto);
    if (k.mfaOffen) await anmeldungAbschliessen(k, konto, 'TOTP (neu eingerichtet)');
    return { recoveryCodes };
  });

  app.post('/api/auth/mfa/totp', async (req) => {
    const { k, konto, ip } = await pruefenErlaubt(req);
    const { code } = Code.parse(req.body);
    const zaehler = konto.totp_secret ? verifyTotp(konto.totp_secret, code, konto.totp_zaehler) : null;
    if (zaehler === null) {
      bremse.fehlschlag(ip);
      throw new HttpFehler(401, 'Code falsch oder bereits verwendet.');
    }
    bremse.erfolg(ip);
    await plattformDb().updateTable('lokales_konto').set({ totp_zaehler: zaehler }).where('benutzername', '=', konto.benutzername).execute();
    await anmeldungAbschliessen(k, konto, 'TOTP');
    return { ok: true };
  });

  app.post('/api/auth/mfa/recovery', async (req) => {
    const { k, konto, ip } = await pruefenErlaubt(req);
    const { code } = Code.parse(req.body);
    const hashes = JSON.parse(konto.recovery_hashes) as string[];
    const h = recoveryHash(code);
    if (!hashes.includes(h)) {
      bremse.fehlschlag(ip);
      throw new HttpFehler(401, 'Wiederherstellungscode ungültig.');
    }
    bremse.erfolg(ip);
    await plattformDb()
      .updateTable('lokales_konto')
      .set({ recovery_hashes: JSON.stringify(hashes.filter((x) => x !== h)) })
      .where('benutzername', '=', konto.benutzername)
      .execute();
    await anmeldungAbschliessen(k, konto, 'Wiederherstellungscode');
    return { uebrig: hashes.length - 1 };
  });

  // ---------- Passkey ----------

  app.post('/api/auth/mfa/passkey/registrieren/optionen', async (req) => {
    const { k, konto } = await einrichtenErlaubt(req);
    const challenge = newChallenge();
    await challengeSetzen(k, 'reg', challenge);
    const { rpId } = relyingParty(req.headers.host, config.publicUrl);
    return {
      challenge,
      rp: { id: rpId, name: config.produktName },
      user: { id: Buffer.from(konto.benutzername).toString('base64url'), name: konto.benutzername, displayName: konto.name },
      excludeCredentials: passkeysAus(konto).map((p) => ({ id: p.id, type: 'public-key', transports: p.transports })),
    };
  });

  app.post('/api/auth/mfa/passkey/registrieren', async (req) => {
    const { k, konto } = await einrichtenErlaubt(req);
    const body = z.object({ credential: z.unknown(), name: z.string().max(60).optional() }).parse(req.body);
    const challenge = await challengeHolen(k, 'reg');
    const rp = relyingParty(req.headers.host, config.publicUrl);
    let neu: Omit<StoredPasskey, 'name' | 'createdAt'>;
    try {
      neu = verifyRegistration(body.credential as RegistrationJson, { challenge, ...rp });
    } catch (e) {
      throw new HttpFehler(400, (e as Error).message);
    }
    const liste = passkeysAus(konto).filter((p) => p.id !== neu.id);
    liste.push({ ...neu, name: body.name?.trim() || `Passkey ${liste.length + 1}`, createdAt: jetzt() });
    await plattformDb().updateTable('lokales_konto').set({ passkeys: JSON.stringify(liste) }).where('benutzername', '=', konto.benutzername).execute();
    await plattformProtokollieren(konto.benutzername, 'Passkey eingerichtet', konto.benutzername, { name: liste.at(-1)!.name });
    const recoveryCodes = await ersterFaktor(konto);
    if (k.mfaOffen) await anmeldungAbschliessen(k, konto, 'Passkey (neu eingerichtet)');
    return { recoveryCodes };
  });

  app.post('/api/auth/mfa/passkey/optionen', async (req) => {
    const { k, konto } = await pruefenErlaubt(req);
    const challenge = newChallenge();
    await challengeSetzen(k, 'auth', challenge);
    const { rpId } = relyingParty(req.headers.host, config.publicUrl);
    return {
      challenge,
      rpId,
      allowCredentials: passkeysAus(konto).map((p) => ({ id: p.id, type: 'public-key', transports: p.transports })),
    };
  });

  app.post('/api/auth/mfa/passkey', async (req) => {
    const { k, konto, ip } = await pruefenErlaubt(req);
    const body = z.object({ credential: z.unknown() }).parse(req.body);
    const cred = body.credential as AssertionJson;
    const challenge = await challengeHolen(k, 'auth');
    const liste = passkeysAus(konto);
    const key = liste.find((p) => p.id === cred?.id || p.id === cred?.rawId);
    try {
      if (!key) throw new Error('Unbekannter Passkey');
      const r = verifyAssertion(cred, key, { challenge, ...relyingParty(req.headers.host, config.publicUrl) });
      key.counter = r.counter;
      key.lastUsedAt = jetzt();
    } catch (e) {
      bremse.fehlschlag(ip);
      throw new HttpFehler(401, (e as Error).message);
    }
    bremse.erfolg(ip);
    await plattformDb().updateTable('lokales_konto').set({ passkeys: JSON.stringify(liste) }).where('benutzername', '=', konto.benutzername).execute();
    await anmeldungAbschliessen(k, konto, `Passkey ${key.name}`);
    return { ok: true };
  });

  // ---------- eigenes Konto ----------

  app.get('/api/konto', async (req) => {
    const k = angemeldet(req);
    if (k.sitzung.art !== 'lokal') throw new HttpFehler(404, 'Kein lokales Konto');
    return kontoInfo(await kontoAus(k));
  });

  app.post('/api/konto/passwort', async (req) => {
    const k = angemeldet(req);
    if (k.sitzung.art !== 'lokal') throw new HttpFehler(404, 'Kein lokales Konto');
    const d = z.object({ alt: z.string(), neu: z.string() }).parse(req.body);
    const konto = await kontoAus(k);
    if (!passwortPruefen(d.alt, konto.passwort_hash)) throw new HttpFehler(400, 'Bisheriges Passwort falsch.');
    const problem = passwortProblem(d.neu);
    if (problem) throw new HttpFehler(400, problem);
    await plattformDb().updateTable('lokales_konto').set({ passwort_hash: passwortHash(d.neu) }).where('benutzername', '=', konto.benutzername).execute();
    await sitzungenBeenden(konto.benutzername, k.sitzung.id);
    await plattformProtokollieren(konto.benutzername, 'Passwort geändert', konto.benutzername);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/konto/passkeys/:id', async (req) => {
    const k = angemeldet(req);
    const konto = await kontoAus(k);
    const liste = passkeysAus(konto);
    const rest = liste.filter((p) => p.id !== req.params.id);
    if (rest.length === liste.length) throw new HttpFehler(404, 'Passkey nicht gefunden');
    if (!rest.length && !konto.totp_secret) throw new HttpFehler(400, 'Der letzte zweite Faktor kann nicht entfernt werden.');
    await plattformDb().updateTable('lokales_konto').set({ passkeys: JSON.stringify(rest) }).where('benutzername', '=', konto.benutzername).execute();
    await plattformProtokollieren(konto.benutzername, 'Passkey entfernt', konto.benutzername, { id: req.params.id });
    return { ok: true };
  });

  app.post('/api/konto/recovery', async (req) => {
    const k = angemeldet(req);
    const konto = await kontoAus(k);
    const { codes, hashes } = newRecoveryCodes();
    await plattformDb().updateTable('lokales_konto').set({ recovery_hashes: JSON.stringify(hashes) }).where('benutzername', '=', konto.benutzername).execute();
    await plattformProtokollieren(konto.benutzername, 'Wiederherstellungscodes neu erzeugt', konto.benutzername);
    return { recoveryCodes: codes };
  });

  // ---------- lokale Konten verwalten (Plattform-Admin) ----------

  app.get('/api/plattform/konten', async (req) => {
    plattform(req);
    const zeilen = await plattformDb().selectFrom('lokales_konto').selectAll().orderBy('benutzername').execute();
    return zeilen.map(kontoInfo);
  });

  app.post('/api/plattform/konten', async (req) => {
    const k = plattform(req);
    const d = z
      .object({ benutzername: z.string().trim().regex(/^[A-Za-z0-9._@-]{3,100}$/, 'Benutzername: 3–100 Zeichen, Buchstaben, Ziffern, . _ @ -'), name: z.string().trim().min(1).max(100), passwort: z.string() })
      .parse(req.body);
    const problem = passwortProblem(d.passwort);
    if (problem) throw new HttpFehler(400, problem);
    if (await kontoLesen(d.benutzername)) throw new HttpFehler(409, 'Benutzername bereits vergeben.');
    await plattformDb()
      .insertInto('lokales_konto')
      .values({ benutzername: d.benutzername, name: d.name, passwort_hash: passwortHash(d.passwort), erstellt_am: jetzt(), aktiv: 1, totp_zaehler: -1, recovery_hashes: '[]', passkeys: '[]', totp_secret: null, letzte_anmeldung: null })
      .execute();
    await plattformProtokollieren(k.sitzung.email, 'Lokales Konto angelegt', d.benutzername);
    return { ok: true };
  });

  app.put<{ Params: { name: string } }>('/api/plattform/konten/:name', async (req) => {
    const k = plattform(req);
    const d = z
      .object({ name: z.string().trim().min(1).max(100).optional(), aktiv: z.boolean().optional(), passwort: z.string().optional(), mfaZuruecksetzen: z.boolean().optional() })
      .parse(req.body);
    const konto = await kontoLesen(req.params.name);
    if (!konto) throw new HttpFehler(404, 'Konto nicht gefunden');
    const selbst = konto.benutzername.toLowerCase() === k.sitzung.email.toLowerCase();
    if (selbst && (d.aktiv === false || d.mfaZuruecksetzen)) throw new HttpFehler(400, 'Das eigene Konto kann so nicht geändert werden.');
    const werte: Partial<NonNullable<KontoZeile>> = {};
    if (d.name !== undefined) werte.name = d.name;
    if (d.aktiv !== undefined) werte.aktiv = d.aktiv ? 1 : 0;
    if (d.passwort) {
      const problem = passwortProblem(d.passwort);
      if (problem) throw new HttpFehler(400, problem);
      werte.passwort_hash = passwortHash(d.passwort);
    }
    if (d.mfaZuruecksetzen) Object.assign(werte, { totp_secret: null, totp_zaehler: -1, passkeys: '[]', recovery_hashes: '[]' });
    if (Object.keys(werte).length) {
      await plattformDb().updateTable('lokales_konto').set(werte).where('benutzername', '=', konto.benutzername).execute();
    }
    if (d.aktiv === false || d.passwort || d.mfaZuruecksetzen) await sitzungenBeenden(konto.benutzername);
    await plattformProtokollieren(k.sitzung.email, 'Lokales Konto geändert', konto.benutzername, {
      name: d.name,
      aktiv: d.aktiv,
      passwort: Boolean(d.passwort),
      mfaZuruecksetzen: Boolean(d.mfaZuruecksetzen),
    });
    return { ok: true };
  });
}
