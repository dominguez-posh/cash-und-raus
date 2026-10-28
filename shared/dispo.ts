// Dispo und Touren (Stufe 6).
import type { Rolle } from './types.ts';
import type { Lieferung, Position } from './verkauf.ts';

export const DISPO_ROLLEN: Rolle[] = ['admin', 'filialleitung', 'dispo'];
export const FAHRER_ROLLEN: Rolle[] = [...DISPO_ROLLEN, 'fahrer'];

export const AUFTRAG_STATUS = ['offen', 'geplant', 'geliefert', 'storniert'] as const;
export type AuftragStatus = (typeof AUFTRAG_STATUS)[number];

export const TOUR_STATUS = ['geplant', 'unterwegs', 'fertig'] as const;
export type TourStatus = (typeof TOUR_STATUS)[number];
export const TOUR_STATUS_NAMEN: Record<TourStatus, string> = { geplant: 'geplant', unterwegs: 'unterwegs', fertig: 'fertig' };

export interface Fahrzeug {
  id: number;
  name: string;
  kennzeichen: string;
  /** Für die spätere Anbindung eines GPS-Trackers */
  trackerId: string;
  aktiv: boolean;
}

export interface Lieferauftrag {
  vorgangId: number;
  nummer: string;
  art: 'lieferung' | 'abholung';
  status: AuftragStatus;
  datum: string | null;
  filiale: { id: number; kuerzel: string };
  kunde: { name: string; strasse: string; plz: string; ort: string; telefon: string };
  lieferung: Lieferung;
  positionen: Position[];
  /** bei Lieferung zu kassieren */
  offenCent: number;
  tourId: number | null;
  reihenfolge: number | null;
  lat: number | null;
  lng: number | null;
  geoStatus: 'offen' | 'ok' | 'fehler';
  geliefertAm: string | null;
  geliefertVon: string;
}

export interface Tour {
  id: number;
  datum: string;
  fahrzeug: { id: number; name: string } | null;
  fahrer: { id: number; name: string } | null;
  status: TourStatus;
  bemerkung: string;
  streckeKm: number | null;
  dauerMin: number | null;
  stopps: Lieferauftrag[];
}

export interface Route {
  km: number;
  minuten: number;
  /** [lat, lng] entlang der Strecke */
  linie: [number, number][];
}

/** Lieferkosten aus der Entfernung: Grundpreis, ab freiKm je km Aufschlag */
export function lieferkostenVorschlag(km: number, e: { grundCent: number; freiKm: number; proKmCent: number }): number {
  return e.grundCent + Math.max(0, Math.ceil(km - e.freiKm)) * e.proKmCent;
}

export const navigationsLink = (a: { lat: number | null; lng: number | null; kunde: { strasse: string; plz: string; ort: string } }) =>
  a.lat !== null && a.lng !== null
    ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${a.kunde.strasse}, ${a.kunde.plz} ${a.kunde.ort}`)}`;
