// Artikel & Lager (Stufe 5): Stamm, Wareneingang, Abbuchung beim Festschreiben, Storno, Umlagerung, Inventur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const daten = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
process.env.CR_DATA_DIR = daten;
process.env.CR_WEB_DIR = path.join(daten, 'kein-web');

const { appBauen } = await import('../src/app.ts');
const { totpAt, totpCounter } = await import('../src/auth/totp.ts');
const { alleSchliessen, mandantDb } = await import('../src/db/index.ts');
const { leererVorgang } = await import('../../shared/verkauf.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  return { status: r.statusCode, json: String(r.headers['content-type'] ?? '').includes('json') && r.body ? JSON.parse(r.body) : null };
}

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  await rufe('POST', '/api/plattform/mandanten/demo/betreten');
  await rufe('POST', '/api/admin/filialen', { kuerzel: 'B', name: 'Nord', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', ipBereiche: ['127.0.0.1'], aktiv: true, wechselgeldCent: 0 });
});

after(async () => {
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

let halle = 0;
let laden = 0;
let schrank = 0;

test('Lagerorte und Artikel anlegen; Nummern eindeutig; USt nur freigegebene Sätze', async () => {
  halle = (await rufe('POST', '/api/lagerorte', { name: 'Halle', filialeId: null, aktiv: true })).json.id;
  laden = (await rufe('POST', '/api/lagerorte', { name: 'Laden Nord', filialeId: 1, aktiv: true })).json.id;
  assert.equal((await rufe('POST', '/api/lagerorte', { name: 'halle', filialeId: null, aktiv: true })).status, 409);
  const a = await rufe('POST', '/api/artikel', { nummer: 'S-100', bezeichnung: 'Kleiderschrank Eiche', preisCent: 29900, ust: 7, lagerortId: halle, aktiv: true });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  schrank = a.json.id;
  assert.equal((await rufe('POST', '/api/artikel', { nummer: 'S-100', bezeichnung: 'Doppelt', preisCent: 1, ust: 7, lagerortId: null, aktiv: true })).status, 409);
  assert.equal((await rufe('POST', '/api/artikel', { nummer: '', bezeichnung: 'Falsche USt', preisCent: 1, ust: 5, lagerortId: null, aktiv: true })).status, 400);
  const suche = await rufe('GET', '/api/artikel?q=eiche');
  assert.equal(suche.json.length, 1);
  assert.equal(suche.json[0].bestand, 0);
});

test('Wareneingang, Verkauf bucht ab, Storno bucht zurück', async () => {
  assert.equal((await rufe('POST', '/api/lager/buchen', { art: 'wareneingang', artikelId: schrank, lagerortId: halle, menge: 10, text: 'Lieferung Werk' })).json.menge, 10);
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, name: 'Kundin' };
  d.positionen = [
    { menge: 2, text: 'Kleiderschrank Eiche', preisCent: 29900, ust: 7, lagerort: 'Halle', kennzeichen: [], artikelId: schrank, lagerortId: null },
    { menge: 1, text: 'Freitext ohne Stamm', preisCent: 500, ust: 7, lagerort: '', kennzeichen: [] },
  ];
  const v = await rufe('POST', '/api/vorgaenge', d);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const f = await rufe('POST', `/api/vorgaenge/${v.json.id}/festschreiben`);
  assert.equal(f.status, 200, JSON.stringify(f.json));
  let bestand = await rufe('GET', '/api/lager/bestand');
  assert.equal(bestand.json.find((b: { lagerortId: number }) => b.lagerortId === halle).menge, 8);
  const buchungen = await rufe('GET', `/api/lager/buchungen?artikel=${schrank}`);
  assert.equal(buchungen.json[0].art, 'verkauf');
  assert.equal(buchungen.json[0].menge, -2);
  assert.equal(buchungen.json[0].bezug, f.json.nummer);

  await rufe('POST', `/api/vorgaenge/${v.json.id}/storno`, { grund: 'Kunde tritt zurück', mittel: 'bar' });
  bestand = await rufe('GET', '/api/lager/bestand');
  assert.equal(bestand.json.find((b: { lagerortId: number }) => b.lagerortId === halle).menge, 10);
});

test('Umlagerung prüft Bestand; Inventur setzt den Stand; Buchungen unveränderlich', async () => {
  assert.equal((await rufe('POST', '/api/lager/buchen', { art: 'umlagerung', artikelId: schrank, lagerortId: halle, zielLagerortId: laden, menge: 11 })).status, 409);
  assert.equal((await rufe('POST', '/api/lager/buchen', { art: 'umlagerung', artikelId: schrank, lagerortId: halle, zielLagerortId: laden, menge: 3 })).status, 200);
  const bestand = await rufe('GET', '/api/lager/bestand');
  assert.equal(bestand.json.find((b: { lagerortId: number }) => b.lagerortId === halle).menge, 7);
  assert.equal(bestand.json.find((b: { lagerortId: number }) => b.lagerortId === laden).menge, 3);
  assert.equal((await rufe('POST', '/api/lager/buchen', { art: 'inventur', artikelId: schrank, lagerortId: laden, menge: 2, text: 'Zählung' })).json.menge, 2);
  const b = await rufe('GET', `/api/lager/buchungen?artikel=${schrank}`);
  assert.equal(b.json[0].art, 'inventur');
  assert.equal(b.json[0].menge, -1);
  assert.equal((await rufe('GET', '/api/artikel?q=S-100')).json[0].bestand, 9);
  await assert.rejects(mandantDb('demo').deleteFrom('lagerbuchung').execute(), /unveränderlich/);
});
