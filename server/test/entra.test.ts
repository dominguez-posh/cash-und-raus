// Automatische SAML-Einrichtung in Entra (nachgebaute Microsoft-Endpunkte): Setup-App, Start, Callback, Wiederholung.
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
const { alleSchliessen } = await import('../src/db/index.ts');

// Wegwerf-Zertifikat nur für den Test (selbstsigniert, ohne Bedeutung)
const ZERT =
  'MIIC4TCCAcmgAwIBAgIUFvN3w0i/HrKSM/aYSLWqJPBiYREwDQYJKoZIhvcNAQELBQAwADAeFw0yNjEwMjgxODUwMjNaFw0zNjEwMjUxODUwMjNaMAAwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCoT/gbIVnyPDngW/e+sfcVL49U6jqaH395OoOJ8ESZPPsyMOm632gl0YFgS/UCXjBgadctmxzEK7D0NNZxxyNUNvi1WypcseV9YYXxtxQszp5hRrQvlgwIqpNX0gGi4O6Di+YVcaG/icaZWC/px81mmlvA8bhTnqBGJqD+yxRzCMmFAv1O8fmYSOR9b53nwiusjjjFpZeLuXapIT9H5D+kH8EeyjGohGgf3GD3x9HWY0ygcoKYSK/UYd3FX2ahK9zbYRnA8p11y5z+sf0xjmuEAv7HJ/evzyEwDOtFluzTvDm8gZwi4yKtxL/KB7LBEdZqt/oumWuoTpT/6jLhCTMLAgMBAAGjUzBRMB0GA1UdDgQWBBTTDSzbvUqjkISfb1byusSRz5op4DAfBgNVHSMEGDAWgBTTDSzbvUqjkISfb1byusSRz5op4DAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBYLEI7NWMpLRaS8RSv9VrXPPFOB9p7mDwvbp7Gs2evVULIMYBz+KlYnN4FI2mVgV6Wk9STloUMfndXKIitlDEHZgCaEKTcT4D+fry3SUBn6GL1POep2GYnZZbaVtEebwRykJuLaChBx9HtacFAYfi+n5HWZRnQ6/tUAbR+2BZxEyp6uIvJLcxRuqM2dCi5nvAcfT/cm/+GDCB2LcBnJwpD/XZNFotwu+MX2zHFUf9ISlfbDafLwSzW+ZnJ+TdzT/cNRZzdLKCJLbJffrYkvJw9eFPTFP2E/bH0LoJnZXrdCHH254ozmPEcjvT8hg8lrE0W+BibiC9Do334zQkz6U4T';

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';
const echtesFetch = globalThis.fetch;
const aufrufe: string[] = [];
let appVorhanden = false;

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  return { status: r.statusCode, json: String(r.headers['content-type'] ?? '').includes('json') && r.body ? JSON.parse(r.body) : null, ort: String(r.headers.location ?? '') };
}

const idToken = () => `x.${Buffer.from(JSON.stringify({ tid: 'tid-123', preferred_username: 'admin@demo.example' })).toString('base64url')}.y`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    aufrufe.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/oauth2/v2.0/token')) {
      const b = Object.fromEntries(init!.body as URLSearchParams);
      if (b.code !== 'code-ok') return json({ error_description: 'AADSTS70000: ungültiger Code' }, 400);
      return json({ access_token: 'tok', id_token: idToken(), expires_in: 3600 });
    }
    if (u.includes('/federationmetadata/')) return new Response('nicht da', { status: 404 });
    if (u.includes('/applications?')) return json({ value: appVorhanden ? [{ id: 'app-obj', appId: 'app-id' }] : [] });
    if (u.includes('/applicationTemplates/')) return json({ application: { id: 'app-obj', appId: 'app-id' }, servicePrincipal: { id: 'sp-id' } }, 201);
    if (u.includes('/servicePrincipals?')) return json({ value: [{ id: 'sp-id' }] });
    if (u.endsWith('/servicePrincipals/sp-id?$select=keyCredentials,preferredTokenSigningKeyThumbprint')) {
      return json({ keyCredentials: appVorhanden ? [{ usage: 'Verify', key: ZERT, endDateTime: '2036-01-01T00:00:00Z', customKeyIdentifier: null }] : [], preferredTokenSigningKeyThumbprint: null });
    }
    if (u.endsWith('/addTokenSigningCertificate')) return json({ key: ZERT, thumbprint: 'ABCDEF' });
    if (u.includes('/domains')) return json({ value: [{ id: 'demo.example', isVerified: true }, { id: 'demo.onmicrosoft.com', isVerified: true }, { id: 'offen.example', isVerified: false }] });
    if (init?.method === 'PATCH') return new Response(null, { status: 204 });
    return new Response(`nicht erwartet: ${u}`, { status: 500 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = echtesFetch;
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

test('Start ohne Setup-App wird abgelehnt; Setup-App speichern', async () => {
  assert.equal((await rufe('POST', '/api/entra/start', { mandant: 'demo', zurueck: 'plattform' })).status, 409);
  const e = await rufe('GET', '/api/plattform/entra');
  assert.equal(e.json.redirectUri, 'http://localhost:3000/entra/callback');
  assert.equal((await rufe('PUT', '/api/plattform/entra', { clientId: 'client-1', clientSecret: 'geheim' })).status, 200);
  assert.equal((await rufe('GET', '/api/plattform/entra')).json.clientSecretVorhanden, true);
});

let state = '';

test('Start liefert die Microsoft-Anmeldeadresse mit state', async () => {
  const r = await rufe('POST', '/api/entra/start', { mandant: 'demo', zurueck: 'plattform' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const u = new URL(r.json.url);
  assert.equal(u.origin + u.pathname, 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('client_id'), 'client-1');
  assert.ok(u.searchParams.get('scope')!.includes('Application.ReadWrite.All'));
  state = u.searchParams.get('state')!;
  assert.ok(state.length > 20);
});

test('Callback: Anwendung anlegen, Zertifikat erstellen, Domänen übernehmen, Anmeldung aktiv', async () => {
  const falsch = await rufe('GET', `/entra/callback?code=code-ok&state=unbekannt`);
  assert.equal(falsch.status, 303);
  assert.match(decodeURIComponent(falsch.ort), /entra=fehler/);

  const r = await rufe('GET', `/entra/callback?code=code-ok&state=${state}`);
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.ort), /^\/#\/plattform\?entra=ok/);
  assert.ok(aufrufe.some((a) => a.includes('/applicationTemplates/')));
  assert.ok(aufrufe.some((a) => a.includes('/addTokenSigningCertificate')));
  assert.ok(aufrufe.some((a) => a.startsWith('PATCH') && a.includes('/applications/app-obj')));
  const m = (await rufe('GET', '/api/plattform/mandanten')).json.find((x: { id: string }) => x.id === 'demo');
  assert.equal(m.saml.aktiv, true);
  assert.equal(m.saml.idpEntityId, 'https://sts.windows.net/tid-123/');
  assert.equal(m.saml.idpSsoUrl, 'https://login.microsoftonline.com/tid-123/saml2');
  assert.deepEqual(m.saml.idpZertifikate, [ZERT]);
  assert.deepEqual(m.saml.emailDomaenen, ['demo.example', 'demo.onmicrosoft.com']);
  // state ist verbraucht
  assert.match(decodeURIComponent((await rufe('GET', `/entra/callback?code=code-ok&state=${state}`)).ort), /abgelaufen/);
  // Login-Suche findet den Mandanten jetzt über die Domäne
  assert.equal((await rufe('POST', '/api/auth/saml/finden', { email: 'wer@demo.example' })).status, 200);
});

test('Wiederholung: vorhandene Anwendung und Zertifikat werden übernommen', async () => {
  appVorhanden = true;
  aufrufe.length = 0;
  const s = await rufe('POST', '/api/entra/start', { mandant: 'demo', zurueck: 'admin' });
  const st = new URL(s.json.url).searchParams.get('state')!;
  const r = await rufe('GET', `/entra/callback?code=code-ok&state=${st}`);
  assert.match(decodeURIComponent(r.ort), /^\/#\/admin\?entra=ok/);
  assert.ok(!aufrufe.some((a) => a.includes('/applicationTemplates/')));
  assert.ok(!aufrufe.some((a) => a.includes('/addTokenSigningCertificate')));
  assert.ok(aufrufe.some((a) => a.includes('/servicePrincipals?')));
});

test('Fehler von Microsoft landet lesbar in der Rückmeldung', async () => {
  const s = await rufe('POST', '/api/entra/start', { mandant: 'demo' });
  const st = new URL(s.json.url).searchParams.get('state')!;
  const r = await rufe('GET', `/entra/callback?error=access_denied&error_description=AADSTS65004: Zustimmung verweigert&state=${st}`);
  assert.match(decodeURIComponent(r.ort), /Zustimmung verweigert/);
});
