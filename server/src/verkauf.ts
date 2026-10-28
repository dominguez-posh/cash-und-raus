// Verkauf: Entwürfe, Festschreiben mit lückenloser Nummer, Zahlungen, Storno, Suche.
import crypto from 'node:crypto';
import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import { z } from 'zod';
import type { Einstellungen, Filiale } from '../../shared/types.ts';
import {
  ANREDEN,
  LIEFERARTEN,
  MONTAGE_MINUTEN,
  positionGefuellt,
  RESTZAHLUNGEN,
  summenBerechnen,
  summenNegieren,
  type Summen,
  type Vorgang,
  type VorgangDaten,
  type VorgangKurz,
  type Zahlmittel,
  type Zahlung,
} from '../../shared/verkauf.ts';
import type { MandantDB } from './db/schema.ts';
import { einstellungenLesen, filialenListe, protokollieren } from './mandant.ts';
import { pdfErstellen, type PdfArt } from './pdf.ts';
import { HttpFehler } from './sitzung.ts';

type Db = Kysely<MandantDB> | Transaction<MandantDB>;
type VorgangZeile = Selectable<MandantDB['vorgang']>;

const text = (max = 200) => z.string().trim().max(max);
const cent = z.number().int().min(0).max(100_000_000);

const AnschriftDaten = z.object({
  anrede: z.enum(ANREDEN),
  name: text(),
  zusatz: text(),
  strasse: text(),
  plz: text(10),
  ort: text(),
});

export const VorgangDatenSchema = z.object({
  kunde: AnschriftDaten.extend({ telefon: text(50), email: z.union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse')]) }),
  rechnungsanschrift: AnschriftDaten.nullable(),
  positionen: z
    .array(
      z.object({
        menge: z.number().gt(0, 'Menge muss größer 0 sein').max(10_000),
        text: text(500),
        preisCent: cent,
        ust: z.number().min(0).max(100),
        lagerort: text(60),
        kennzeichen: z.array(z.string().regex(/^\*{1,3}$/)).max(3),
      }),
    )
    .max(50, 'Höchstens 50 Positionen'),
  rabatt: z.object({ kuerzel: text(10), name: text(60), prozent: z.number().gt(0).max(100) }).nullable(),
  lieferung: z.object({
    art: z.enum(LIEFERARTEN),
    von: text(100),
    datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    zeitfenster: text(40),
    etage: z.number().int().min(-1).max(30).nullable(),
    aufzug: z.boolean(),
    lieferkostenCent: cent,
    montage: z.boolean(),
    montageMinuten: z.number().int().refine((m) => (MONTAGE_MINUTEN as readonly number[]).includes(m), 'Ungültige Montagedauer'),
    montagekostenCent: cent,
    wagen: text(60),
    hinweis: text(1000),
  }),
  zahlung: z.object({ anzahlungCent: cent, anzahlungMittel: z.enum(['bar', 'ec']), rest: z.enum(RESTZAHLUNGEN) }),
  bemerkung: text(1000),
}) satisfies z.ZodType<VorgangDaten>;

const jetzt = () => new Date().toISOString();

/** Kalendertag in Deutschland (Rechnungsdatum, Jahr der Nummer) */
export function heuteBerlin(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);
}

export function nummerBilden(format: string, kuerzel: string, laufnummer: number, jahr: number): string {
  return format
    .replaceAll('{F}', kuerzel)
    .replaceAll('{N}', String(laufnummer))
    .replaceAll('{JJJJ}', String(jahr))
    .replaceAll('{JJ}', String(jahr % 100).padStart(2, '0'));
}

const suchText = (d: VorgangDaten) =>
  [d.kunde.name, d.kunde.zusatz, d.kunde.strasse, d.kunde.ort, d.kunde.telefon, d.rechnungsanschrift?.name ?? '']
    .join(' ')
    .toLocaleLowerCase('de-DE');

// ---------- Lesen ----------

async function zahlungenLesen(db: Db, vorgangIds: number[]): Promise<Map<number, Zahlung[]>> {
  const m = new Map<number, Zahlung[]>();
  if (!vorgangIds.length) return m;
  const zeilen = await db.selectFrom('zahlung').selectAll().where('vorgang_id', 'in', vorgangIds).orderBy('id').execute();
  for (const z of zeilen) {
    const liste = m.get(z.vorgang_id) ?? [];
    liste.push({ id: z.id, zeit: z.zeit, betragCent: z.betrag_cent, mittel: z.mittel, zweck: z.zweck, kassenBon: z.kassen_bon, person: z.person });
    m.set(z.vorgang_id, liste);
  }
  return m;
}

export async function vorgangLesen(db: Db, id: number, sichtbar: number[] | null): Promise<Vorgang> {
  const z = await db.selectFrom('vorgang').selectAll().where('id', '=', id).executeTakeFirst();
  if (!z || (sichtbar && !sichtbar.includes(z.filiale_id))) throw new HttpFehler(404, 'Vorgang nicht gefunden');
  const filiale = await db.selectFrom('filiale').select(['id', 'kuerzel', 'name']).where('id', '=', z.filiale_id).executeTakeFirstOrThrow();
  const zahlungen = (await zahlungenLesen(db, [id])).get(id) ?? [];
  const bezug = z.bezug_id ? await db.selectFrom('vorgang').select(['id', 'nummer']).where('id', '=', z.bezug_id).executeTakeFirst() : undefined;
  const storno = await db.selectFrom('vorgang').select(['id', 'nummer']).where('bezug_id', '=', id).where('art', '=', 'storno').executeTakeFirst();
  const summen = JSON.parse(z.summen) as Summen;
  const bezahltCent = zahlungen.reduce((s, x) => s + x.betragCent, 0);
  return {
    ...(JSON.parse(z.daten) as VorgangDaten),
    id: z.id,
    art: z.art,
    status: z.status,
    nummer: z.nummer,
    filiale,
    datum: z.datum,
    sachbearbeiter: z.sachbearbeiter,
    summen,
    zahlungen,
    bezahltCent,
    offenCent: z.art === 'storno' || storno || z.status === 'entwurf' ? 0 : summen.bruttoCent - bezahltCent,
    bezug: bezug ? { id: bezug.id, nummer: bezug.nummer ?? '' } : null,
    stornoGrund: z.storno_grund,
    storno: storno ? { id: storno.id, nummer: storno.nummer ?? '' } : null,
  };
}

export async function vorgangSuchen(db: Db, sichtbar: number[] | null, q: string, filialeId?: number): Promise<VorgangKurz[]> {
  let abfrage = db
    .selectFrom('vorgang as v')
    .innerJoin('filiale as f', 'f.id', 'v.filiale_id')
    .select([
      'v.id',
      'v.art',
      'v.status',
      'v.nummer',
      'v.datum',
      'v.daten',
      'v.brutto_cent',
      'f.kuerzel',
      sql<number>`(SELECT COALESCE(SUM(betrag_cent), 0) FROM zahlung WHERE vorgang_id = v.id)`.as('bezahlt'),
      sql<number>`(SELECT COUNT(*) FROM vorgang s WHERE s.bezug_id = v.id AND s.art = 'storno')`.as('storniert'),
    ])
    .orderBy('v.id', 'desc')
    .limit(100);
  if (sichtbar) abfrage = abfrage.where('v.filiale_id', 'in', sichtbar.length ? sichtbar : [-1]);
  if (filialeId) abfrage = abfrage.where('v.filiale_id', '=', filialeId);
  const begriff = q.trim().toLocaleLowerCase('de-DE');
  if (begriff) {
    const muster = `%${begriff.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    abfrage = abfrage.where((eb) =>
      eb.or([sql<boolean>`lower(v.nummer) LIKE ${muster} ESCAPE '\\'`, sql<boolean>`v.kunde_suche LIKE ${muster} ESCAPE '\\'`]),
    );
  }
  const zeilen = await abfrage.execute();
  return zeilen.map((z) => {
    const d = JSON.parse(z.daten) as VorgangDaten;
    const storniert = z.storniert > 0;
    return {
      id: z.id,
      art: z.art,
      status: z.status,
      nummer: z.nummer,
      datum: z.datum,
      kunde: d.kunde.name,
      ort: d.kunde.ort,
      filiale: z.kuerzel,
      bruttoCent: z.brutto_cent,
      offenCent: z.art === 'storno' || z.status === 'entwurf' || storniert ? 0 : z.brutto_cent - z.bezahlt,
      storniert,
    };
  });
}

/** Kunden aus früheren Vorgängen als Vorschlag (es gibt noch keinen Kundenstamm). */
export async function kundenVorschlaege(db: Db, sichtbar: number[] | null, q: string): Promise<VorgangDaten['kunde'][]> {
  const begriff = q.trim().toLocaleLowerCase('de-DE');
  if (begriff.length < 2) return [];
  const muster = `%${begriff.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  let abfrage = db
    .selectFrom('vorgang')
    .select('daten')
    .where('art', '=', 'rechnung')
    .where(sql<boolean>`kunde_suche LIKE ${muster} ESCAPE '\\'`)
    .orderBy('id', 'desc')
    .limit(50);
  if (sichtbar) abfrage = abfrage.where('filiale_id', 'in', sichtbar.length ? sichtbar : [-1]);
  const gesehen = new Set<string>();
  const ergebnis: VorgangDaten['kunde'][] = [];
  for (const z of await abfrage.execute()) {
    const k = (JSON.parse(z.daten) as VorgangDaten).kunde;
    const schluessel = `${k.name}|${k.strasse}|${k.plz}`.toLowerCase();
    if (!k.name || gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ergebnis.push(k);
    if (ergebnis.length >= 10) break;
  }
  return ergebnis;
}

// ---------- Entwurf ----------

export async function entwurfSpeichern(
  db: Kysely<MandantDB>,
  d: VorgangDaten,
  opts: { id?: number; filialeId: number; person: string; name: string; sichtbar: number[] | null },
): Promise<number> {
  const e = await einstellungenLesen(db);
  const summen = summenBerechnen(d, e.ustSatz);
  const werte = {
    daten: JSON.stringify(d),
    summen: JSON.stringify(summen),
    brutto_cent: summen.bruttoCent,
    kunde_suche: suchText(d),
    geaendert_am: jetzt(),
  };
  if (opts.id) {
    const v = await db.selectFrom('vorgang').select(['status', 'filiale_id']).where('id', '=', opts.id).executeTakeFirst();
    if (!v || (opts.sichtbar && !opts.sichtbar.includes(v.filiale_id))) throw new HttpFehler(404, 'Vorgang nicht gefunden');
    if (v.status !== 'entwurf') throw new HttpFehler(409, 'Der Vorgang ist festgeschrieben und kann nicht mehr geändert werden.');
    await db.updateTable('vorgang').set(werte).where('id', '=', opts.id).where('status', '=', 'entwurf').execute();
    return opts.id;
  }
  const r = await db
    .insertInto('vorgang')
    .values({
      ...werte,
      art: 'rechnung',
      status: 'entwurf',
      nummer: null,
      filiale_id: opts.filialeId,
      jahr: null,
      laufnummer: null,
      bezug_id: null,
      datum: heuteBerlin(),
      sachbearbeiter: opts.name,
      storno_grund: '',
      erstellt_von: opts.person,
      erstellt_am: werte.geaendert_am,
      festgeschrieben_am: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

export async function entwurfLoeschen(db: Kysely<MandantDB>, id: number, sichtbar: number[] | null): Promise<void> {
  const v = await db.selectFrom('vorgang').select(['status', 'filiale_id']).where('id', '=', id).executeTakeFirst();
  if (!v || (sichtbar && !sichtbar.includes(v.filiale_id))) throw new HttpFehler(404, 'Vorgang nicht gefunden');
  if (v.status !== 'entwurf') throw new HttpFehler(409, 'Festgeschriebene Vorgänge können nur storniert werden.');
  await db.deleteFrom('vorgang').where('id', '=', id).where('status', '=', 'entwurf').execute();
}

/** Prüft, ob ein Entwurf festgeschrieben werden kann; liefert die bereinigten Daten. */
export function festschreibbar(d: VorgangDaten, e: Einstellungen): VorgangDaten {
  const positionen = d.positionen.filter(positionGefuellt);
  if (!d.kunde.name.trim()) throw new HttpFehler(400, 'Kunde: Name fehlt');
  if (!positionen.length) throw new HttpFehler(400, 'Mindestens ein Artikel');
  positionen.forEach((p, i) => {
    if (!p.text.trim()) throw new HttpFehler(400, `Position ${i + 1}: Bezeichnung fehlt`);
    if (!e.ustSaetze.includes(p.ust)) throw new HttpFehler(400, `Position ${i + 1}: USt-Satz ${p.ust} % ist nicht freigegeben`);
  });
  if (d.rabatt && !e.rabattarten.some((r) => r.kuerzel === d.rabatt!.kuerzel && r.prozent === d.rabatt!.prozent)) {
    throw new HttpFehler(400, `Rabatt ${d.rabatt.kuerzel} ist nicht (mehr) eingerichtet`);
  }
  const l = d.lieferung;
  if (l.art === 'lieferung' && (!d.kunde.strasse.trim() || !d.kunde.ort.trim())) throw new HttpFehler(400, 'Lieferung: Anschrift des Kunden fehlt');
  const bereinigt: VorgangDaten = {
    ...d,
    positionen,
    lieferung:
      l.art === 'lieferung'
        ? { ...l, montagekostenCent: l.montage ? l.montagekostenCent : 0 }
        : { ...l, datum: l.art === 'abholung' ? l.datum : null, zeitfenster: '', etage: null, aufzug: false, lieferkostenCent: 0, montage: false, montagekostenCent: 0, wagen: '' },
  };
  const brutto = summenBerechnen(bereinigt, e.ustSatz).bruttoCent;
  if (d.zahlung.anzahlungCent > brutto) throw new HttpFehler(400, 'Die Anzahlung ist höher als der Rechnungsbetrag.');
  return bereinigt;
}

async function nummerVergeben(tx: Transaction<MandantDB>, filialeId: number, jahr: number): Promise<number> {
  const r = await tx
    .insertInto('nummernkreis')
    .values({ filiale_id: filialeId, jahr, letzte: 1 })
    .onConflict((oc) => oc.columns(['filiale_id', 'jahr']).doUpdateSet({ letzte: sql`letzte + 1` }))
    .returning('letzte')
    .executeTakeFirstOrThrow();
  return r.letzte;
}

async function dokumentAblegen(tx: Transaction<MandantDB>, vorgangId: number, art: 'rechnung' | 'quittung', pdf: Buffer, zahlungId: number | null = null) {
  await tx
    .insertInto('dokument')
    .values({ vorgang_id: vorgangId, zahlung_id: zahlungId, art, erstellt_am: jetzt(), sha256: crypto.createHash('sha256').update(pdf).digest('hex'), pdf })
    .execute();
}

async function druckDaten(db: Db, id: number) {
  const vorgang = await vorgangLesen(db, id, null);
  const einstellungen = await einstellungenLesen(db);
  const filiale = (await filialenListe(db)).find((f) => f.id === vorgang.filiale.id) as Filiale;
  const logo = await db.selectFrom('einstellungen').select(['logo', 'logo_mime']).where('id', '=', 1).executeTakeFirst();
  return { vorgang, einstellungen, filiale, logo: logo?.logo && logo.logo_mime ? { daten: logo.logo, mime: logo.logo_mime } : null };
}

export async function festschreiben(db: Kysely<MandantDB>, id: number, k: { person: string; name: string; sichtbar: number[] | null }): Promise<Vorgang> {
  await db.transaction().execute(async (tx) => {
    const z = await tx.selectFrom('vorgang').selectAll().where('id', '=', id).executeTakeFirst();
    if (!z || (k.sichtbar && !k.sichtbar.includes(z.filiale_id))) throw new HttpFehler(404, 'Vorgang nicht gefunden');
    if (z.status !== 'entwurf') throw new HttpFehler(409, `Bereits festgeschrieben als ${z.nummer}`);
    const e = await einstellungenLesen(tx);
    const d = festschreibbar(JSON.parse(z.daten) as VorgangDaten, e);
    const summen = summenBerechnen(d, e.ustSatz);
    const filiale = await tx.selectFrom('filiale').select(['kuerzel', 'aktiv']).where('id', '=', z.filiale_id).executeTakeFirstOrThrow();
    if (filiale.aktiv !== 1) throw new HttpFehler(409, 'Die Filiale ist deaktiviert.');
    const datum = heuteBerlin();
    const jahr = Number(datum.slice(0, 4));
    const laufnummer = await nummerVergeben(tx, z.filiale_id, jahr);
    const nummer = nummerBilden(e.nummernformat, filiale.kuerzel, laufnummer, jahr);
    await tx
      .updateTable('vorgang')
      .set({
        status: 'festgeschrieben',
        nummer,
        jahr,
        laufnummer,
        datum,
        daten: JSON.stringify(d),
        summen: JSON.stringify(summen),
        brutto_cent: summen.bruttoCent,
        kunde_suche: suchText(d),
        sachbearbeiter: k.name,
        geaendert_am: jetzt(),
        festgeschrieben_am: jetzt(),
      })
      .where('id', '=', id)
      .where('status', '=', 'entwurf')
      .execute();
    if (d.zahlung.anzahlungCent > 0) {
      await tx
        .insertInto('zahlung')
        .values({ vorgang_id: id, zeit: jetzt(), betrag_cent: d.zahlung.anzahlungCent, mittel: d.zahlung.anzahlungMittel, zweck: 'anzahlung', kassen_bon: '', person: k.person })
        .execute();
    }
    await dokumentAblegen(tx, id, 'rechnung', await pdfErstellen('rechnung', await druckDaten(tx, id)));
    await protokollieren(tx, k.person, 'Rechnung festgeschrieben', nummer, { id, bruttoCent: summen.bruttoCent, anzahlungCent: d.zahlung.anzahlungCent });
  });
  return vorgangLesen(db, id, k.sichtbar);
}

export async function zahlungErfassen(
  db: Kysely<MandantDB>,
  id: number,
  z: { betragCent: number; mittel: Zahlmittel; kassenBon: string },
  k: { person: string; sichtbar: number[] | null },
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const v = await vorgangLesen(tx, id, k.sichtbar);
    if (v.art !== 'rechnung' || v.status !== 'festgeschrieben') throw new HttpFehler(409, 'Zahlungen nur zu festgeschriebenen Rechnungen');
    if (v.storno) throw new HttpFehler(409, 'Die Rechnung ist storniert.');
    if (z.betragCent <= 0 || z.betragCent > v.offenCent) throw new HttpFehler(400, 'Betrag muss zwischen 0,01 und dem offenen Betrag liegen.');
    const r = await tx
      .insertInto('zahlung')
      .values({ vorgang_id: id, zeit: jetzt(), betrag_cent: z.betragCent, mittel: z.mittel, zweck: 'restzahlung', kassen_bon: z.kassenBon, person: k.person })
      .returning('id')
      .executeTakeFirstOrThrow();
    await dokumentAblegen(tx, id, 'quittung', await pdfErstellen('quittung', { ...(await druckDaten(tx, id)), zahlungId: r.id }), r.id);
    await protokollieren(tx, k.person, 'Zahlung erfasst', v.nummer ?? String(id), { betragCent: z.betragCent, mittel: z.mittel, kassenBon: z.kassenBon });
    return r.id;
  });
}

export async function stornieren(
  db: Kysely<MandantDB>,
  id: number,
  s: { grund: string; mittel: Zahlmittel },
  k: { person: string; name: string; sichtbar: number[] | null },
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const v = await vorgangLesen(tx, id, k.sichtbar);
    if (v.art !== 'rechnung' || v.status !== 'festgeschrieben') throw new HttpFehler(409, 'Nur festgeschriebene Rechnungen können storniert werden.');
    if (v.storno) throw new HttpFehler(409, `Bereits storniert durch ${v.storno.nummer}`);
    const e = await einstellungenLesen(tx);
    const datum = heuteBerlin();
    const jahr = Number(datum.slice(0, 4));
    const laufnummer = await nummerVergeben(tx, v.filiale.id, jahr);
    const nummer = nummerBilden(e.nummernformat, v.filiale.kuerzel, laufnummer, jahr);
    const daten: VorgangDaten = {
      kunde: v.kunde,
      rechnungsanschrift: v.rechnungsanschrift,
      positionen: v.positionen,
      rabatt: v.rabatt,
      lieferung: v.lieferung,
      zahlung: v.zahlung,
      bemerkung: v.bemerkung,
    };
    const summen = summenNegieren(v.summen);
    const zeit = jetzt();
    const r = await tx
      .insertInto('vorgang')
      .values({
        art: 'storno',
        status: 'festgeschrieben',
        nummer,
        filiale_id: v.filiale.id,
        jahr,
        laufnummer,
        bezug_id: id,
        datum,
        daten: JSON.stringify(daten),
        summen: JSON.stringify(summen),
        brutto_cent: summen.bruttoCent,
        kunde_suche: suchText(daten),
        sachbearbeiter: k.name,
        storno_grund: s.grund,
        erstellt_von: k.person,
        erstellt_am: zeit,
        geaendert_am: zeit,
        festgeschrieben_am: zeit,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (v.bezahltCent > 0) {
      await tx
        .insertInto('zahlung')
        .values({ vorgang_id: r.id, zeit, betrag_cent: -v.bezahltCent, mittel: s.mittel, zweck: 'erstattung', kassen_bon: '', person: k.person })
        .execute();
    }
    await dokumentAblegen(tx, r.id, 'rechnung', await pdfErstellen('rechnung', await druckDaten(tx, r.id)));
    await protokollieren(tx, k.person, 'Rechnung storniert', v.nummer ?? String(id), { storno: nummer, grund: s.grund, erstattetCent: v.bezahltCent, mittel: s.mittel });
    return r.id;
  });
}

// ---------- Dokumente ----------

export async function pdfLesen(db: Kysely<MandantDB>, id: number, art: PdfArt, sichtbar: number[] | null, zahlungId?: number): Promise<{ pdf: Buffer; name: string }> {
  const v = await vorgangLesen(db, id, sichtbar);
  const name = `${art === 'rechnung' ? (v.art === 'storno' ? 'Storno' : 'Rechnung') : art[0]!.toUpperCase() + art.slice(1)}-${v.nummer ?? `Entwurf-${v.id}`}`;
  // Rechnung und Quittung kommen aus dem Archiv (Stand beim Festschreiben bzw. bei der Zahlung).
  if ((art === 'rechnung' && v.status === 'festgeschrieben') || art === 'quittung') {
    let q = db.selectFrom('dokument').select('pdf').where('vorgang_id', '=', id).where('art', '=', art);
    if (art === 'quittung') q = q.where('zahlung_id', '=', zahlungId ?? -1);
    const d = await q.orderBy('id', 'desc').executeTakeFirst();
    if (!d) throw new HttpFehler(404, 'Dokument nicht gefunden');
    return { pdf: d.pdf, name: art === 'quittung' ? `${name}-${zahlungId}` : name };
  }
  if (v.art === 'storno' && art !== 'rechnung') throw new HttpFehler(404, 'Zum Storno gibt es nur die Stornorechnung.');
  return { pdf: await pdfErstellen(art, await druckDaten(db, id)), name };
}
