// Kasse: Belege, Tagesabschluss mit Zählprotokoll. Beträge in Cent.
import type { Rolle } from './types.ts';
import type { Zahlmittel } from './verkauf.ts';

export const KASSE_ROLLEN: Rolle[] = ['admin', 'filialleitung', 'verkauf'];
export const ABSCHLUSS_ROLLEN: Rolle[] = ['admin', 'filialleitung'];

export const BELEG_ARTEN = ['einnahme', 'ausgabe'] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number];
export const BELEG_ART_NAMEN: Record<BelegArt, string> = { einnahme: 'Einnahme', ausgabe: 'Ausgabe' };

/** Stückelung für das Zählprotokoll (Cent) */
export const SCHEINE = [50000, 20000, 10000, 5000, 2000, 1000, 500] as const;
export const MUENZEN = [200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Anzahl je Stückelung, Schlüssel = Wert in Cent */
export type Zaehlung = Record<string, number>;

export function zaehlungSumme(z: Zaehlung): number {
  return Object.entries(z).reduce((s, [wert, anzahl]) => s + Number(wert) * (anzahl || 0), 0);
}

export interface Kassenbeleg {
  id: number;
  nummer: string;
  datum: string;
  zeit: string;
  art: BelegArt;
  grund: string;
  text: string;
  betragCent: number;
  person: string;
  /** Gegenbeleg zu einem früheren Beleg */
  stornoVon: number | null;
  /** wurde durch diesen Gegenbeleg aufgehoben */
  storniertDurch: number | null;
}

export interface Barzahlung {
  zahlungId: number;
  vorgangId: number;
  nummer: string;
  zeit: string;
  kunde: string;
  zweck: string;
  mittel: Zahlmittel;
  betragCent: number;
  person: string;
}

export interface Kassenabschluss {
  id: number;
  datum: string;
  zeit: string;
  filiale: { id: number; kuerzel: string; name: string };
  anfangCent: number;
  barZahlungenCent: number;
  einnahmenCent: number;
  ausgabenCent: number;
  sollCent: number;
  zaehlung: Zaehlung;
  istCent: number;
  differenzCent: number;
  /** Zur Bank / aus der Kasse genommen, damit das Wechselgeld bleibt */
  entnahmeCent: number;
  zBonNr: string;
  zBarCent: number | null;
  ecCent: number;
  bemerkung: string;
  uebergebenVon: string;
  uebernommenVon: string;
  person: string;
}

/** Stand eines Kassentages */
export interface Kassentag {
  filiale: { id: number; kuerzel: string; name: string; wechselgeldCent: number };
  datum: string;
  zahlungen: Barzahlung[];
  belege: Kassenbeleg[];
  anfangCent: number;
  barZahlungenCent: number;
  ecCent: number;
  einnahmenCent: number;
  ausgabenCent: number;
  sollCent: number;
  abschluss: Kassenabschluss | null;
}

export function kassentagRechnen(t: Pick<Kassentag, 'zahlungen' | 'belege' | 'anfangCent'>) {
  const barZahlungenCent = t.zahlungen.filter((z) => z.mittel === 'bar').reduce((s, z) => s + z.betragCent, 0);
  const ecCent = t.zahlungen.filter((z) => z.mittel === 'ec').reduce((s, z) => s + z.betragCent, 0);
  const gueltig = t.belege.filter((b) => !b.storniertDurch && !b.stornoVon);
  const einnahmenCent = gueltig.filter((b) => b.art === 'einnahme').reduce((s, b) => s + b.betragCent, 0);
  const ausgabenCent = gueltig.filter((b) => b.art === 'ausgabe').reduce((s, b) => s + b.betragCent, 0);
  return { barZahlungenCent, ecCent, einnahmenCent, ausgabenCent, sollCent: t.anfangCent + barZahlungenCent + einnahmenCent - ausgabenCent };
}
