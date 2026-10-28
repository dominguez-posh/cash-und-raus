// E-Mail (Stufe 2b): Konfiguration mit verschlüsseltem Secret, Versand über nachgebautes Graph.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const daten = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
process.env.CR_DATA_DIR = daten;
process.env.CR_WEB_DIR = path.join(daten, 'kein-web');
process.env.CR_SECRET_KEY = 'test-schluessel';

const { appBauen } = await import('../src/app.ts');
const { totpAt, totpCounter } = await import('../src/auth/totp.ts');
const { alleSchliessen, mandantDb } = await import('../src/db/index.ts');
const { entschluesseln, verschluesseln } = await import('../src/geheim.ts');
const { leererVorgang } = await import('../../shared/verkauf.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';
const echtesFetch = globalThis.fetch;
const anfragen: { url: string; body: unknown }[] = [];

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  await rufe('POST', '/api/plattform/mandanten/demo/betreten');
  await rufe('POST', '/api/admin/filialen', { kuerzel: 'B', name: 'Nord', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: 'nord@demo.example', ipBereiche: ['127.0.0.1'], aktiv: true });
  // Microsoft nachbauen: Token-Endpunkt und sendMail
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init?.body;
    anfragen.push({ url: u, body });
    if (u.includes('login.microsoftonline.com')) {
      if ((body as { client_secret: string }).client_secret !== 'geheim-123') return new Response(JSON.stringify({ error_description: 'AADSTS7000215: Invalid client secret' }), { status: 401 });
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('graph.microsoft.com')) return new Response(null, { status: 202 });
    return new Response('nicht erwartet', { status: 500 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = echtesFetch;
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

test('Verschlüsselung rund', () => {
  const enc = verschluesseln('geheim');
  assert.notEqual(enc, 'geheim');
  assert.equal(entschluesseln(enc), 'geheim');
  assert.notEqual(verschluesseln('geheim'), enc); // frische IV
});

test('Konfiguration: Secret verschlüsselt, nie zurückgegeben; Aktivieren ohne Secret abgelehnt', async () => {
  assert.equal((await rufe('GET', '/api/admin/email')).json, null);
  const ohne = await rufe('PUT', '/api/admin/email', { tenantId: 't', clientId: 'c', clientSecret: null, absender: 'rechnung@demo.example', aktiv: true });
  assert.equal(ohne.status, 400);
  const r = await rufe('PUT', '/api/admin/email', { tenantId: 't', clientId: 'c', clientSecret: 'falsch', absender: 'rechnung@demo.example', aktiv: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const k = await rufe('GET', '/api/admin/email');
  assert.equal(k.json.clientSecretVorhanden, true);
  assert.equal(k.json.clientSecret, undefined);
  const zeile = await mandantDb('demo').selectFrom('graph_konfig').select('client_secret_enc').executeTakeFirstOrThrow();
  assert.ok(zeile.client_secret_enc.startsWith('v1.'));
  assert.ok(!zeile.client_secret_enc.includes('falsch'));
});

test('Test-Mail: falsches Secret liefert Fehler, richtiges sendet', async () => {
  const f = await rufe('POST', '/api/admin/email/test', { an: 'chef@demo.example' });
  assert.equal(f.status, 502);
  assert.match(f.json.fehler, /Invalid client secret/);
  // Secret ändern, andere Felder unverändert lassen
  await rufe('PUT', '/api/admin/email', { tenantId: 't', clientId: 'c', clientSecret: 'geheim-123', absender: 'rechnung@demo.example', aktiv: true });
  const ok = await rufe('POST', '/api/admin/email/test', { an: 'chef@demo.example' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const send = anfragen.at(-1)!;
  assert.ok(send.url.endsWith('/users/rechnung%40demo.example/sendMail'));
  assert.equal((send.body as { message: { toRecipients: { emailAddress: { address: string } }[] } }).message.toRecipients[0]!.emailAddress.address, 'chef@demo.example');
  assert.ok((await rufe('GET', '/api/admin/email')).json.letzterTest);
});

test('Rechnung per E-Mail: nur festgeschrieben, Anhänge als PDF, Versand protokolliert', async () => {
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, name: 'Test Kundin', email: 'kundin@example.org' };
  d.positionen = [{ menge: 1, text: 'Tisch', preisCent: 5000, ust: 7, lagerort: '', kennzeichen: [] }];
  const { id } = (await rufe('POST', '/api/vorgaenge', d)).json;
  assert.equal((await rufe('POST', `/api/vorgaenge/${id}/email`, { an: 'kundin@example.org', anhaenge: ['rechnung'] })).status, 409);
  await rufe('POST', `/api/vorgaenge/${id}/festschreiben`);
  const vor = anfragen.length;
  const r = await rufe('POST', `/api/vorgaenge/${id}/email`, { an: 'kundin@example.org', anhaenge: ['rechnung', 'kommission'], text: '' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(anfragen.length, vor + 1); // Token aus dem Zwischenspeicher
  const m = (anfragen.at(-1)!.body as { message: { subject: string; attachments: { name: string; contentBytes: string }[]; replyTo: { emailAddress: { address: string } }[] } }).message;
  assert.match(m.subject, /^Rechnung B-1-\d\d – Demo GmbH$/);
  assert.equal(m.attachments.length, 2);
  assert.ok(Buffer.from(m.attachments[0]!.contentBytes, 'base64').subarray(0, 4).toString() === '%PDF');
  assert.equal(m.replyTo[0]!.emailAddress.address, 'nord@demo.example');
  const liste = await rufe('GET', `/api/vorgaenge/${id}/emails`);
  assert.equal(liste.json.length, 1);
  assert.deepEqual(liste.json[0].anhaenge, ['rechnung', 'kommission']);
});
