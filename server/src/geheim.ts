// Geheimnisse in der Datenbank (z. B. Client-Secrets): AES-256-GCM mit dem Server-Schlüssel CR_SECRET_KEY.
import crypto from 'node:crypto';
import { config } from './config.ts';
import { HttpFehler } from './sitzung.ts';

function schluessel(): Buffer {
  if (!config.secretKey) throw new HttpFehler(503, 'Auf dem Server ist kein CR_SECRET_KEY gesetzt; Geheimnisse können nicht gespeichert werden.');
  return crypto.createHash('sha256').update(config.secretKey).digest();
}

export function verschluesseln(klartext: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', schluessel(), iv);
  const daten = Buffer.concat([c.update(klartext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), daten.toString('base64url')].join('.');
}

export function entschluesseln(text: string): string {
  const [v, iv, tag, daten] = text.split('.');
  if (v !== 'v1' || !iv || !tag || !daten) throw new HttpFehler(500, 'Gespeichertes Geheimnis hat ein unbekanntes Format');
  const d = crypto.createDecipheriv('aes-256-gcm', schluessel(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(daten, 'base64url')), d.final()]).toString('utf8');
}
