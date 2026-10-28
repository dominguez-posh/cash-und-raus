import net from 'node:net';
import type { FastifyRequest } from 'fastify';
import { config } from './config.ts';

/** Entfernt die IPv4-in-IPv6-Schreibweise (::ffff:1.2.3.4). */
export function normalisieren(ip: string): string {
  const t = ip.trim();
  return t.toLowerCase().startsWith('::ffff:') && net.isIPv4(t.slice(7)) ? t.slice(7) : t;
}

/** Entfernt eine Portangabe: 1.2.3.4:5678 oder [::1]:5678. */
function ohnePort(eintrag: string): string {
  const v4 = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(eintrag);
  if (v4) return v4[1]!;
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(eintrag);
  return v6 ? v6[1]! : eintrag;
}

export function clientIp(req: FastifyRequest): string {
  if (config.hinterTlsProxy) {
    // Der Proxy hängt die echte Adresse an; nur der letzte Eintrag ist vertrauenswürdig.
    const kopf = req.headers['x-forwarded-for'];
    const letzte = (Array.isArray(kopf) ? kopf.join(',') : (kopf ?? '')).split(',').map((s) => s.trim()).filter(Boolean).at(-1);
    if (letzte) return normalisieren(ohnePort(letzte));
  }
  return normalisieren(req.socket.remoteAddress ?? '');
}

/** Prüft einen Eintrag (IP oder CIDR). Gibt eine Fehlermeldung zurück oder null. */
export function bereichPruefen(eintrag: string): string | null {
  const [adresse, praefix, rest] = eintrag.trim().split('/');
  if (rest !== undefined || !adresse) return `„${eintrag}“ ist keine gültige Adresse`;
  const familie = net.isIP(adresse);
  if (!familie) return `„${adresse}“ ist keine gültige IP-Adresse`;
  if (praefix !== undefined) {
    const n = Number(praefix);
    const max = familie === 4 ? 32 : 128;
    if (!/^\d+$/.test(praefix) || n < 0 || n > max) return `Präfix /${praefix} ist ungültig (0–${max})`;
  }
  return null;
}

/** Liegt die IP in einem der Bereiche? Ungültige Einträge werden übersprungen. */
export function ipInBereichen(ip: string, bereiche: string[]): boolean {
  const adresse = normalisieren(ip);
  const familie = net.isIP(adresse);
  if (!familie) return false;
  const typ = familie === 4 ? 'ipv4' : 'ipv6';
  const liste = new net.BlockList();
  for (const b of bereiche) {
    if (bereichPruefen(b)) continue;
    const [a, p] = b.trim().split('/');
    if (net.isIP(a!) !== familie) continue;
    if (p === undefined) liste.addAddress(a!, typ);
    else liste.addSubnet(a!, Number(p), typ);
  }
  return liste.check(adresse, typ);
}
