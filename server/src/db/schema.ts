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
  plattform_einstellungen: {
    schluessel: string;
    wert: string;
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
    wechselgeld_cent: Generated<number>;
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
  graph_konfig: {
    id: number;
    tenant_id: string;
    client_id: string;
    client_secret_enc: string;
    absender: string;
    aktiv: number;
    letzter_test: string | null;
  };
  email_versand: {
    id: Generated<number>;
    vorgang_id: number;
    zeit: string;
    an: string;
    betreff: string;
    anhaenge: string;
    person: string;
  };
  kassenbeleg: {
    id: Generated<number>;
    filiale_id: number;
    datum: string;
    zeit: string;
    art: 'einnahme' | 'ausgabe';
    grund: string;
    text: string;
    betrag_cent: number;
    person: string;
    storno_von: number | null;
  };
  kassenabschluss: {
    id: Generated<number>;
    filiale_id: number;
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
  };
  lagerort: {
    id: Generated<number>;
    name: string;
    filiale_id: number | null;
    aktiv: number;
  };
  artikel: {
    id: Generated<number>;
    nummer: string;
    bezeichnung: string;
    preis_cent: number;
    ust: number;
    lagerort_id: number | null;
    aktiv: number;
    suche: string;
  };
  bestand: {
    artikel_id: number;
    lagerort_id: number;
    menge: number;
  };
  lagerbuchung: {
    id: Generated<number>;
    zeit: string;
    art: 'wareneingang' | 'verkauf' | 'storno' | 'umlagerung' | 'inventur' | 'korrektur';
    artikel_id: number;
    lagerort_id: number;
    menge: number;
    bezug: string;
    text: string;
    person: string;
  };
  fahrzeug: {
    id: Generated<number>;
    name: string;
    kennzeichen: string;
    tracker_id: string;
    aktiv: number;
  };
  tour: {
    id: Generated<number>;
    datum: string;
    fahrzeug_id: number | null;
    fahrer_benutzer_id: number | null;
    status: 'geplant' | 'unterwegs' | 'fertig';
    bemerkung: string;
    strecke_km: number | null;
    dauer_min: number | null;
    erstellt_von: string;
    erstellt_am: string;
  };
  lieferauftrag: {
    vorgang_id: number;
    art: 'lieferung' | 'abholung';
    status: 'offen' | 'geplant' | 'geliefert' | 'storniert';
    datum: string | null;
    tour_id: number | null;
    reihenfolge: number | null;
    lat: number | null;
    lng: number | null;
    geo_status: 'offen' | 'ok' | 'fehler';
    geliefert_am: string | null;
    geliefert_von: string;
  };
  geo_cache: {
    adresse: string;
    lat: number | null;
    lng: number | null;
    zeit: string;
  };
}
