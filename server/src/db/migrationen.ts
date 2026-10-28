import type Database from 'better-sqlite3';

// Migrationen sind reines SQL; der Stand steht in PRAGMA user_version.
// Bestehende Einträge nie ändern, nur neue anhängen.

export const plattformMigrationen: string[] = [
  `
  CREATE TABLE mandant (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aktiv INTEGER NOT NULL DEFAULT 1,
    erstellt_am TEXT NOT NULL
  );
  -- SAML2-Anbindung je Mandant (z. B. Entra-Unternehmensanwendung)
  CREATE TABLE mandant_saml (
    mandant_id TEXT PRIMARY KEY REFERENCES mandant(id) ON DELETE CASCADE,
    idp_entity_id TEXT NOT NULL,
    idp_sso_url TEXT NOT NULL,
    idp_zertifikate TEXT NOT NULL DEFAULT '[]',
    email_domaenen TEXT NOT NULL DEFAULT '[]',
    aktiv INTEGER NOT NULL DEFAULT 0
  );
  -- Lokale Konten (Plattform-Admin, Notfallzugang): Passwort + TOTP oder Passkey
  CREATE TABLE lokales_konto (
    benutzername TEXT PRIMARY KEY COLLATE NOCASE,
    name TEXT NOT NULL,
    passwort_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_zaehler INTEGER NOT NULL DEFAULT -1,
    recovery_hashes TEXT NOT NULL DEFAULT '[]',
    passkeys TEXT NOT NULL DEFAULT '[]',
    aktiv INTEGER NOT NULL DEFAULT 1,
    erstellt_am TEXT NOT NULL,
    letzte_anmeldung TEXT
  );
  CREATE TABLE sitzung (
    id TEXT PRIMARY KEY,
    art TEXT NOT NULL CHECK (art IN ('lokal', 'saml')),
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    plattform_admin INTEGER NOT NULL DEFAULT 0,
    mfa_offen INTEGER NOT NULL DEFAULT 0,
    challenge TEXT,
    challenge_bis TEXT,
    mandant_id TEXT REFERENCES mandant(id) ON DELETE CASCADE,
    benutzer_id INTEGER,
    filiale_id INTEGER,
    filiale_per_ip INTEGER NOT NULL DEFAULT 0,
    laeuft_ab TEXT NOT NULL,
    erstellt_am TEXT NOT NULL
  );
  CREATE INDEX sitzung_laeuft_ab ON sitzung(laeuft_ab);
  CREATE TABLE plattform_protokoll (
    id INTEGER PRIMARY KEY,
    zeit TEXT NOT NULL,
    person TEXT NOT NULL,
    aktion TEXT NOT NULL,
    objekt TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT ''
  );
  CREATE TRIGGER plattform_protokoll_kein_update BEFORE UPDATE ON plattform_protokoll
    BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
  CREATE TRIGGER plattform_protokoll_kein_delete BEFORE DELETE ON plattform_protokoll
    BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
  `,
  // Plattform-Einstellungen (z. B. Entra-Setup-App für die automatische SAML-Einrichtung)
  `
  CREATE TABLE plattform_einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT NOT NULL
  );
  `,
];

export const mandantMigrationen: string[] = [
  `
  CREATE TABLE einstellungen (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    daten TEXT NOT NULL,
    logo BLOB,
    logo_mime TEXT
  );
  CREATE TABLE filiale (
    id INTEGER PRIMARY KEY,
    kuerzel TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    strasse TEXT NOT NULL DEFAULT '',
    plz TEXT NOT NULL DEFAULT '',
    ort TEXT NOT NULL DEFAULT '',
    telefon TEXT NOT NULL DEFAULT '',
    fax TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    ip_bereiche TEXT NOT NULL DEFAULT '[]',
    aktiv INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE benutzer (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    rollen TEXT NOT NULL DEFAULT '[]',
    alle_filialen INTEGER NOT NULL DEFAULT 0,
    aktiv INTEGER NOT NULL DEFAULT 1,
    entra_oid TEXT UNIQUE,
    letzte_anmeldung TEXT
  );
  CREATE TABLE benutzer_filiale (
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    filiale_id INTEGER NOT NULL REFERENCES filiale(id) ON DELETE CASCADE,
    PRIMARY KEY (benutzer_id, filiale_id)
  );
  CREATE TABLE protokoll (
    id INTEGER PRIMARY KEY,
    zeit TEXT NOT NULL,
    person TEXT NOT NULL,
    aktion TEXT NOT NULL,
    objekt TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT ''
  );
  -- Das Protokoll ist unveränderlich (GoBD).
  CREATE TRIGGER protokoll_kein_update BEFORE UPDATE ON protokoll
    BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
  CREATE TRIGGER protokoll_kein_delete BEFORE DELETE ON protokoll
    BEGIN SELECT RAISE(ABORT, 'Protokoll ist unveränderlich'); END;
  `,
  // Stufe 2: Verkauf
  `
  -- Laufende Rechnungsnummer je Filiale und Jahr (lückenlos, Vergabe in der Transaktion des Festschreibens)
  CREATE TABLE nummernkreis (
    filiale_id INTEGER NOT NULL REFERENCES filiale(id),
    jahr INTEGER NOT NULL,
    letzte INTEGER NOT NULL,
    PRIMARY KEY (filiale_id, jahr)
  );
  -- Rechnung oder Storno; Eingaben (Kunde, Positionen, Lieferung, Zahlungsplan) als JSON in daten
  CREATE TABLE vorgang (
    id INTEGER PRIMARY KEY,
    art TEXT NOT NULL CHECK (art IN ('rechnung', 'storno')),
    status TEXT NOT NULL CHECK (status IN ('entwurf', 'festgeschrieben')),
    nummer TEXT UNIQUE,
    filiale_id INTEGER NOT NULL REFERENCES filiale(id),
    jahr INTEGER,
    laufnummer INTEGER,
    bezug_id INTEGER REFERENCES vorgang(id),
    datum TEXT NOT NULL,
    daten TEXT NOT NULL,
    summen TEXT NOT NULL,
    brutto_cent INTEGER NOT NULL,
    kunde_suche TEXT NOT NULL DEFAULT '',
    sachbearbeiter TEXT NOT NULL,
    storno_grund TEXT NOT NULL DEFAULT '',
    erstellt_von TEXT NOT NULL,
    erstellt_am TEXT NOT NULL,
    geaendert_am TEXT NOT NULL,
    festgeschrieben_am TEXT
  );
  CREATE INDEX vorgang_filiale_datum ON vorgang(filiale_id, datum);
  -- Je Rechnung höchstens ein Storno
  CREATE UNIQUE INDEX vorgang_ein_storno ON vorgang(bezug_id) WHERE art = 'storno';
  -- Festgeschriebene Vorgänge sind unveränderlich (GoBD); Korrektur nur per Storno.
  CREATE TRIGGER vorgang_fest_kein_update BEFORE UPDATE ON vorgang WHEN OLD.status = 'festgeschrieben'
    BEGIN SELECT RAISE(ABORT, 'Festgeschriebener Vorgang ist unveränderlich'); END;
  CREATE TRIGGER vorgang_fest_kein_delete BEFORE DELETE ON vorgang WHEN OLD.status = 'festgeschrieben'
    BEGIN SELECT RAISE(ABORT, 'Festgeschriebener Vorgang ist unveränderlich'); END;

  CREATE TABLE zahlung (
    id INTEGER PRIMARY KEY,
    vorgang_id INTEGER NOT NULL REFERENCES vorgang(id),
    zeit TEXT NOT NULL,
    betrag_cent INTEGER NOT NULL,
    mittel TEXT NOT NULL CHECK (mittel IN ('bar', 'ec', 'ueberweisung')),
    zweck TEXT NOT NULL CHECK (zweck IN ('anzahlung', 'restzahlung', 'erstattung')),
    kassen_bon TEXT NOT NULL DEFAULT '',
    person TEXT NOT NULL
  );
  CREATE INDEX zahlung_vorgang ON zahlung(vorgang_id);
  CREATE TRIGGER zahlung_kein_update BEFORE UPDATE ON zahlung
    BEGIN SELECT RAISE(ABORT, 'Zahlungen sind unveränderlich'); END;
  CREATE TRIGGER zahlung_kein_delete BEFORE DELETE ON zahlung
    BEGIN SELECT RAISE(ABORT, 'Zahlungen sind unveränderlich'); END;

  -- Archivierte PDFs (Rechnung beim Festschreiben, Quittung je Zahlung)
  CREATE TABLE dokument (
    id INTEGER PRIMARY KEY,
    vorgang_id INTEGER NOT NULL REFERENCES vorgang(id),
    zahlung_id INTEGER REFERENCES zahlung(id),
    art TEXT NOT NULL CHECK (art IN ('rechnung', 'quittung')),
    erstellt_am TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    pdf BLOB NOT NULL
  );
  CREATE INDEX dokument_vorgang ON dokument(vorgang_id);
  CREATE TRIGGER dokument_kein_update BEFORE UPDATE ON dokument
    BEGIN SELECT RAISE(ABORT, 'Dokumente sind unveränderlich'); END;
  CREATE TRIGGER dokument_kein_delete BEFORE DELETE ON dokument
    BEGIN SELECT RAISE(ABORT, 'Dokumente sind unveränderlich'); END;
  `,
  // Stufe 2b: E-Mail-Versand über Microsoft Graph (App-Registrierung im Entra-Tenant des Mandanten)
  `
  CREATE TABLE graph_konfig (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tenant_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_enc TEXT NOT NULL,
    absender TEXT NOT NULL,
    aktiv INTEGER NOT NULL DEFAULT 0,
    letzter_test TEXT
  );
  CREATE TABLE email_versand (
    id INTEGER PRIMARY KEY,
    vorgang_id INTEGER NOT NULL REFERENCES vorgang(id),
    zeit TEXT NOT NULL,
    an TEXT NOT NULL,
    betreff TEXT NOT NULL,
    anhaenge TEXT NOT NULL,
    person TEXT NOT NULL
  );
  CREATE INDEX email_versand_vorgang ON email_versand(vorgang_id);
  `,
  // Stufe 3: Kasse
  `
  ALTER TABLE filiale ADD COLUMN wechselgeld_cent INTEGER NOT NULL DEFAULT 0;
  -- Kassenbelege (Einnahme/Ausgabe); Korrektur nur per Gegenbeleg (storno_von)
  CREATE TABLE kassenbeleg (
    id INTEGER PRIMARY KEY,
    filiale_id INTEGER NOT NULL REFERENCES filiale(id),
    datum TEXT NOT NULL,
    zeit TEXT NOT NULL,
    art TEXT NOT NULL CHECK (art IN ('einnahme', 'ausgabe')),
    grund TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    betrag_cent INTEGER NOT NULL CHECK (betrag_cent > 0),
    person TEXT NOT NULL,
    storno_von INTEGER REFERENCES kassenbeleg(id)
  );
  CREATE INDEX kassenbeleg_tag ON kassenbeleg(filiale_id, datum);
  CREATE UNIQUE INDEX kassenbeleg_ein_storno ON kassenbeleg(storno_von) WHERE storno_von IS NOT NULL;
  CREATE TRIGGER kassenbeleg_kein_update BEFORE UPDATE ON kassenbeleg
    BEGIN SELECT RAISE(ABORT, 'Kassenbelege sind unveränderlich'); END;
  CREATE TRIGGER kassenbeleg_kein_delete BEFORE DELETE ON kassenbeleg
    BEGIN SELECT RAISE(ABORT, 'Kassenbelege sind unveränderlich'); END;
  -- Tagesabschluss je Filiale und Tag
  CREATE TABLE kassenabschluss (
    id INTEGER PRIMARY KEY,
    filiale_id INTEGER NOT NULL REFERENCES filiale(id),
    datum TEXT NOT NULL,
    zeit TEXT NOT NULL,
    anfang_cent INTEGER NOT NULL,
    bar_zahlungen_cent INTEGER NOT NULL,
    einnahmen_cent INTEGER NOT NULL,
    ausgaben_cent INTEGER NOT NULL,
    soll_cent INTEGER NOT NULL,
    zaehlung TEXT NOT NULL,
    ist_cent INTEGER NOT NULL,
    differenz_cent INTEGER NOT NULL,
    entnahme_cent INTEGER NOT NULL,
    z_bon_nr TEXT NOT NULL DEFAULT '',
    z_bar_cent INTEGER,
    ec_cent INTEGER NOT NULL DEFAULT 0,
    bemerkung TEXT NOT NULL DEFAULT '',
    uebergeben_von TEXT NOT NULL DEFAULT '',
    uebernommen_von TEXT NOT NULL DEFAULT '',
    person TEXT NOT NULL,
    UNIQUE (filiale_id, datum)
  );
  CREATE TRIGGER kassenabschluss_kein_update BEFORE UPDATE ON kassenabschluss
    BEGIN SELECT RAISE(ABORT, 'Kassenabschlüsse sind unveränderlich'); END;
  CREATE TRIGGER kassenabschluss_kein_delete BEFORE DELETE ON kassenabschluss
    BEGIN SELECT RAISE(ABORT, 'Kassenabschlüsse sind unveränderlich'); END;
  `,
  // Stufe 5: Artikel und Lager
  `
  CREATE TABLE lagerort (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    filiale_id INTEGER REFERENCES filiale(id),
    aktiv INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE artikel (
    id INTEGER PRIMARY KEY,
    nummer TEXT NOT NULL DEFAULT '',
    bezeichnung TEXT NOT NULL,
    preis_cent INTEGER NOT NULL DEFAULT 0,
    ust REAL NOT NULL,
    lagerort_id INTEGER REFERENCES lagerort(id),
    aktiv INTEGER NOT NULL DEFAULT 1,
    suche TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX artikel_nummer ON artikel(nummer) WHERE nummer != '';
  -- Bestand je Artikel und Lagerort (Summe der Buchungen)
  CREATE TABLE bestand (
    artikel_id INTEGER NOT NULL REFERENCES artikel(id),
    lagerort_id INTEGER NOT NULL REFERENCES lagerort(id),
    menge REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (artikel_id, lagerort_id)
  );
  CREATE TABLE lagerbuchung (
    id INTEGER PRIMARY KEY,
    zeit TEXT NOT NULL,
    art TEXT NOT NULL CHECK (art IN ('wareneingang', 'verkauf', 'storno', 'umlagerung', 'inventur', 'korrektur')),
    artikel_id INTEGER NOT NULL REFERENCES artikel(id),
    lagerort_id INTEGER NOT NULL REFERENCES lagerort(id),
    menge REAL NOT NULL,
    bezug TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    person TEXT NOT NULL
  );
  CREATE INDEX lagerbuchung_artikel ON lagerbuchung(artikel_id, id);
  CREATE TRIGGER lagerbuchung_kein_update BEFORE UPDATE ON lagerbuchung
    BEGIN SELECT RAISE(ABORT, 'Lagerbuchungen sind unveränderlich'); END;
  CREATE TRIGGER lagerbuchung_kein_delete BEFORE DELETE ON lagerbuchung
    BEGIN SELECT RAISE(ABORT, 'Lagerbuchungen sind unveränderlich'); END;
  `,
  // Stufe 6: Dispo und Touren
  `
  CREATE TABLE fahrzeug (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kennzeichen TEXT NOT NULL DEFAULT '',
    tracker_id TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE tour (
    id INTEGER PRIMARY KEY,
    datum TEXT NOT NULL,
    fahrzeug_id INTEGER REFERENCES fahrzeug(id),
    fahrer_benutzer_id INTEGER REFERENCES benutzer(id),
    status TEXT NOT NULL CHECK (status IN ('geplant', 'unterwegs', 'fertig')),
    bemerkung TEXT NOT NULL DEFAULT '',
    strecke_km REAL,
    dauer_min INTEGER,
    erstellt_von TEXT NOT NULL,
    erstellt_am TEXT NOT NULL
  );
  CREATE INDEX tour_datum ON tour(datum);
  -- Lieferung/Abholung eines festgeschriebenen Vorgangs als Auftrag für die Dispo
  CREATE TABLE lieferauftrag (
    vorgang_id INTEGER PRIMARY KEY REFERENCES vorgang(id),
    art TEXT NOT NULL CHECK (art IN ('lieferung', 'abholung')),
    status TEXT NOT NULL CHECK (status IN ('offen', 'geplant', 'geliefert', 'storniert')),
    datum TEXT,
    tour_id INTEGER REFERENCES tour(id),
    reihenfolge INTEGER,
    lat REAL,
    lng REAL,
    geo_status TEXT NOT NULL DEFAULT 'offen' CHECK (geo_status IN ('offen', 'ok', 'fehler')),
    geliefert_am TEXT,
    geliefert_von TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX lieferauftrag_datum ON lieferauftrag(datum, status);
  CREATE INDEX lieferauftrag_tour ON lieferauftrag(tour_id);
  -- Geocoding-Zwischenspeicher (Adresse → Koordinaten), schont den externen Dienst
  CREATE TABLE geo_cache (
    adresse TEXT PRIMARY KEY,
    lat REAL,
    lng REAL,
    zeit TEXT NOT NULL
  );
  `,
];

export function migrieren(db: Database.Database, migrationen: string[]): void {
  const stand = db.pragma('user_version', { simple: true }) as number;
  for (let i = stand; i < migrationen.length; i++) {
    db.transaction(() => {
      db.exec(migrationen[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
