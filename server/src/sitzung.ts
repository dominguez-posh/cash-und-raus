import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Benutzer, Filiale, Ich, Rolle } from '../../shared/types.ts';
import { config } from './config.ts';
import { mandantDb, plattformDb } from './db/index.ts';
import type { MandantDB, PlattformDB } from './db/schema.ts';
import { clientIp, ipInBereichen } from './ip.ts';
import { benutzerLesen, einstellungenLesen, erlaubteFilialen, protokollieren } from './mandant.ts';

export const COOKIE = 'cr_sitzung';

/** Nach dem Passwort bleibt für den zweiten Faktor höchstens so viel Zeit. */
const MFA_MINUTEN = 15;

type SitzungZeile = PlattformDB['sitzung'];

export interface Kontext {
  sitzung: SitzungZeile;
  /** Lokales Konto: Passwort geprüft, zweiter Faktor fehlt noch. Dann sind nur die MFA-Schritte erlaubt. */
  mfaOffen: boolean;
  plattformAdmin: boolean;
  mandant: { id: string; name: string } | null;
  db: Kysely<MandantDB> | null;
  benutzer: Benutzer | null;
  rollen: Rolle[];
  filialen: Filiale[];
  filiale: Filiale | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    kontext: Kontext | null;
  }
}

export class HttpFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Sitzungen werden nur als SHA-256 des Cookie-Werts gespeichert.
const schluessel = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Filiale aus der IP ableiten; sonst die einzige erlaubte Filiale; sonst keine (Auswahl nötig). */
export function filialeBestimmen(filialen: Filiale[], ip: string): { filiale: Filiale; perIp: boolean } | null {
  const perIp = filialen.find((f) => ipInBereichen(ip, f.ipBereiche));
  if (perIp) return { filiale: perIp, perIp: true };
  if (filialen.length === 1) return { filiale: filialen[0]!, perIp: false };
  return null;
}

export interface Anmeldung {
  art: 'lokal' | 'saml';
  email: string;
  name: string;
  plattformAdmin: boolean;
  mfaOffen: boolean;
  mandantId: string | null;
  benutzerId: number | null;
}

export async function anmelden(req: FastifyRequest, reply: FastifyReply, a: Anmeldung): Promise<void> {
  const p = plattformDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const ip = clientIp(req);
  let filialeId: number | null = null;
  let perIp = false;

  if (a.mandantId && a.benutzerId) {
    const db = mandantDb(a.mandantId);
    const benutzer = (await benutzerLesen(db, a.benutzerId)) ?? null;
    const treffer = filialeBestimmen(await erlaubteFilialen(db, benutzer), ip);
    if (treffer) {
      filialeId = treffer.filiale.id;
      perIp = treffer.perIp;
    }
    await db.updateTable('benutzer').set({ letzte_anmeldung: new Date().toISOString() }).where('id', '=', a.benutzerId).execute();
    await protokollieren(db, a.email, 'Anmeldung', `Benutzer ${a.benutzerId}`, { art: a.art, ip, filialeId, perIp });
  }

  const jetzt = new Date();
  const stunden = a.mfaOffen ? MFA_MINUTEN / 60 : config.sitzungStunden;
  await p.deleteFrom('sitzung').where('laeuft_ab', '<', jetzt.toISOString()).execute();
  await p
    .insertInto('sitzung')
    .values({
      id: schluessel(token),
      art: a.art,
      email: a.email,
      name: a.name,
      plattform_admin: a.plattformAdmin ? 1 : 0,
      mfa_offen: a.mfaOffen ? 1 : 0,
      challenge: null,
      challenge_bis: null,
      mandant_id: a.mandantId,
      benutzer_id: a.benutzerId,
      filiale_id: filialeId,
      filiale_per_ip: perIp ? 1 : 0,
      laeuft_ab: new Date(jetzt.getTime() + stunden * 3600_000).toISOString(),
      erstellt_am: jetzt.toISOString(),
    })
    .execute();
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.hinterTlsProxy,
    maxAge: config.sitzungStunden * 3600,
  });
}

/** Zweiter Faktor bestätigt: volle Sitzungsdauer. */
export async function mfaAbschliessen(k: Kontext): Promise<void> {
  await sitzungAendern(k.sitzung.id, {
    mfa_offen: 0,
    challenge: null,
    challenge_bis: null,
    laeuft_ab: new Date(Date.now() + config.sitzungStunden * 3600_000).toISOString(),
  });
}

export async function abmelden(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[COOKIE];
  if (token) await plattformDb().deleteFrom('sitzung').where('id', '=', schluessel(token)).execute();
  reply.clearCookie(COOKIE, { path: '/' });
}

export async function sitzungAendern(id: string, werte: Partial<SitzungZeile>): Promise<void> {
  await plattformDb().updateTable('sitzung').set(werte).where('id', '=', id).execute();
}

/** Alle Sitzungen eines lokalen Kontos beenden (Passwort geändert, deaktiviert). */
export async function sitzungenBeenden(email: string, ausser?: string): Promise<void> {
  let q = plattformDb().deleteFrom('sitzung').where('art', '=', 'lokal').where('email', '=', email);
  if (ausser) q = q.where('id', '!=', ausser);
  await q.execute();
}

/** Lädt Sitzung, Mandant, Benutzer und Filiale. Ungültige Zustände werden bereinigt. */
export async function kontextLaden(req: FastifyRequest): Promise<Kontext | null> {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const p = plattformDb();
  const sitzung = await p.selectFrom('sitzung').selectAll().where('id', '=', schluessel(token)).executeTakeFirst();
  if (!sitzung || sitzung.laeuft_ab < new Date().toISOString()) return null;

  // Lokale Konten bei jeder Anfrage prüfen: Deaktivieren wirkt sofort.
  let plattformAdmin = false;
  if (sitzung.art === 'lokal') {
    const konto = await p.selectFrom('lokales_konto').select('aktiv').where('benutzername', '=', sitzung.email).executeTakeFirst();
    if (!konto || konto.aktiv !== 1) return null;
    plattformAdmin = sitzung.plattform_admin === 1;
  }

  const leer: Kontext = {
    sitzung,
    mfaOffen: sitzung.mfa_offen === 1,
    plattformAdmin,
    mandant: null,
    db: null,
    benutzer: null,
    rollen: [],
    filialen: [],
    filiale: null,
  };
  if (!sitzung.mandant_id || leer.mfaOffen) return leer;

  const mandant = await p.selectFrom('mandant').select(['id', 'name', 'aktiv']).where('id', '=', sitzung.mandant_id).executeTakeFirst();
  if (!mandant || (mandant.aktiv !== 1 && !plattformAdmin)) return sitzung.benutzer_id ? null : leer;

  const db = mandantDb(mandant.id);
  let benutzer: Benutzer | null = null;
  let rollen: Rolle[];
  if (sitzung.benutzer_id) {
    benutzer = (await benutzerLesen(db, sitzung.benutzer_id)) ?? null;
    if (!benutzer?.aktiv) return null;
    rollen = benutzer.rollen;
  } else if (plattformAdmin) {
    rollen = ['admin']; // Plattform-Admin betreut den Mandanten
  } else {
    return null;
  }

  const filialen = await erlaubteFilialen(db, benutzer);
  let filiale = filialen.find((f) => f.id === sitzung.filiale_id) ?? null;
  if (!filiale && sitzung.filiale_id !== null) {
    await sitzungAendern(sitzung.id, { filiale_id: null, filiale_per_ip: 0 });
    sitzung.filiale_id = null;
  }
  if (!filiale) {
    const treffer = filialeBestimmen(filialen, clientIp(req));
    if (treffer) {
      filiale = treffer.filiale;
      await sitzungAendern(sitzung.id, { filiale_id: filiale.id, filiale_per_ip: treffer.perIp ? 1 : 0 });
      sitzung.filiale_id = filiale.id;
      sitzung.filiale_per_ip = treffer.perIp ? 1 : 0;
    }
  }

  return { ...leer, mandant: { id: mandant.id, name: mandant.name }, db, benutzer, rollen, filialen, filiale };
}

export async function ichAus(k: Kontext): Promise<Ich> {
  let mfa: Ich['mfa'] = null;
  if (k.mfaOffen) {
    const konto = await plattformDb()
      .selectFrom('lokales_konto')
      .select(['totp_secret', 'passkeys'])
      .where('benutzername', '=', k.sitzung.email)
      .executeTakeFirst();
    const totp = Boolean(konto?.totp_secret);
    const passkey = JSON.parse(konto?.passkeys ?? '[]').length > 0;
    mfa = { status: totp || passkey ? 'pruefen' : 'einrichten', totp, passkey };
  }
  const einst = k.db ? await einstellungenLesen(k.db) : null;
  return {
    art: k.sitzung.art,
    name: k.sitzung.name,
    email: k.sitzung.email,
    mfa,
    plattformAdmin: k.plattformAdmin,
    mandant: k.mandant && { id: k.mandant.id, name: einst?.firmenname || k.mandant.name, hatLogo: Boolean(einst?.hatLogo) },
    rollen: k.rollen,
    filiale: k.filiale && { id: k.filiale.id, kuerzel: k.filiale.kuerzel, name: k.filiale.name, perIp: k.sitzung.filiale_per_ip === 1 },
    filialen: k.filialen.map((f) => ({ id: f.id, kuerzel: f.kuerzel, name: f.name })),
  };
}

// ---------- Zugriffsprüfung ----------

/** Sitzung vorhanden, auch wenn der zweite Faktor noch fehlt (nur für die MFA-Schritte). */
export function mitSitzung(req: FastifyRequest): Kontext {
  if (!req.kontext) throw new HttpFehler(401, 'Nicht angemeldet');
  return req.kontext;
}

export function angemeldet(req: FastifyRequest): Kontext {
  const k = mitSitzung(req);
  if (k.mfaOffen) throw new HttpFehler(401, 'Zweiter Faktor fehlt');
  return k;
}

export function imMandant(req: FastifyRequest): Kontext & { db: Kysely<MandantDB>; mandant: { id: string; name: string } } {
  const k = angemeldet(req);
  if (!k.db || !k.mandant) throw new HttpFehler(403, 'Kein Mandant gewählt');
  return k as Kontext & { db: Kysely<MandantDB>; mandant: { id: string; name: string } };
}

export function mitRolle(req: FastifyRequest, ...rollen: Rolle[]) {
  const k = imMandant(req);
  if (!rollen.some((r) => k.rollen.includes(r))) throw new HttpFehler(403, 'Keine Berechtigung');
  return k;
}

export function plattform(req: FastifyRequest): Kontext {
  const k = angemeldet(req);
  if (!k.plattformAdmin) throw new HttpFehler(403, 'Nur für Plattform-Admins');
  return k;
}
