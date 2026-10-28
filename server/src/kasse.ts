// Kasse: Tagesstand je Filiale, Belege (Korrektur nur per Gegenbeleg), Tagesabschluss mit Zählprotokoll.
import type { Kysely } from 'kysely';
import { type Barzahlung, type Kassenabschluss, type Kassenbeleg, type Kassentag, kassentagRechnen, type Zaehlung, zaehlungSumme } from '../../shared/kasse.ts';
import type { VorgangDaten } from '../../shared/verkauf.ts';
import type { MandantDB } from './db/schema.ts';
import { protokollieren } from './mandant.ts';
import { HttpFehler } from './sitzung.ts';
import { heuteBerlin } from './verkauf.ts';

const jetzt = () => new Date().toISOString();

/** Tag in Deutschland, zu dem ein Zeitpunkt gehört */
const tagVon = (iso: string) => heuteBerlin(new Date(iso));

async function filialeLesen(db: Kysely<MandantDB>, filialeId: number) {
  const f = await db.selectFrom('filiale').select(['id', 'kuerzel', 'name', 'wechselgeld_cent']).where('id', '=', filialeId).executeTakeFirst();
  if (!f) throw new HttpFehler(404, 'Filiale nicht gefunden');
  return { id: f.id, kuerzel: f.kuerzel, name: f.name, wechselgeldCent: f.wechselgeld_cent };
}

function belegAus(z: { id: number; filiale_id: number; datum: string; zeit: string; art: 'einnahme' | 'ausgabe'; grund: string; text: string; betrag_cent: number; person: string; storno_von: number | null }, kuerzel: string, storniertDurch: number | null): Kassenbeleg {
  return {
    id: z.id,
    nummer: `${kuerzel}-K${z.id}`,
    datum: z.datum,
    zeit: z.zeit,
    art: z.art,
    grund: z.grund,
    text: z.text,
    betragCent: z.betrag_cent,
    person: z.person,
    stornoVon: z.storno_von,
    storniertDurch,
  };
}

async function belegeAmTag(db: Kysely<MandantDB>, filialeId: number, datum: string, kuerzel: string): Promise<Kassenbeleg[]> {
  const zeilen = await db.selectFrom('kassenbeleg').selectAll().where('filiale_id', '=', filialeId).where('datum', '=', datum).orderBy('id').execute();
  const ids = zeilen.map((z) => z.id);
  const stornos = ids.length ? await db.selectFrom('kassenbeleg').select(['id', 'storno_von']).where('storno_von', 'in', ids).execute() : [];
  return zeilen.map((z) => belegAus(z, kuerzel, stornos.find((s) => s.storno_von === z.id)?.id ?? null));
}

/** Bar- und EC-Zahlungen aus dem Verkauf an diesem Tag in dieser Filiale (Zeit in Deutschland) */
async function zahlungenAmTag(db: Kysely<MandantDB>, filialeId: number, datum: string): Promise<Barzahlung[]> {
  // Zeitfenster großzügig (UTC±1 Tag), dann exakt nach deutschem Kalendertag filtern
  const von = `${datum}T00:00:00.000Z`;
  const bis = `${datum}T23:59:59.999Z`;
  const zeilen = await db
    .selectFrom('zahlung as z')
    .innerJoin('vorgang as v', 'v.id', 'z.vorgang_id')
    .select(['z.id', 'z.vorgang_id', 'z.zeit', 'z.betrag_cent', 'z.mittel', 'z.zweck', 'z.person', 'v.nummer', 'v.daten'])
    .where('v.filiale_id', '=', filialeId)
    .where('z.mittel', 'in', ['bar', 'ec'])
    .where('z.zeit', '>=', new Date(new Date(von).getTime() - 86_400_000).toISOString())
    .where('z.zeit', '<=', new Date(new Date(bis).getTime() + 86_400_000).toISOString())
    .orderBy('z.id')
    .execute();
  return zeilen
    .filter((z) => tagVon(z.zeit) === datum)
    .map((z) => ({
      zahlungId: z.id,
      vorgangId: z.vorgang_id,
      nummer: z.nummer ?? '',
      zeit: z.zeit,
      kunde: (JSON.parse(z.daten) as VorgangDaten).kunde.name,
      zweck: z.zweck,
      mittel: z.mittel,
      betragCent: z.betrag_cent,
      person: z.person,
    }));
}

function abschlussAus(z: {
  id: number;
  datum: string;
  zeit: string;
  anfang_cent: number;
  bar_zahlungen_cent: number;
  einnahmen_cent: number;
  ausgaben_cent: number;
  soll_cent: number;
  zaehlung: string;
  ist_cent: number;
  differenz_cent: number;
  entnahme_cent: number;
  z_bon_nr: string;
  z_bar_cent: number | null;
  ec_cent: number;
  bemerkung: string;
  uebergeben_von: string;
  uebernommen_von: string;
  person: string;
}, filiale: { id: number; kuerzel: string; name: string }): Kassenabschluss {
  return {
    id: z.id,
    datum: z.datum,
    zeit: z.zeit,
    filiale,
    anfangCent: z.anfang_cent,
    barZahlungenCent: z.bar_zahlungen_cent,
    einnahmenCent: z.einnahmen_cent,
    ausgabenCent: z.ausgaben_cent,
    sollCent: z.soll_cent,
    zaehlung: JSON.parse(z.zaehlung) as Zaehlung,
    istCent: z.ist_cent,
    differenzCent: z.differenz_cent,
    entnahmeCent: z.entnahme_cent,
    zBonNr: z.z_bon_nr,
    zBarCent: z.z_bar_cent,
    ecCent: z.ec_cent,
    bemerkung: z.bemerkung,
    uebergebenVon: z.uebergeben_von,
    uebernommenVon: z.uebernommen_von,
    person: z.person,
  };
}

export async function kassentag(db: Kysely<MandantDB>, filialeId: number, datum: string): Promise<Kassentag> {
  const filiale = await filialeLesen(db, filialeId);
  const [zahlungen, belege, abschluss] = await Promise.all([
    zahlungenAmTag(db, filialeId, datum),
    belegeAmTag(db, filialeId, datum, filiale.kuerzel),
    db.selectFrom('kassenabschluss').selectAll().where('filiale_id', '=', filialeId).where('datum', '=', datum).executeTakeFirst(),
  ]);
  const anfangCent = filiale.wechselgeldCent;
  return { filiale, datum, zahlungen, belege, anfangCent, ...kassentagRechnen({ zahlungen, belege, anfangCent }), abschluss: abschluss ? abschlussAus(abschluss, filiale) : null };
}

async function tagOffen(db: Kysely<MandantDB>, filialeId: number, datum: string): Promise<void> {
  const a = await db.selectFrom('kassenabschluss').select('id').where('filiale_id', '=', filialeId).where('datum', '=', datum).executeTakeFirst();
  if (a) throw new HttpFehler(409, `Für den ${datum.split('-').reverse().join('.')} ist die Kasse bereits abgeschlossen.`);
}

export async function belegAnlegen(
  db: Kysely<MandantDB>,
  b: { filialeId: number; datum: string; art: 'einnahme' | 'ausgabe'; grund: string; text: string; betragCent: number; person: string },
): Promise<Kassenbeleg> {
  const filiale = await filialeLesen(db, b.filialeId);
  await tagOffen(db, b.filialeId, b.datum);
  const r = await db
    .insertInto('kassenbeleg')
    .values({ filiale_id: b.filialeId, datum: b.datum, zeit: jetzt(), art: b.art, grund: b.grund, text: b.text, betrag_cent: b.betragCent, person: b.person, storno_von: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  const beleg = belegAus(r, filiale.kuerzel, null);
  await protokollieren(db, b.person, 'Kassenbeleg angelegt', beleg.nummer, { art: b.art, grund: b.grund, betragCent: b.betragCent });
  return beleg;
}

/** Gegenbeleg mit umgekehrter Art am selben Tag; der Ursprungsbeleg bleibt stehen. */
export async function belegStornieren(db: Kysely<MandantDB>, id: number, grund: string, person: string, sichtbar: number[] | null): Promise<Kassenbeleg> {
  const z = await db.selectFrom('kassenbeleg').selectAll().where('id', '=', id).executeTakeFirst();
  if (!z || (sichtbar && !sichtbar.includes(z.filiale_id))) throw new HttpFehler(404, 'Beleg nicht gefunden');
  if (z.storno_von) throw new HttpFehler(409, 'Ein Gegenbeleg kann nicht storniert werden.');
  const schon = await db.selectFrom('kassenbeleg').select('id').where('storno_von', '=', id).executeTakeFirst();
  if (schon) throw new HttpFehler(409, 'Der Beleg ist bereits storniert.');
  const filiale = await filialeLesen(db, z.filiale_id);
  const datum = heuteBerlin();
  await tagOffen(db, z.filiale_id, datum);
  const r = await db
    .insertInto('kassenbeleg')
    .values({
      filiale_id: z.filiale_id,
      datum,
      zeit: jetzt(),
      art: z.art === 'einnahme' ? 'ausgabe' : 'einnahme',
      grund: `Storno ${filiale.kuerzel}-K${z.id}`,
      text: grund,
      betrag_cent: z.betrag_cent,
      person,
      storno_von: id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await protokollieren(db, person, 'Kassenbeleg storniert', `${filiale.kuerzel}-K${z.id}`, { gegenbeleg: r.id, grund });
  return belegAus(r, filiale.kuerzel, null);
}

export async function belegLesen(db: Kysely<MandantDB>, id: number, sichtbar: number[] | null): Promise<{ beleg: Kassenbeleg; filiale: { id: number; kuerzel: string; name: string } }> {
  const z = await db.selectFrom('kassenbeleg').selectAll().where('id', '=', id).executeTakeFirst();
  if (!z || (sichtbar && !sichtbar.includes(z.filiale_id))) throw new HttpFehler(404, 'Beleg nicht gefunden');
  const filiale = await filialeLesen(db, z.filiale_id);
  const storno = await db.selectFrom('kassenbeleg').select('id').where('storno_von', '=', id).executeTakeFirst();
  return { beleg: belegAus(z, filiale.kuerzel, storno?.id ?? null), filiale };
}

export async function abschliessen(
  db: Kysely<MandantDB>,
  a: { filialeId: number; datum: string; zaehlung: Zaehlung; zBonNr: string; zBarCent: number | null; bemerkung: string; uebergebenVon: string; uebernommenVon: string; person: string },
): Promise<Kassenabschluss> {
  if (a.datum > heuteBerlin()) throw new HttpFehler(400, 'Ein Tag in der Zukunft kann nicht abgeschlossen werden.');
  return db.transaction().execute(async (tx) => {
    await tagOffen(tx, a.filialeId, a.datum);
    const t = await kassentag(tx, a.filialeId, a.datum);
    const istCent = zaehlungSumme(a.zaehlung);
    const differenzCent = istCent - t.sollCent;
    const entnahmeCent = Math.max(0, istCent - t.anfangCent);
    const r = await tx
      .insertInto('kassenabschluss')
      .values({
        filiale_id: a.filialeId,
        datum: a.datum,
        zeit: jetzt(),
        anfang_cent: t.anfangCent,
        bar_zahlungen_cent: t.barZahlungenCent,
        einnahmen_cent: t.einnahmenCent,
        ausgaben_cent: t.ausgabenCent,
        soll_cent: t.sollCent,
        zaehlung: JSON.stringify(a.zaehlung),
        ist_cent: istCent,
        differenz_cent: differenzCent,
        entnahme_cent: entnahmeCent,
        z_bon_nr: a.zBonNr,
        z_bar_cent: a.zBarCent,
        ec_cent: t.ecCent,
        bemerkung: a.bemerkung,
        uebergeben_von: a.uebergebenVon,
        uebernommen_von: a.uebernommenVon,
        person: a.person,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await protokollieren(tx, a.person, 'Kasse abgeschlossen', `${t.filiale.kuerzel} ${a.datum}`, { sollCent: t.sollCent, istCent, differenzCent, zBonNr: a.zBonNr });
    return abschlussAus(r, t.filiale);
  });
}

export async function abschlussLesen(db: Kysely<MandantDB>, id: number, sichtbar: number[] | null): Promise<Kassenabschluss> {
  const z = await db.selectFrom('kassenabschluss').selectAll().where('id', '=', id).executeTakeFirst();
  if (!z || (sichtbar && !sichtbar.includes(z.filiale_id))) throw new HttpFehler(404, 'Abschluss nicht gefunden');
  return abschlussAus(z, await filialeLesen(db, z.filiale_id));
}

export async function abschluesseListe(db: Kysely<MandantDB>, sichtbar: number[] | null, filialeId?: number, limit = 60): Promise<Kassenabschluss[]> {
  let q = db.selectFrom('kassenabschluss').selectAll().orderBy('datum', 'desc').orderBy('id', 'desc').limit(limit);
  if (sichtbar) q = q.where('filiale_id', 'in', sichtbar.length ? sichtbar : [-1]);
  if (filialeId) q = q.where('filiale_id', '=', filialeId);
  const zeilen = await q.execute();
  const filialen = await db.selectFrom('filiale').select(['id', 'kuerzel', 'name']).execute();
  return zeilen.map((z) => abschlussAus(z, filialen.find((f) => f.id === z.filiale_id)!));
}
