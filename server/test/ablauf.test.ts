// Durchlauf der Kernabläufe gegen eine frische Datenbank (fastify.inject, kein Netzwerk).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const daten = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
process.env.CR_DATA_DIR = daten;
process.env.CR_WEB_DIR = path.join(daten, 'kein-web');
process.env.CR_ADMIN_USER = 'notfall';
process.env.CR_ADMIN_PASSWORD = 'Test-Passwort-123';

const { appBauen } = await import('../src/app.ts');
const { startAdminAnlegen } = await import('../src/auth/lokal.ts');
const { totpAt, totpCounter } = await import('../src/auth/totp.ts');
const { alleSchliessen, mandantDb } = await import('../src/db/index.ts');
const { ipInBereichen, bereichPruefen } = await import('../src/ip.ts');
const { metadatenAuswerten } = await import('../src/auth/saml.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({
    method: methode,
    url,
    headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}), ...extra },
    payload: body as object | undefined,
  });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}

before(async () => {
  app = await appBauen({ logger: false });
  await startAdminAnlegen(() => {});
});

after(async () => {
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

test('IP-Bereiche', () => {
  assert.equal(ipInBereichen('203.0.113.9', ['203.0.113.8/29']), true);
  assert.equal(ipInBereichen('203.0.113.17', ['203.0.113.8/29']), false);
  assert.equal(ipInBereichen('::ffff:10.1.2.3', ['10.1.2.3']), true);
  assert.equal(ipInBereichen('2001:db8::5', ['2001:db8::/64']), true);
  assert.ok(bereichPruefen('10.0.0.0/33'));
  assert.ok(bereichPruefen('kein-ip'));
  assert.equal(bereichPruefen('10.0.0.0/8'), null);
});

test('SAML-Metadaten auswerten', () => {
  const xml = `<?xml version="1.0"?><EntityDescriptor entityID="https://sts.windows.net/abc/" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
    <RoleDescriptor><KeyDescriptor use="signing"><X509Certificate>FREMD</X509Certificate></KeyDescriptor></RoleDescriptor>
    <IDPSSODescriptor><KeyDescriptor use="signing"><KeyInfo><X509Data><X509Certificate>MIIC
    ABC=</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.microsoftonline.com/abc/saml2"/>
    </IDPSSODescriptor></EntityDescriptor>`;
  const r = metadatenAuswerten(xml);
  assert.equal(r.idpEntityId, 'https://sts.windows.net/abc/');
  assert.equal(r.idpSsoUrl, 'https://login.microsoftonline.com/abc/saml2');
  assert.deepEqual(r.idpZertifikate, ['MIICABC=']);
});

test('ohne Anmeldung kein Zugriff, CSRF-Kopf Pflicht', async () => {
  assert.equal((await rufe('GET', '/api/ich')).status, 401);
  const r = await app.inject({ method: 'POST', url: '/api/auth/lokal', payload: { benutzername: 'notfall', passwort: 'x' } });
  assert.equal(r.statusCode, 403);
});

test('falsches Passwort', async () => {
  const r = await rufe('POST', '/api/auth/lokal', { benutzername: 'notfall', passwort: 'falsch-falsch-1' });
  assert.equal(r.status, 401);
});

let recovery: string[] = [];

test('lokaler Login: TOTP muss eingerichtet werden', async () => {
  assert.equal((await rufe('POST', '/api/auth/lokal', { benutzername: 'notfall', passwort: 'Test-Passwort-123' })).status, 200);
  const ich = await rufe('GET', '/api/ich');
  assert.equal(ich.json.mfa.status, 'einrichten');
  // Vor dem zweiten Faktor ist nichts anderes erlaubt
  assert.equal((await rufe('GET', '/api/plattform/mandanten')).status, 401);

  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  assert.equal(e.status, 200);
  assert.equal((await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: '000000' })).status, 400);
  // Fehlversuch verbraucht die Einrichtung: neu beginnen
  const e2 = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  const b = await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e2.json.secret, totpCounter()) });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(b.json.recoveryCodes.length, 10);
  recovery = b.json.recoveryCodes;
  const ich2 = await rufe('GET', '/api/ich');
  assert.equal(ich2.json.mfa, null);
  assert.equal(ich2.json.plattformAdmin, true);
});

test('zweiter Login: vorhandener Faktor, Einrichten nicht erlaubt, Recovery-Code einmalig', async () => {
  await rufe('POST', '/api/auth/abmelden');
  await rufe('POST', '/api/auth/lokal', { benutzername: 'notfall', passwort: 'Test-Passwort-123' });
  assert.equal((await rufe('GET', '/api/ich')).json.mfa.status, 'pruefen');
  assert.equal((await rufe('POST', '/api/auth/mfa/totp/einrichten')).status, 403);
  assert.equal((await rufe('POST', '/api/auth/mfa/recovery', { code: recovery[0] })).status, 200);
  await rufe('POST', '/api/auth/abmelden');
  await rufe('POST', '/api/auth/lokal', { benutzername: 'notfall', passwort: 'Test-Passwort-123' });
  assert.equal((await rufe('POST', '/api/auth/mfa/recovery', { code: recovery[0] })).status, 401);
  assert.equal((await rufe('POST', '/api/auth/mfa/recovery', { code: recovery[1] })).status, 200);
});

test('Mandant, Filiale mit IP-Erkennung, Benutzer', async () => {
  const m = await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: { email: 'chefin@demo.example', name: 'Chefin' } });
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(m.json.sp.acsUrl, 'http://localhost:3000/saml/demo/acs');
  assert.equal((await rufe('POST', '/api/plattform/mandanten/demo/betreten')).status, 200);

  assert.equal((await rufe('POST', '/api/admin/filialen', { kuerzel: 'X', name: 'Ungültig', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', ipBereiche: ['1.2.3.4/40'], aktiv: true })).status, 400);
  const leer = { strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', aktiv: true };
  assert.equal((await rufe('POST', '/api/admin/filialen', { ...leer, kuerzel: 'b', name: 'Brunnenstraße', ipBereiche: ['127.0.0.1'] })).status, 200);
  assert.equal((await rufe('POST', '/api/admin/filialen', { ...leer, kuerzel: 'S', name: 'Süd', ipBereiche: [] })).status, 200);
  assert.equal((await rufe('POST', '/api/admin/filialen', { ...leer, kuerzel: 'B', name: 'Doppelt', ipBereiche: [] })).status, 409);

  // inject kommt von 127.0.0.1: Filiale B wird über die IP erkannt
  const ich = await rufe('GET', '/api/ich');
  assert.equal(ich.json.filiale.kuerzel, 'B');
  assert.equal(ich.json.filiale.perIp, true);
  assert.deepEqual(ich.json.rollen, ['admin']);

  const u = await rufe('POST', '/api/admin/benutzer', { email: 'Verkauf@Demo.example', name: 'Verkauf', rollen: ['verkauf'], alleFilialen: false, filialIds: [2], aktiv: true });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const liste = await rufe('GET', '/api/admin/benutzer');
  assert.ok(liste.json.some((b: { email: string }) => b.email === 'verkauf@demo.example'));
});

test('Protokoll ist unveränderlich', async () => {
  const db = mandantDb('demo');
  const eintraege = await db.selectFrom('protokoll').selectAll().execute();
  assert.ok(eintraege.length >= 3);
  await assert.rejects(db.updateTable('protokoll').set({ aktion: 'x' }).execute(), /unveränderlich/);
  await assert.rejects(db.deleteFrom('protokoll').execute(), /unveränderlich/);
});

test('SAML: Login-Weiterleitung nur bei aktiver Konfiguration und bekannter Domäne', async () => {
  assert.equal((await rufe('POST', '/api/auth/saml/finden', { email: 'a@demo.example' })).status, 404);
  const zert = 'MIIBszCCAVmgAwIBAgIUQ'; // nur Format, Inhalt ungültig
  const r = await rufe('PUT', '/api/plattform/mandanten/demo/saml', {
    idpEntityId: 'https://sts.windows.net/x/',
    idpSsoUrl: 'https://login.microsoftonline.com/x/saml2',
    idpZertifikate: [zert],
    emailDomaenen: ['demo.example'],
    aktiv: true,
  });
  assert.equal(r.status, 400); // ungültiges Zertifikat wird abgelehnt
});
