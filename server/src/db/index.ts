import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { config } from '../config.ts';
import { mandantMigrationen, migrieren, plattformMigrationen } from './migrationen.ts';
import type { MandantDB, PlattformDB } from './schema.ts';

export const MANDANT_ID_MUSTER = /^[a-z0-9][a-z0-9-]{1,39}$/;

function oeffnen(datei: string, migrationen: string[]): Database.Database {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const db = new Database(datei);
  db.pragma(`journal_mode = ${config.sqliteJournal}`);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrieren(db, migrationen);
  return db;
}

let plattform: Kysely<PlattformDB> | undefined;

export function plattformDb(): Kysely<PlattformDB> {
  plattform ??= new Kysely<PlattformDB>({
    dialect: new SqliteDialect({
      database: oeffnen(path.join(config.datenVerzeichnis, 'plattform.sqlite'), plattformMigrationen),
    }),
  });
  return plattform;
}

const mandanten = new Map<string, Kysely<MandantDB>>();

export function mandantDatei(mandantId: string): string {
  if (!MANDANT_ID_MUSTER.test(mandantId)) throw new Error(`Ungültige Mandanten-ID: ${mandantId}`);
  return path.join(config.datenVerzeichnis, 'mandanten', `${mandantId}.sqlite`);
}

export function mandantDb(mandantId: string): Kysely<MandantDB> {
  let db = mandanten.get(mandantId);
  if (!db) {
    db = new Kysely<MandantDB>({
      dialect: new SqliteDialect({ database: oeffnen(mandantDatei(mandantId), mandantMigrationen) }),
    });
    mandanten.set(mandantId, db);
  }
  return db;
}

export async function alleSchliessen(): Promise<void> {
  for (const db of mandanten.values()) await db.destroy();
  mandanten.clear();
  await plattform?.destroy();
  plattform = undefined;
}
