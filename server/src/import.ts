// Import der Rechnungsdateien des Altsystems (CR_Verkauf.xls-Vorlage, eine Datei je Rechnung).
// Zellen des Blatts „Daten“: A1 Filiale, C2 Sachbearbeiter, F2 Datum, C4 Nummer, C7 Zahlungsart, C8 Storno,
// C9 Lieferart, F9 Liefertag, F11 Zeit, C13 Ausliefern von, F13 Lieferkosten, F15 Montage, F17 Wagen,
// C19–C27 Kunde, B30:F41 Positionen, C48–C53 abweichende Rechnungsanschrift; Blatt „Rechnung“ D39 Anzahlung.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import XLSX, { type WorkSheet } from 'xlsx';
import type { Einstellungen } from '../../shared/types.ts';
import { type Anschrift, LEERE_ANSCHRIFT, leererVorgang, summenBerechnen, summenNegieren, type VorgangDaten } from '../../shared/verkauf.ts';
import type { MandantDB } from './db/schema.ts';
import { einstellungenLesen, protokollieren } from './mandant.ts';

export interface Altrechnung {
  datei: string;
  nummer: string;
  filialeKuerzel: string;
  jahr: number | null;
  laufnummer: number | null;
  datum: string;
  art: 'rechnung' | 'storno';
  sachbearbeiter: string;
  zahlungsart: string;
  daten: VorgangDaten;
  bruttoCent: number;
  /** Summe laut Altsystem (Blatt Rechnung E40), zum Abgleich */
  altSummeCent: number | null;
  hinweise: string[];
}

export interface ImportErgebnis {
  datei: string;
  nummer: string;
  status: 'importiert' | 'uebersprungen' | 'fehler';
  meldung: string;
  vorgangId?: number;
}

type Blatt = WorkSheet;

const text = (ws: Blatt, adr: string): string => {
  const c = ws[adr];
  return c && c.v !== undefined && c.v !== null ? String(c.v).trim() : '';
};
const zahl = (ws: Blatt, adr: string): number | null => {
  const c = ws[adr];
  if (!c || c.v === undefined || c.v === null || c.v === '') return null;
  if (typeof c.v === 'number') return c.v;
  const n = Number(String(c.v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const cent = (n: number | null) => Math.round((n ?? 0) * 100);

/** Excel-Seriennummer oder Text → YYYY-MM-DD */
export function datumAus(wert: unknown): string | null {
  if (typeof wert === 'number' && wert > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(wert) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof wert === 'string') {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(wert.trim());
    if (m) return `${m[3]!.length === 2 ? '20' + m[3] : m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(wert)) return wert.slice(0, 10);
  }
  return null;
}

function etageAus(t: string): { etage: number | null; aufzug: boolean } {
  const s = t.toLowerCase();
  if (!s) return { etage: null, aufzug: false };
  if (s.includes('bordstein')) return { etage: -1, aufzug: false };
  if (s.includes('parterre') || s.includes('erdgeschoss') || s.includes('souterrain') || s.includes('keller')) return { etage: 0, aufzug: false };
  const m = /(\d+)\s*\.?\s*og/.exec(s);
  if (m) return { etage: Number(m[1]), aufzug: s.includes('mit aufzug') };
  return { etage: null, aufzug: false };
}

function anschrift(ws: Blatt, zeilen: { anrede?: string; name: string; zusatz?: string; strasse: string; plz: string; ort: string }): Anschrift {
  return {
    ...LEERE_ANSCHRIFT,
    anrede: (['Herr', 'Frau', 'Herr und Frau', 'Familie', 'Firma'].find((a) => a === text(ws, zeilen.anrede ?? 'ZZ999')) ?? '') as Anschrift['anrede'],
    name: text(ws, zeilen.name),
    zusatz: zeilen.zusatz ? text(ws, zeilen.zusatz) : '',
    strasse: text(ws, zeilen.strasse),
    plz: text(ws, zeilen.plz),
    ort: text(ws, zeilen.ort),
  };
}

export function altrechnungLesen(datei: string, puffer: Buffer, e: Einstellungen): Altrechnung {
  const wb = XLSX.read(puffer, { type: 'buffer', cellDates: false });
  const d = wb.Sheets['Daten'];
  const r = wb.Sheets['Rechnung'];
  if (!d) throw new Error('Kein Blatt „Daten“ – keine Rechnungsdatei des Altsystems');
  const hinweise: string[] = [];
  const nummer = text(d, 'C4');
  if (!nummer) throw new Error('Keine Rechnungsnummer in Daten!C4');
  const m = /^([A-Za-z]{1,5})-(\d{1,6})-(\d{2})(ec)?$/i.exec(nummer);
  const filialeKuerzel = (text(d, 'A1') || m?.[1] || '').toUpperCase();
  if (!filialeKuerzel) throw new Error('Keine Filiale in Daten!A1');
  const datum = datumAus(d['F2']?.v) ?? datumAus(d['F3']?.v);
  if (!datum) throw new Error('Kein Datum in Daten!F2');
  const jahr = m ? 2000 + Number(m[3]) : null;
  const laufnummer = m ? Number(m[2]) : null;
  if (!m) hinweise.push('Nummer nicht im Format F-N-JJ; Nummernkreis wird nicht fortgeschrieben');
  const ec = Boolean(m?.[4]);
  const zahlungsart = text(d, 'C7');
  const art: Altrechnung['art'] = text(d, 'C8').toLowerCase() === 'storno' ? 'storno' : 'rechnung';

  const v = leererVorgang(e.ustSatz);
  const kunde = anschrift(d, { anrede: 'C19', name: 'C20', strasse: 'C21', plz: 'C22', ort: 'C23' });
  const vorname = text(d, 'E20');
  if (vorname && vorname.toLowerCase() !== 'vorname') kunde.name = `${vorname} ${kunde.name}`.trim();
  v.kunde = { ...kunde, telefon: text(d, 'C24'), email: '' };
  if (text(d, 'C48') || text(d, 'C50')) {
    v.rechnungsanschrift = anschrift(d, { name: 'C48', zusatz: 'C49', strasse: 'C50', plz: 'C51', ort: 'C52' });
  }

  for (let zeile = 30; zeile <= 41; zeile++) {
    const bez = text(d, `B${zeile}`);
    const preis = zahl(d, `E${zeile}`);
    if (!bez && preis === null) continue;
    v.positionen = v.positionen.filter((p) => p.text || p.preisCent);
    v.positionen.push({ menge: zahl(d, `D${zeile}`) ?? 1, text: bez || 'Position', preisCent: cent(preis), ust: e.ustSatz, lagerort: '', kennzeichen: [] });
  }
  v.positionen = v.positionen.filter((p) => p.text || p.preisCent);
  const betragC7 = zahl(d, 'C7');
  if (!v.positionen.length && betragC7 !== null && !/[a-z]/i.test(zahlungsart)) {
    // Tageskasse-/Sammeldatei des Altsystems: Betrag steht in C7
    v.positionen.push({ menge: 1, text: `${text(d, 'C20') || 'Sammelbetrag'} (Altsystem)`, preisCent: cent(betragC7), ust: e.ustSatz, lagerort: '', kennzeichen: [] });
    hinweise.push('Sammeldatei (Tageskasse/EC) ohne Einzelpositionen');
  }
  if (!v.positionen.length) throw new Error('Keine Positionen');

  const lieferart = text(d, 'C9').toLowerCase();
  const l = v.lieferung;
  l.art = lieferart.startsWith('liefer') ? 'lieferung' : lieferart.startsWith('abhol') ? 'abholung' : 'mitnahme';
  if (l.art !== 'mitnahme') {
    l.von = text(d, 'C13');
    l.datum = datumAus(d['F9']?.v);
    l.zeitfenster = text(d, 'F11');
    l.hinweis = [text(d, 'C26'), text(d, 'C27')].filter(Boolean).join(' ');
  }
  if (l.art === 'lieferung') {
    Object.assign(l, etageAus(text(d, 'C25')));
    l.lieferkostenCent = cent(zahl(d, 'F13'));
    const montage = text(d, 'F15');
    const montageKosten = zahl(d, 'F15');
    l.montage = Boolean(montage) && !/keine/i.test(montage);
    l.montagekostenCent = l.montage && montageKosten !== null ? cent(montageKosten) : 0;
    if (l.montage && /artikel/i.test(montage)) hinweise.push('Montage „siehe bei Artikel“ – Kosten stehen in den Positionen');
    l.wagen = text(d, 'F17');
  }

  const za = zahlungsart.toLowerCase();
  const summen = summenBerechnen(v, e.ustSatz);
  const anzahlung = r ? zahl(r, 'D39') : null;
  if (za.startsWith('bar')) v.zahlung = { anzahlungCent: summen.bruttoCent, anzahlungMittel: ec ? 'ec' : 'bar', rest: 'abholung' };
  else if (za.startsWith('anzahlung')) v.zahlung = { anzahlungCent: cent(anzahlung), anzahlungMittel: ec ? 'ec' : 'bar', rest: l.art === 'lieferung' ? 'lieferung' : 'abholung' };
  else if (za.includes('lieferung')) v.zahlung = { anzahlungCent: 0, anzahlungMittel: 'bar', rest: 'lieferung' };
  else if (za.includes('rechnung')) v.zahlung = { anzahlungCent: 0, anzahlungMittel: 'bar', rest: 'ueberweisung' };
  else v.zahlung = { anzahlungCent: betragC7 !== null && !v.positionen.length ? 0 : summen.bruttoCent, anzahlungMittel: ec ? 'ec' : 'bar', rest: 'abholung' };
  if (v.zahlung.anzahlungCent > summen.bruttoCent) {
    hinweise.push(`Anzahlung ${v.zahlung.anzahlungCent / 100} über Brutto – auf Brutto begrenzt`);
    v.zahlung.anzahlungCent = summen.bruttoCent;
  }

  const altSumme = r ? zahl(r, 'E40') : null;
  const altSummeCent = altSumme === null ? null : cent(altSumme);
  if (altSummeCent !== null && Math.abs(altSummeCent - summen.bruttoCent) > 1) hinweise.push(`Summe laut Altsystem ${altSumme} weicht ab`);
  v.bemerkung = `Import aus Altsystem (${datei})`;

  return {
    datei,
    nummer,
    filialeKuerzel,
    jahr,
    laufnummer,
    datum,
    art,
    sachbearbeiter: text(d, 'C2'),
    zahlungsart,
    daten: v,
    bruttoCent: art === 'storno' ? -summen.bruttoCent : summen.bruttoCent,
    altSummeCent,
    hinweise,
  };
}

const suchText = (d: VorgangDaten) =>
  [d.kunde.name, d.kunde.zusatz, d.kunde.strasse, d.kunde.ort, d.kunde.telefon, d.rechnungsanschrift?.name ?? ''].join(' ').toLocaleLowerCase('de-DE');

export async function altrechnungImportieren(db: Kysely<MandantDB>, a: Altrechnung, person: string): Promise<ImportErgebnis> {
  const filiale = await db.selectFrom('filiale').select('id').where('kuerzel', '=', a.filialeKuerzel).executeTakeFirst();
  if (!filiale) return { datei: a.datei, nummer: a.nummer, status: 'fehler', meldung: `Filiale ${a.filialeKuerzel} gibt es nicht – bitte zuerst anlegen` };
  const vorhanden = await db.selectFrom('vorgang').select('id').where('nummer', '=', a.nummer).executeTakeFirst();
  if (vorhanden) return { datei: a.datei, nummer: a.nummer, status: 'uebersprungen', meldung: 'Nummer bereits vorhanden', vorgangId: vorhanden.id };
  const e = await einstellungenLesen(db);
  const summen = a.art === 'storno' ? summenNegieren(summenBerechnen(a.daten, e.ustSatz)) : summenBerechnen(a.daten, e.ustSatz);
  const zeit = `${a.datum}T11:00:00.000Z`;
  return db.transaction().execute(async (tx) => {
    const r = await tx
      .insertInto('vorgang')
      .values({
        art: a.art,
        status: 'festgeschrieben',
        nummer: a.nummer,
        filiale_id: filiale.id,
        jahr: a.jahr,
        laufnummer: a.laufnummer,
        bezug_id: null,
        datum: a.datum,
        daten: JSON.stringify(a.daten),
        summen: JSON.stringify(summen),
        brutto_cent: summen.bruttoCent,
        kunde_suche: suchText(a.daten),
        sachbearbeiter: a.sachbearbeiter,
        storno_grund: a.art === 'storno' ? 'Storno im Altsystem' : '',
        erstellt_von: 'import',
        erstellt_am: zeit,
        geaendert_am: zeit,
        festgeschrieben_am: zeit,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (a.daten.zahlung.anzahlungCent > 0 && a.art === 'rechnung') {
      await tx
        .insertInto('zahlung')
        .values({ vorgang_id: r.id, zeit, betrag_cent: a.daten.zahlung.anzahlungCent, mittel: a.daten.zahlung.anzahlungMittel, zweck: 'anzahlung', kassen_bon: '', person: 'import' })
        .execute();
    }
    if (a.jahr && a.laufnummer) {
      await tx
        .insertInto('nummernkreis')
        .values({ filiale_id: filiale.id, jahr: a.jahr, letzte: a.laufnummer })
        .onConflict((oc) => oc.columns(['filiale_id', 'jahr']).doUpdateSet({ letzte: sql`max(letzte, ${a.laufnummer})` }))
        .execute();
    }
    await protokollieren(tx, person, 'Altrechnung importiert', a.nummer, { datei: a.datei, bruttoCent: summen.bruttoCent, hinweise: a.hinweise });
    return { datei: a.datei, nummer: a.nummer, status: 'importiert' as const, meldung: a.hinweise.join('; '), vorgangId: r.id };
  });
}
