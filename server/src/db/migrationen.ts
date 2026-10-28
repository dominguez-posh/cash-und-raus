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
