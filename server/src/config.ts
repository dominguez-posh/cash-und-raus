import path from 'node:path';

function flag(name: string): boolean {
  return ['1', 'true', 'ja', 'yes'].includes((process.env[name] ?? '').toLowerCase());
}

const produktion = process.env.NODE_ENV === 'production';

export const config = {
  produktion,
  port: Number(process.env.CR_PORT ?? 3000),
  host: process.env.CR_HOST ?? (produktion ? '0.0.0.0' : '127.0.0.1'),
  /** Öffentliche Adresse, z. B. https://kasse.example.de; Grundlage für SAML (Entity-ID, ACS-URL). */
  publicUrl: (process.env.CR_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  datenVerzeichnis: path.resolve(process.env.CR_DATA_DIR ?? 'data'),
  webVerzeichnis: path.resolve(process.env.CR_WEB_DIR ?? 'dist/public'),
  /** WAL lokal; auf Azure Files (SMB) DELETE, weil WAL dort keinen gemeinsamen Speicher hat. */
  sqliteJournal: (process.env.CR_SQLITE_JOURNAL ?? 'WAL').toUpperCase() === 'DELETE' ? 'DELETE' : 'WAL',
  /** Hinter einem TLS-Proxy (Azure): Client-IP ist der letzte Eintrag in X-Forwarded-For, Cookies nur über HTTPS. */
  hinterTlsProxy: flag('CR_BEHIND_TLS_PROXY'),
  sitzungStunden: Number(process.env.CR_SESSION_HOURS ?? 12),
  produktName: process.env.CR_PRODUCT_NAME ?? 'Cash & Raus',
};
