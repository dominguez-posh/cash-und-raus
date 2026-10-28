// Verkauf: Datenmodell und Berechnung, gemeinsam für Server und Web-App.
// Beträge sind ganze Cent, Preise brutto (wie im Altsystem: „darin enthalten … Umsatzsteuer“).
import type { Einstellungen, Rolle } from './types.ts';

export const VERKAUF_ROLLEN: Rolle[] = ['admin', 'filialleitung', 'verkauf'];
export const LESE_ROLLEN: Rolle[] = [...VERKAUF_ROLLEN, 'dispo', 'lager'];
export const STORNO_ROLLEN: Rolle[] = ['admin', 'filialleitung'];

/** Was die Verkaufsmaske aus den Einstellungen braucht (auch ohne Admin-Rolle) */
export type VerkaufVorgaben = Pick<Einstellungen, 'ustSatz' | 'ustSaetze' | 'rabattarten' | 'lieferzeiten' | 'hinweise'> & {
  /** Filialen als Vorschlag für „Abholung aus / Ausliefern von“ */
  orte: string[];
};

export const ANREDEN = ['', 'Herr', 'Frau', 'Herr und Frau', 'Familie', 'Firma'] as const;
export type Anrede = (typeof ANREDEN)[number];

export const LIEFERARTEN = ['mitnahme', 'abholung', 'lieferung'] as const;
export type Lieferart = (typeof LIEFERARTEN)[number];
export const LIEFERART_NAMEN: Record<Lieferart, string> = {
  mitnahme: 'Sofort mitgenommen',
  abholung: 'Abholung durch Kunden',
  lieferung: 'Lieferung durch uns',
};

/** Womit tatsächlich gezahlt wird */
export const ZAHLMITTEL = ['bar', 'ec', 'ueberweisung'] as const;
export type Zahlmittel = (typeof ZAHLMITTEL)[number];
export const ZAHLMITTEL_NAMEN: Record<Zahlmittel, string> = { bar: 'Bar', ec: 'EC-Karte', ueberweisung: 'Überweisung' };

/** Wie ein offener Restbetrag beglichen wird */
export const RESTZAHLUNGEN = ['lieferung', 'abholung', 'ueberweisung'] as const;
export type Restzahlung = (typeof RESTZAHLUNGEN)[number];
export const RESTZAHLUNG_NAMEN: Record<Restzahlung, string> = {
  lieferung: 'Bei Lieferung',
  abholung: 'Bei Abholung',
  ueberweisung: 'Per Überweisung',
};

export const MONTAGE_MINUTEN = [30, 60, 90, 120, 150, 180, 210] as const;

export interface Anschrift {
  anrede: Anrede;
  name: string;
  zusatz: string;
  strasse: string;
  plz: string;
  ort: string;
}

export interface Kunde extends Anschrift {
  telefon: string;
  email: string;
}

export interface Position {
  menge: number;
  text: string;
  /** Einzelpreis brutto in Cent */
  preisCent: number;
  ust: number;
  /** Lagerort, falls abweichend vom Ausgangsort der Lieferung */
  lagerort: string;
  /** Kennzeichen für Hinweistexte, z. B. '*' oder '**' (Einstellungen → Hinweise) */
  kennzeichen: string[];
}

export interface Rabatt {
  kuerzel: string;
  name: string;
  prozent: number;
}

export interface Lieferung {
  art: Lieferart;
  /** Filiale oder Lager, von dem abgeholt/ausgeliefert wird */
  von: string;
  /** YYYY-MM-DD */
  datum: string | null;
  zeitfenster: string;
  /** -1 bis Bordsteinkante, 0 Erdgeschoss, 1… Obergeschoss */
  etage: number | null;
  aufzug: boolean;
  lieferkostenCent: number;
  montage: boolean;
  montageMinuten: number;
  montagekostenCent: number;
  wagen: string;
  hinweis: string;
}

export interface Zahlungsplan {
  /** Bei Festschreiben gezahlt (Anzahlung oder voller Betrag) */
  anzahlungCent: number;
  anzahlungMittel: 'bar' | 'ec';
  rest: Restzahlung;
}

/** Was im Verkauf eingegeben wird (Entwurf) */
export interface VorgangDaten {
  kunde: Kunde;
  rechnungsanschrift: Anschrift | null;
  positionen: Position[];
  rabatt: Rabatt | null;
  lieferung: Lieferung;
  zahlung: Zahlungsplan;
  bemerkung: string;
}

export interface SteuerZeile {
  satz: number;
  bruttoCent: number;
  steuerCent: number;
  nettoCent: number;
}

export interface Summen {
  /** Artikel vor Rabatt */
  artikelCent: number;
  rabattCent: number;
  lieferungCent: number;
  montageCent: number;
  bruttoCent: number;
  steuer: SteuerZeile[];
}

export type VorgangArt = 'rechnung' | 'storno';
export type VorgangStatus = 'entwurf' | 'festgeschrieben';

export interface Zahlung {
  id: number;
  zeit: string;
  betragCent: number;
  mittel: Zahlmittel;
  zweck: 'anzahlung' | 'restzahlung' | 'erstattung';
  kassenBon: string;
  person: string;
}

export interface Vorgang extends VorgangDaten {
  id: number;
  art: VorgangArt;
  status: VorgangStatus;
  nummer: string | null;
  filiale: { id: number; kuerzel: string; name: string };
  /** Rechnungsdatum (Festschreiben) bzw. Anlage des Entwurfs, YYYY-MM-DD */
  datum: string;
  sachbearbeiter: string;
  summen: Summen;
  zahlungen: Zahlung[];
  bezahltCent: number;
  offenCent: number;
  /** Storno: Bezug auf die stornierte Rechnung */
  bezug: { id: number; nummer: string } | null;
  stornoGrund: string;
  /** Rechnung: wurde storniert durch */
  storno: { id: number; nummer: string } | null;
}

export interface VorgangKurz {
  id: number;
  art: VorgangArt;
  status: VorgangStatus;
  nummer: string | null;
  datum: string;
  kunde: string;
  ort: string;
  filiale: string;
  bruttoCent: number;
  offenCent: number;
  storniert: boolean;
}

// ---------- Vorlagen ----------

export const LEERE_ANSCHRIFT: Anschrift = { anrede: '', name: '', zusatz: '', strasse: '', plz: '', ort: '' };

export const leerePosition = (ust: number): Position => ({ menge: 1, text: '', preisCent: 0, ust, lagerort: '', kennzeichen: [] });

export const leererVorgang = (ust: number): VorgangDaten => ({
  kunde: { ...LEERE_ANSCHRIFT, telefon: '', email: '' },
  rechnungsanschrift: null,
  positionen: [leerePosition(ust)],
  rabatt: null,
  lieferung: {
    art: 'mitnahme',
    von: '',
    datum: null,
    zeitfenster: '',
    etage: null,
    aufzug: false,
    lieferkostenCent: 0,
    montage: false,
    montageMinuten: 60,
    montagekostenCent: 0,
    wagen: '',
    hinweis: '',
  },
  zahlung: { anzahlungCent: 0, anzahlungMittel: 'bar', rest: 'lieferung' },
  bemerkung: '',
});

// ---------- Berechnung ----------

/** Positionen ohne Text und Preis zählen nicht (leere Zeilen im Formular). */
export const positionGefuellt = (p: Position) => p.text.trim() !== '' || p.preisCent !== 0;

export function positionBrutto(p: Position): number {
  return Math.round(p.menge * p.preisCent);
}

/** Rabatt gilt für Artikel, nicht für Lieferung und Montage. */
export function summenBerechnen(d: VorgangDaten, standardUst: number): Summen {
  const prozent = d.rabatt?.prozent ?? 0;
  const jeSatz = new Map<number, number>();
  const add = (satz: number, cent: number) => jeSatz.set(satz, (jeSatz.get(satz) ?? 0) + cent);
  let artikelCent = 0;
  let rabattCent = 0;
  for (const p of d.positionen.filter(positionGefuellt)) {
    const brutto = positionBrutto(p);
    const rabatt = Math.round((brutto * prozent) / 100);
    artikelCent += brutto;
    rabattCent += rabatt;
    add(p.ust, brutto - rabatt);
  }
  const l = d.lieferung;
  const lieferungCent = l.art === 'lieferung' ? l.lieferkostenCent : 0;
  const montageCent = l.art === 'lieferung' && l.montage ? l.montagekostenCent : 0;
  if (lieferungCent + montageCent) add(standardUst, lieferungCent + montageCent);
  const steuer = [...jeSatz.entries()]
    .sort(([a], [b]) => a - b)
    .map(([satz, bruttoCent]) => {
      const steuerCent = Math.round((bruttoCent * satz) / (100 + satz));
      return { satz, bruttoCent, steuerCent, nettoCent: bruttoCent - steuerCent };
    });
  return {
    artikelCent,
    rabattCent,
    lieferungCent,
    montageCent,
    bruttoCent: artikelCent - rabattCent + lieferungCent + montageCent,
    steuer,
  };
}

/** Storno: alle Beträge mit umgekehrtem Vorzeichen */
export function summenNegieren(s: Summen): Summen {
  return {
    artikelCent: -s.artikelCent,
    rabattCent: -s.rabattCent,
    lieferungCent: -s.lieferungCent,
    montageCent: -s.montageCent,
    bruttoCent: -s.bruttoCent,
    steuer: s.steuer.map((z) => ({ satz: z.satz, bruttoCent: -z.bruttoCent, steuerCent: -z.steuerCent, nettoCent: -z.nettoCent })),
  };
}

// ---------- Anzeige ----------

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export const euro = (cent: number) => EURO.format(cent / 100);

/** „12,50“, „12.50“, „1.234,5“ → Cent; ungültig → null */
export function centAus(text: string): number | null {
  let t = text.replace(/[\s€]/g, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Cent → Eingabetext ohne Währung, z. B. 1250 → „12,50“ */
export const centText = (cent: number) => (cent / 100).toFixed(2).replace('.', ',');

export function etageText(l: Pick<Lieferung, 'etage' | 'aufzug'>): string {
  if (l.etage === null) return '';
  if (l.etage < 0) return 'bis Bordsteinkante';
  if (l.etage === 0) return 'Erdgeschoss';
  return `${l.etage}. OG ${l.aufzug ? 'mit' : 'ohne'} Aufzug`;
}

export const anschriftZeilen = (a: Anschrift) =>
  [a.anrede, a.name, a.zusatz, a.strasse, `${a.plz} ${a.ort}`.trim()].filter(Boolean);

export const datumDeutsch = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
