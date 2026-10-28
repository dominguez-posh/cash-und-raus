// Passwörter (scrypt) und Anmeldebremse; nach dem Vorbild von hrdnr (server/src/auth.ts).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function passwortHash(geheim: string): string {
  const salz = randomBytes(16);
  const N = 2 ** 15;
  const h = scryptSync(geheim, salz, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${salz.toString('base64')}$${h.toString('base64')}`;
}

export function passwortPruefen(geheim: string, gespeichert: string | null | undefined): boolean {
  if (!gespeichert) return false;
  const [alg, n, salz, hash] = gespeichert.split('$');
  if (alg !== 'scrypt' || !n || !salz || !hash) return false;
  const erwartet = Buffer.from(hash, 'base64');
  const ist = scryptSync(geheim, Buffer.from(salz, 'base64'), erwartet.length, { N: Number(n), r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(erwartet, ist);
}

/** Vergleichswert, damit eine Anmeldung mit unbekanntem Benutzernamen gleich lange dauert. */
export const DUMMY_HASH = passwortHash(randomBytes(16).toString('hex'));

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Mindestens 12 Zeichen, nicht nur Buchstaben oder nur Ziffern. */
export function passwortProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Das Passwort muss mindestens 12 Zeichen lang sein.';
  if (pw.length > 256) return 'Das Passwort ist zu lang.';
  if (/^[A-Za-zÄÖÜäöüß]+$/.test(pw) || /^\d+$/.test(pw)) return 'Das Passwort muss Buchstaben und Ziffern oder Sonderzeichen enthalten.';
  return null;
}

/** Anmeldebremse je Client-Adresse: nach 3 Fehlversuchen exponentiell wachsende Sperre (max. 15 min). */
export class Bremse {
  private fehler = new Map<string, { n: number; bis: number }>();
  gesperrt(ip: string): number {
    const f = this.fehler.get(ip);
    return f && f.bis > Date.now() ? Math.ceil((f.bis - Date.now()) / 1000) : 0;
  }
  fehlschlag(ip: string): void {
    const f = this.fehler.get(ip) ?? { n: 0, bis: 0 };
    f.n++;
    f.bis = f.n <= 3 ? 0 : Date.now() + Math.min(15 * 60, 2 ** (f.n - 3)) * 1000;
    this.fehler.set(ip, f);
  }
  erfolg(ip: string): void {
    this.fehler.delete(ip);
  }
}
