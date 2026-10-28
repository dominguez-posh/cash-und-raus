// Artikel und Lager (Stufe 5). Mengen als Zahl (auch 0,5 möglich), Preise in Cent.
import type { Rolle } from './types.ts';

export const LAGER_ROLLEN: Rolle[] = ['admin', 'filialleitung', 'lager'];

export const BUCHUNGSARTEN = ['wareneingang', 'verkauf', 'storno', 'umlagerung', 'inventur', 'korrektur'] as const;
export type Buchungsart = (typeof BUCHUNGSARTEN)[number];
export const BUCHUNGSART_NAMEN: Record<Buchungsart, string> = {
  wareneingang: 'Wareneingang',
  verkauf: 'Verkauf',
  storno: 'Storno',
  umlagerung: 'Umlagerung',
  inventur: 'Inventur',
  korrektur: 'Korrektur',
};

export interface Lagerort {
  id: number;
  name: string;
  /** Lager einer Filiale; null = zentral */
  filialeId: number | null;
  aktiv: boolean;
}

export interface Artikel {
  id: number;
  nummer: string;
  bezeichnung: string;
  preisCent: number;
  ust: number;
  /** Lagerort, aus dem standardmäßig abgebucht wird */
  lagerortId: number | null;
  aktiv: boolean;
  /** Summe über alle Lagerorte */
  bestand: number;
}

export interface Bestand {
  artikelId: number;
  nummer: string;
  bezeichnung: string;
  lagerortId: number;
  lagerort: string;
  menge: number;
}

export interface Lagerbuchung {
  id: number;
  zeit: string;
  art: Buchungsart;
  artikelId: number;
  bezeichnung: string;
  lagerortId: number;
  lagerort: string;
  menge: number;
  bezug: string;
  text: string;
  person: string;
}
