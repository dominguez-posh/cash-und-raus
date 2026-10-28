// Typen, die Server und Web-App gemeinsam verwenden.

export const ROLLEN = ['admin', 'filialleitung', 'verkauf', 'dispo', 'lager', 'fahrer'] as const;
export type Rolle = (typeof ROLLEN)[number];

export const ROLLEN_NAMEN: Record<Rolle, string> = {
  admin: 'Administration',
  filialleitung: 'Filialleitung',
  verkauf: 'Verkauf',
  dispo: 'Dispo',
  lager: 'Lager',
  fahrer: 'Fahrer',
};

export interface SamlKonfig {
  idpEntityId: string;
  idpSsoUrl: string;
  /** Signaturzertifikate des IdP (Base64/PEM); mehrere für den Zertifikatswechsel */
  idpZertifikate: string[];
  /** E-Mail-Domänen, über die Benutzer beim Login dem Mandanten zugeordnet werden */
  emailDomaenen: string[];
  aktiv: boolean;
}

/** Werte, die beim IdP (Entra: Unternehmensanwendung → SAML) einzutragen sind */
export interface SamlSpDaten {
  entityId: string;
  acsUrl: string;
  metadatenUrl: string;
}

export interface Mandant {
  id: string;
  name: string;
  aktiv: boolean;
  erstelltAm: string;
  saml: SamlKonfig | null;
  sp: SamlSpDaten;
}

export interface LokalesKonto {
  benutzername: string;
  name: string;
  aktiv: boolean;
  totp: boolean;
  passkeys: { id: string; name: string; erstelltAm: string; zuletztAm?: string }[];
  recoveryUebrig: number;
  letzteAnmeldung: string | null;
}

/** E-Mail-Versand über Microsoft Graph (Mail.Send als Anwendung, Absender-Postfach im Tenant des Mandanten) */
export interface GraphKonfig {
  tenantId: string;
  clientId: string;
  /** wird nie zurückgegeben; true = hinterlegt */
  clientSecretVorhanden: boolean;
  absender: string;
  aktiv: boolean;
  letzterTest: string | null;
}

export interface Einstellungen {
  firmenname: string;
  strasse: string;
  plz: string;
  ort: string;
  telefon: string;
  email: string;
  web: string;
  steuernummer: string;
  ustId: string;
  bankName: string;
  iban: string;
  bic: string;
  fusstext: string;
  /** Standardsatz für neue Positionen, Lieferung und Montage */
  ustSatz: number;
  /** Wählbare Sätze je Position */
  ustSaetze: number[];
  /** Platzhalter: {F} Filialkürzel, {N} laufende Nummer, {JJ} / {JJJJ} Jahr */
  nummernformat: string;
  rabattarten: { kuerzel: string; name: string; prozent: number }[];
  /** Vorschläge für das Lieferzeitfenster */
  lieferzeiten: string[];
  /** Hinweistexte zu Positions-Kennzeichen, z. B. '*' */
  hinweise: { zeichen: string; text: string }[];
  /** Gründe für Kassenbelege (Auswahl) */
  belegGruende: string[];
  /** Lieferkosten-Vorschlag nach Entfernung: Grundpreis, ab freiKm je angefangenem km Aufschlag */
  lieferkosten: { grundCent: number; freiKm: number; proKmCent: number };
  hatLogo: boolean;
}

export interface Filiale {
  id: number;
  kuerzel: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  telefon: string;
  fax: string;
  email: string;
  /** IP-Adressen oder CIDR-Bereiche, z. B. 203.0.113.10 oder 203.0.113.0/28 */
  ipBereiche: string[];
  aktiv: boolean;
  /** Fester Anfangsbestand der Barkasse (Wechselgeld) */
  wechselgeldCent: number;
}

export interface Benutzer {
  id: number;
  email: string;
  name: string;
  rollen: Rolle[];
  alleFilialen: boolean;
  filialIds: number[];
  aktiv: boolean;
  entraVerknuepft: boolean;
  letzteAnmeldung: string | null;
}

export interface ProtokollEintrag {
  id: number;
  zeit: string;
  person: string;
  aktion: string;
  objekt: string;
  details: string;
}

export interface Ich {
  art: 'lokal' | 'saml';
  name: string;
  email: string;
  /** Lokales Konto nach dem Passwort: zweiter Faktor fehlt noch ('einrichten' = noch keiner hinterlegt) */
  mfa: null | { status: 'pruefen' | 'einrichten'; totp: boolean; passkey: boolean };
  plattformAdmin: boolean;
  mandant: { id: string; name: string; hatLogo: boolean } | null;
  rollen: Rolle[];
  filiale: { id: number; kuerzel: string; name: string; perIp: boolean } | null;
  filialen: { id: number; kuerzel: string; name: string }[];
}

export interface AuthInfo {
  produktName: string;
  /** Noch kein Admin-Konto: die Anmeldeseite zeigt die Ersteinrichtung */
  einrichtung: boolean;
}
