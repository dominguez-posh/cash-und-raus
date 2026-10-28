import type { Generated } from 'kysely';

// Plattform-DB: Mandanten, SAML-Anbindung, lokale Konten, Sitzungen.
export interface PlattformDB {
  mandant: {
    id: string;
    name: string;
    aktiv: number;
    erstellt_am: string;
  };
  mandant_saml: {
    mandant_id: string;
    idp_entity_id: string;
    idp_sso_url: string;
    idp_zertifikate: string;
    email_domaenen: string;
    aktiv: number;
  };
  lokales_konto: {
    benutzername: string;
    name: string;
    passwort_hash: string;
    totp_secret: string | null;
    totp_zaehler: number;
    recovery_hashes: string;
    passkeys: string;
    aktiv: number;
    erstellt_am: string;
    letzte_anmeldung: string | null;
  };
  sitzung: {
    id: string;
    art: 'lokal' | 'saml';
    email: string;
    name: string;
    plattform_admin: number;
    mfa_offen: number;
    challenge: string | null;
    challenge_bis: string | null;
    mandant_id: string | null;
    benutzer_id: number | null;
    filiale_id: number | null;
    filiale_per_ip: number;
    laeuft_ab: string;
    erstellt_am: string;
  };
  plattform_protokoll: {
    id: Generated<number>;
    zeit: string;
    person: string;
    aktion: string;
    objekt: string;
    details: string;
  };
}

// Mandanten-DB: eine Datei je Mandant.
export interface MandantDB {
  einstellungen: {
    id: number;
    daten: string;
    logo: Buffer | null;
    logo_mime: string | null;
  };
  filiale: {
    id: Generated<number>;
    kuerzel: string;
    name: string;
    strasse: string;
    plz: string;
    ort: string;
    telefon: string;
    fax: string;
    email: string;
    ip_bereiche: string;
    aktiv: number;
  };
  benutzer: {
    id: Generated<number>;
    email: string;
    name: string;
    rollen: string;
    alle_filialen: number;
    aktiv: number;
    entra_oid: string | null;
    letzte_anmeldung: string | null;
  };
  benutzer_filiale: {
    benutzer_id: number;
    filiale_id: number;
  };
  protokoll: {
    id: Generated<number>;
    zeit: string;
    person: string;
    aktion: string;
    objekt: string;
    details: string;
  };
  nummernkreis: {
    filiale_id: number;
    jahr: number;
    letzte: number;
  };
  vorgang: {
    id: Generated<number>;
    art: 'rechnung' | 'storno';
    status: 'entwurf' | 'festgeschrieben';
    nummer: string | null;
    filiale_id: number;
    jahr: number | null;
    laufnummer: number | null;
    bezug_id: number | null;
    datum: string;
    daten: string;
    summen: string;
    brutto_cent: number;
    kunde_suche: string;
    sachbearbeiter: string;
    storno_grund: string;
    erstellt_von: string;
    erstellt_am: string;
    geaendert_am: string;
    festgeschrieben_am: string | null;
  };
  zahlung: {
    id: Generated<number>;
    vorgang_id: number;
    zeit: string;
    betrag_cent: number;
    mittel: 'bar' | 'ec' | 'ueberweisung';
    zweck: 'anzahlung' | 'restzahlung' | 'erstattung';
    kassen_bon: string;
    person: string;
  };
  dokument: {
    id: Generated<number>;
    vorgang_id: number;
    zahlung_id: number | null;
    art: 'rechnung' | 'quittung';
    erstellt_am: string;
    sha256: string;
    pdf: Buffer;
  };
}
