// Artikelstamm, Lagerorte, Bestand und Lagerbuchungen (unveränderlich; Bestand ist die Summe der Buchungen).
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Artikel, Bestand, Buchungsart, Lagerbuchung, Lagerort } from '../../shared/lager.ts';
import type { Position } from '../../shared/verkauf.ts';
import type { MandantDB } from './db/schema.ts';
import { protokollieren } from './mandant.ts';
import { HttpFehler } from './sitzung.ts';

type Db = Kysely<MandantDB> | Transaction<MandantDB>;
const jetzt = () => new Date().toISOString();

// ---------- Lagerorte ----------

export async function lagerorteListe(db: Db): Promise<Lagerort[]> {
  const z = await db.selectFrom('lagerort').selectAll().orderBy('name').execute();
  return z.map((l) => ({ id: l.id, name: l.name, filialeId: l.filiale_id, aktiv: l.aktiv === 1 }));
}

export async function lagerortSpeichern(db: Db, l: Omit<Lagerort, 'id'> & { id?: number }): Promise<number> {
  const werte = { name: l.name.trim(), filiale_id: l.filialeId, aktiv: l.aktiv ? 1 : 0 };
  const doppelt = await db.selectFrom('lagerort').select('id').where('name', '=', werte.name).executeTakeFirst();
  if (doppelt && doppelt.id !== l.id) throw new HttpFehler(409, `Lagerort „${werte.name}“ gibt es bereits`);
  if (l.id) {
    const r = await db.updateTable('lagerort').set(werte).where('id', '=', l.id).executeTakeFirst();
    if (!r.numUpdatedRows) throw new HttpFehler(404, 'Lagerort nicht gefunden');
    return l.id;
  }
  return (await db.insertInto('lagerort').values(werte).returning('id').executeTakeFirstOrThrow()).id;
}

// ---------- Artikel ----------

export async function artikelListe(db: Db, q = '', nurAktive = true, limit = 500): Promise<Artikel[]> {
  let abfrage = db
    .selectFrom('artikel as a')
    .select(['a.id', 'a.nummer', 'a.bezeichnung', 'a.preis_cent', 'a.ust', 'a.lagerort_id', 'a.aktiv', sql<number>`(SELECT COALESCE(SUM(menge), 0) FROM bestand WHERE artikel_id = a.id)`.as('bestand')])
    .orderBy('a.bezeichnung')
    .limit(limit);
  if (nurAktive) abfrage = abfrage.where('a.aktiv', '=', 1);
  const begriff = q.trim().toLocaleLowerCase('de-DE');
  if (begriff) {
    const muster = `%${begriff.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    abfrage = abfrage.where(sql<boolean>`a.suche LIKE ${muster} ESCAPE '\\'`);
  }
  const z = await abfrage.execute();
  return z.map((a) => ({ id: a.id, nummer: a.nummer, bezeichnung: a.bezeichnung, preisCent: a.preis_cent, ust: a.ust, lagerortId: a.lagerort_id, aktiv: a.aktiv === 1, bestand: a.bestand }));
}

export async function artikelSpeichern(db: Db, a: Omit<Artikel, 'id' | 'bestand'> & { id?: number }): Promise<number> {
  const werte = {
    nummer: a.nummer.trim(),
    bezeichnung: a.bezeichnung.trim(),
    preis_cent: a.preisCent,
    ust: a.ust,
    lagerort_id: a.lagerortId,
    aktiv: a.aktiv ? 1 : 0,
    suche: `${a.nummer} ${a.bezeichnung}`.toLocaleLowerCase('de-DE'),
  };
  if (werte.nummer) {
    const doppelt = await db.selectFrom('artikel').select('id').where('nummer', '=', werte.nummer).executeTakeFirst();
    if (doppelt && doppelt.id !== a.id) throw new HttpFehler(409, `Artikelnummer ${werte.nummer} ist bereits vergeben`);
  }
  if (a.lagerortId && !(await db.selectFrom('lagerort').select('id').where('id', '=', a.lagerortId).executeTakeFirst())) throw new HttpFehler(400, 'Unbekannter Lagerort');
  if (a.id) {
    const r = await db.updateTable('artikel').set(werte).where('id', '=', a.id).executeTakeFirst();
    if (!r.numUpdatedRows) throw new HttpFehler(404, 'Artikel nicht gefunden');
    return a.id;
  }
  return (await db.insertInto('artikel').values(werte).returning('id').executeTakeFirstOrThrow()).id;
}

// ---------- Bestand und Buchungen ----------

export async function bestandListe(db: Db, q = ''): Promise<Bestand[]> {
  let abfrage = db
    .selectFrom('bestand as b')
    .innerJoin('artikel as a', 'a.id', 'b.artikel_id')
    .innerJoin('lagerort as l', 'l.id', 'b.lagerort_id')
    .select(['b.artikel_id', 'a.nummer', 'a.bezeichnung', 'b.lagerort_id', 'l.name as lagerort', 'b.menge'])
    .where('b.menge', '!=', 0)
    .orderBy('a.bezeichnung')
    .orderBy('l.name');
  const begriff = q.trim().toLocaleLowerCase('de-DE');
  if (begriff) {
    const muster = `%${begriff.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    abfrage = abfrage.where(sql<boolean>`a.suche LIKE ${muster} ESCAPE '\\'`);
  }
  const z = await abfrage.execute();
  return z.map((b) => ({ artikelId: b.artikel_id, nummer: b.nummer, bezeichnung: b.bezeichnung, lagerortId: b.lagerort_id, lagerort: b.lagerort, menge: b.menge }));
}

export async function buchungenListe(db: Db, limit = 200, artikelId?: number): Promise<Lagerbuchung[]> {
  let abfrage = db
    .selectFrom('lagerbuchung as b')
    .innerJoin('artikel as a', 'a.id', 'b.artikel_id')
    .innerJoin('lagerort as l', 'l.id', 'b.lagerort_id')
    .select(['b.id', 'b.zeit', 'b.art', 'b.artikel_id', 'a.bezeichnung', 'b.lagerort_id', 'l.name as lagerort', 'b.menge', 'b.bezug', 'b.text', 'b.person'])
    .orderBy('b.id', 'desc')
    .limit(limit);
  if (artikelId) abfrage = abfrage.where('b.artikel_id', '=', artikelId);
  const z = await abfrage.execute();
  return z.map((b) => ({ id: b.id, zeit: b.zeit, art: b.art, artikelId: b.artikel_id, bezeichnung: b.bezeichnung, lagerortId: b.lagerort_id, lagerort: b.lagerort, menge: b.menge, bezug: b.bezug, text: b.text, person: b.person }));
}

async function bestandAendern(db: Db, artikelId: number, lagerortId: number, delta: number): Promise<number> {
  const r = await db
    .insertInto('bestand')
    .values({ artikel_id: artikelId, lagerort_id: lagerortId, menge: delta })
    .onConflict((oc) => oc.columns(['artikel_id', 'lagerort_id']).doUpdateSet({ menge: sql`bestand.menge + ${delta}` }))
    .returning('menge')
    .executeTakeFirstOrThrow();
  return r.menge;
}

async function buchungSchreiben(db: Db, b: { art: Buchungsart; artikelId: number; lagerortId: number; menge: number; bezug: string; text: string; person: string }): Promise<void> {
  if (!b.menge) return;
  await db
    .insertInto('lagerbuchung')
    .values({ zeit: jetzt(), art: b.art, artikel_id: b.artikelId, lagerort_id: b.lagerortId, menge: b.menge, bezug: b.bezug, text: b.text, person: b.person })
    .execute();
  await bestandAendern(db, b.artikelId, b.lagerortId, b.menge);
}

export interface Buchung {
  art: 'wareneingang' | 'umlagerung' | 'inventur' | 'korrektur';
  artikelId: number;
  lagerortId: number;
  /** Wareneingang/Umlagerung: Menge; Inventur: gezählter Bestand; Korrektur: Differenz (±) */
  menge: number;
  zielLagerortId?: number | null;
  text: string;
}

export async function buchen(db: Kysely<MandantDB>, b: Buchung, person: string): Promise<{ menge: number }> {
  return db.transaction().execute(async (tx) => {
    const artikel = await tx.selectFrom('artikel').select(['id', 'bezeichnung']).where('id', '=', b.artikelId).executeTakeFirst();
    if (!artikel) throw new HttpFehler(404, 'Artikel nicht gefunden');
    const lagerorte = await lagerorteListe(tx);
    const von = lagerorte.find((l) => l.id === b.lagerortId);
    if (!von) throw new HttpFehler(404, 'Lagerort nicht gefunden');
    const stand = (await tx.selectFrom('bestand').select('menge').where('artikel_id', '=', b.artikelId).where('lagerort_id', '=', b.lagerortId).executeTakeFirst())?.menge ?? 0;
    let delta = b.menge;
    if (b.art === 'wareneingang') {
      if (b.menge <= 0) throw new HttpFehler(400, 'Menge muss größer 0 sein');
    } else if (b.art === 'inventur') {
      if (b.menge < 0) throw new HttpFehler(400, 'Gezählter Bestand kann nicht negativ sein');
      delta = b.menge - stand;
    } else if (b.art === 'umlagerung') {
      const nach = lagerorte.find((l) => l.id === b.zielLagerortId);
      if (!nach) throw new HttpFehler(400, 'Ziel-Lagerort fehlt');
      if (nach.id === von.id) throw new HttpFehler(400, 'Quelle und Ziel sind gleich');
      if (b.menge <= 0) throw new HttpFehler(400, 'Menge muss größer 0 sein');
      if (stand < b.menge) throw new HttpFehler(409, `In ${von.name} sind nur ${stand} vorhanden`);
      await buchungSchreiben(tx, { art: 'umlagerung', artikelId: b.artikelId, lagerortId: von.id, menge: -b.menge, bezug: `→ ${nach.name}`, text: b.text, person });
      await buchungSchreiben(tx, { art: 'umlagerung', artikelId: b.artikelId, lagerortId: nach.id, menge: b.menge, bezug: `← ${von.name}`, text: b.text, person });
      await protokollieren(tx, person, 'Umlagerung', artikel.bezeichnung, { menge: b.menge, von: von.name, nach: nach.name });
      return { menge: stand - b.menge };
    }
    await buchungSchreiben(tx, { art: b.art, artikelId: b.artikelId, lagerortId: von.id, menge: delta, bezug: '', text: b.text, person });
    await protokollieren(tx, person, `Lager: ${b.art}`, artikel.bezeichnung, { lagerort: von.name, delta, text: b.text });
    return { menge: stand + delta };
  });
}

/**
 * Beim Festschreiben (richtung −1) bzw. Storno (+1): Positionen mit Artikel aus dem Stamm abbuchen/zurückbuchen.
 * Lagerort: Position → Standard des Artikels; ohne Lagerort wird nicht gebucht (Freitext bleibt möglich).
 */
export async function verkaufBuchen(tx: Db, positionen: Position[], bezug: string, person: string, richtung: -1 | 1): Promise<void> {
  for (const p of positionen) {
    if (!p.artikelId) continue;
    const a = await tx.selectFrom('artikel').select(['id', 'lagerort_id']).where('id', '=', p.artikelId).executeTakeFirst();
    if (!a) continue;
    const lagerortId = p.lagerortId ?? a.lagerort_id;
    if (!lagerortId) continue;
    await buchungSchreiben(tx, { art: richtung < 0 ? 'verkauf' : 'storno', artikelId: a.id, lagerortId, menge: richtung * p.menge, bezug, text: '', person });
  }
}
