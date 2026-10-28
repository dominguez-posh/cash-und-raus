import type { Kysely, Selectable } from 'kysely';
import type { Benutzer, Einstellungen, Filiale, ProtokollEintrag, Rolle } from '../../shared/types.ts';
import { ROLLEN } from '../../shared/types.ts';
import { mandantDb, plattformDb } from './db/index.ts';
import type { MandantDB } from './db/schema.ts';

export const STANDARD_EINSTELLUNGEN: Omit<Einstellungen, 'hatLogo'> = {
  firmenname: '',
  strasse: '',
  plz: '',
  ort: '',
  telefon: '',
  email: '',
  web: '',
  steuernummer: '',
  ustId: '',
  bankName: '',
  iban: '',
  bic: '',
  fusstext: 'Vielen Dank für Ihren Einkauf.',
  ustSatz: 7,
  ustSaetze: [7, 19],
  nummernformat: '{F}-{N}-{JJ}',
  rabattarten: [],
  lieferzeiten: ['08:30 – 12:00 Uhr', '12:00 – 15:00 Uhr', '15:00 – 18:00 Uhr'],
  hinweise: [
    { zeichen: '*', text: 'Dieses Gerät hat keinen Schlauch mit Aqua-Stop. Wir empfehlen, ihn gegen einen Schlauch mit Aqua-Stop auszutauschen.' },
    {
      zeichen: '**',
      text: 'Für die Inanspruchnahme einer Gewährleistung muss das Gerät durch einen Fachbetrieb angeschlossen worden sein; ein Nachweis darüber ist vorzulegen.',
    },
  ],
  belegGruende: ['Einzahlung Bank', 'EC-Cash', 'Tanken', 'Einkauf Lager/Transport', 'Einkauf Büromaterial', 'Einkauf Putzmittel', 'Sonstiges'],
  lieferkosten: { grundCent: 4900, freiKm: 13, proKmCent: 140 },
};

const jetzt = () => new Date().toISOString();

export async function protokollieren(
  db: Kysely<MandantDB>,
  person: string,
  aktion: string,
  objekt: string,
  details: unknown = '',
): Promise<void> {
  await db
    .insertInto('protokoll')
    .values({ zeit: jetzt(), person, aktion, objekt, details: typeof details === 'string' ? details : JSON.stringify(details) })
    .execute();
}

// ---------- Einstellungen ----------

export async function einstellungenLesen(db: Kysely<MandantDB>): Promise<Einstellungen> {
  const zeile = await db.selectFrom('einstellungen').select(['daten', 'logo_mime']).where('id', '=', 1).executeTakeFirst();
  const daten = zeile ? (JSON.parse(zeile.daten) as Partial<Einstellungen>) : {};
  return { ...STANDARD_EINSTELLUNGEN, ...daten, hatLogo: Boolean(zeile?.logo_mime) };
}

export async function einstellungenSpeichern(db: Kysely<MandantDB>, e: Omit<Einstellungen, 'hatLogo'>): Promise<void> {
  const daten = JSON.stringify(e);
  await db
    .insertInto('einstellungen')
    .values({ id: 1, daten, logo: null, logo_mime: null })
    .onConflict((oc) => oc.column('id').doUpdateSet({ daten }))
    .execute();
}

export async function logoSetzen(db: Kysely<MandantDB>, logo: Buffer | null, mime: string | null): Promise<void> {
  const vorhanden = await db.selectFrom('einstellungen').select('id').where('id', '=', 1).executeTakeFirst();
  if (!vorhanden) await einstellungenSpeichern(db, STANDARD_EINSTELLUNGEN);
  await db.updateTable('einstellungen').set({ logo, logo_mime: mime }).where('id', '=', 1).execute();
}

export async function logoLesen(db: Kysely<MandantDB>): Promise<{ logo: Buffer; mime: string } | null> {
  const z = await db.selectFrom('einstellungen').select(['logo', 'logo_mime']).where('id', '=', 1).executeTakeFirst();
  return z?.logo && z.logo_mime ? { logo: z.logo, mime: z.logo_mime } : null;
}

// ---------- Filialen ----------

type FilialZeile = Selectable<MandantDB['filiale']>;

function filialeAus(z: FilialZeile): Filiale {
  return {
    id: z.id,
    kuerzel: z.kuerzel,
    name: z.name,
    strasse: z.strasse,
    plz: z.plz,
    ort: z.ort,
    telefon: z.telefon,
    fax: z.fax,
    email: z.email,
    ipBereiche: JSON.parse(z.ip_bereiche) as string[],
    aktiv: z.aktiv === 1,
    wechselgeldCent: z.wechselgeld_cent,
  };
}

export async function filialenListe(db: Kysely<MandantDB>): Promise<Filiale[]> {
  const zeilen = await db.selectFrom('filiale').selectAll().orderBy('kuerzel').execute();
  return zeilen.map(filialeAus);
}

export async function filialeSpeichern(db: Kysely<MandantDB>, f: Omit<Filiale, 'id'> & { id?: number }): Promise<number> {
  const werte = {
    kuerzel: f.kuerzel,
    name: f.name,
    strasse: f.strasse,
    plz: f.plz,
    ort: f.ort,
    telefon: f.telefon,
    fax: f.fax,
    email: f.email,
    ip_bereiche: JSON.stringify(f.ipBereiche),
    aktiv: f.aktiv ? 1 : 0,
    wechselgeld_cent: f.wechselgeldCent,
  };
  if (f.id) {
    await db.updateTable('filiale').set(werte).where('id', '=', f.id).execute();
    return f.id;
  }
  const r = await db.insertInto('filiale').values(werte).returning('id').executeTakeFirstOrThrow();
  return r.id;
}

// ---------- Benutzer ----------

function rollenAus(text: string): Rolle[] {
  const liste = JSON.parse(text) as string[];
  return liste.filter((r): r is Rolle => (ROLLEN as readonly string[]).includes(r));
}

export async function benutzerListe(db: Kysely<MandantDB>): Promise<Benutzer[]> {
  const zeilen = await db.selectFrom('benutzer').selectAll().orderBy('name').execute();
  const zuordnung = await db.selectFrom('benutzer_filiale').selectAll().execute();
  return zeilen.map((z) => ({
    id: z.id,
    email: z.email,
    name: z.name,
    rollen: rollenAus(z.rollen),
    alleFilialen: z.alle_filialen === 1,
    filialIds: zuordnung.filter((b) => b.benutzer_id === z.id).map((b) => b.filiale_id),
    aktiv: z.aktiv === 1,
    entraVerknuepft: Boolean(z.entra_oid),
    letzteAnmeldung: z.letzte_anmeldung,
  }));
}

export async function benutzerLesen(db: Kysely<MandantDB>, id: number): Promise<Benutzer | undefined> {
  return (await benutzerListe(db)).find((b) => b.id === id);
}

export async function benutzerSpeichern(
  db: Kysely<MandantDB>,
  b: Pick<Benutzer, 'email' | 'name' | 'rollen' | 'alleFilialen' | 'filialIds' | 'aktiv'> & { id?: number },
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const werte = {
      email: b.email.trim(),
      name: b.name.trim(),
      rollen: JSON.stringify(b.rollen),
      alle_filialen: b.alleFilialen ? 1 : 0,
      aktiv: b.aktiv ? 1 : 0,
    };
    let id = b.id;
    if (id) {
      await tx.updateTable('benutzer').set(werte).where('id', '=', id).execute();
    } else {
      id = (await tx.insertInto('benutzer').values(werte).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.deleteFrom('benutzer_filiale').where('benutzer_id', '=', id).execute();
    if (!b.alleFilialen && b.filialIds.length) {
      await tx
        .insertInto('benutzer_filiale')
        .values(b.filialIds.map((filiale_id) => ({ benutzer_id: id!, filiale_id })))
        .execute();
    }
    return id;
  });
}

/** Filialen, in denen der Benutzer arbeiten darf (nur aktive). */
export async function erlaubteFilialen(db: Kysely<MandantDB>, benutzer: Benutzer | null): Promise<Filiale[]> {
  const aktive = (await filialenListe(db)).filter((f) => f.aktiv);
  if (!benutzer || benutzer.alleFilialen) return aktive;
  return aktive.filter((f) => benutzer.filialIds.includes(f.id));
}

// ---------- Protokoll ----------

export async function protokollListe(db: Kysely<MandantDB>, limit = 200): Promise<ProtokollEintrag[]> {
  return db.selectFrom('protokoll').selectAll().orderBy('id', 'desc').limit(limit).execute();
}

// ---------- Mandanten (Plattform) ----------

export async function plattformProtokollieren(person: string, aktion: string, objekt: string, details: unknown = ''): Promise<void> {
  await plattformDb()
    .insertInto('plattform_protokoll')
    .values({ zeit: jetzt(), person, aktion, objekt, details: typeof details === 'string' ? details : JSON.stringify(details) })
    .execute();
}

/** Legt Mandant und Mandanten-DB an; optional mit dem ersten Admin (Anmeldung per SAML). */
export async function mandantAnlegen(m: {
  id: string;
  name: string;
  admin: { email: string; name: string } | null;
  person: string;
}): Promise<void> {
  await plattformDb().insertInto('mandant').values({ id: m.id, name: m.name, aktiv: 1, erstellt_am: jetzt() }).execute();
  const db = mandantDb(m.id);
  await einstellungenSpeichern(db, { ...STANDARD_EINSTELLUNGEN, firmenname: m.name });
  if (m.admin) {
    await benutzerSpeichern(db, {
      email: m.admin.email,
      name: m.admin.name,
      rollen: ['admin'],
      alleFilialen: true,
      filialIds: [],
      aktiv: true,
    });
  }
  await protokollieren(db, m.person, 'Mandant angelegt', m.id, { name: m.name, admin: m.admin?.email ?? null });
  await plattformProtokollieren(m.person, 'Mandant angelegt', m.id, { name: m.name });
}
