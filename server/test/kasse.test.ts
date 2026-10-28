// Kasse (Stufe 3): Belege, Gegenbeleg, Tagesstand mit Barzahlungen aus dem Verkauf, Abschluss mit Zählprotokoll.
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
const { heuteBerlin } = await import('../src/verkauf.ts');
const { leererVorgang } = await import('../../shared/verkauf.ts');
const { zaehlungSumme } = await import('../../shared/kasse.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';
const heute = heuteBerlin();

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  const json = String(r.headers['content-type'] ?? '').includes('json');
  return { status: r.statusCode, json: json && r.body ? JSON.parse(r.body) : null, roh: r.rawPayload };
}

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  await rufe('POST', '/api/plattform/mandanten/demo/betreten');
  const f = await rufe('POST', '/api/admin/filialen', { kuerzel: 'B', name: 'Nord', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', ipBereiche: ['127.0.0.1'], aktiv: true, wechselgeldCent: 13000 });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  // Ein Barverkauf mit Anzahlung 50 € bar und ein EC-Verkauf
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, name: 'Kundin' };
  d.positionen = [{ menge: 1, text: 'Tisch', preisCent: 8000, ust: 7, lagerort: '', kennzeichen: [] }];
  d.zahlung = { anzahlungCent: 5000, anzahlungMittel: 'bar', rest: 'abholung' };
  const v = await rufe('POST', '/api/vorgaenge', d);
  await rufe('POST', `/api/vorgaenge/${v.json.id}/festschreiben`);
  await rufe('POST', `/api/vorgaenge/${v.json.id}/zahlungen`, { betragCent: 3000, mittel: 'ec' });
});

after(async () => {
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

let belegId = 0;

test('Tagesstand: Wechselgeld + Barzahlungen; Belege ändern das Soll', async () => {
  const t0 = await rufe('GET', `/api/kasse/tag?datum=${heute}`);
  assert.equal(t0.status, 200, JSON.stringify(t0.json));
  assert.equal(t0.json.anfangCent, 13000);
  assert.equal(t0.json.barZahlungenCent, 5000);
  assert.equal(t0.json.ecCent, 3000);
  assert.equal(t0.json.sollCent, 18000);

  assert.equal((await rufe('POST', '/api/kasse/belege', { art: 'ausgabe', grund: 'Tanken', betragCent: 0 })).status, 400);
  const b = await rufe('POST', '/api/kasse/belege', { art: 'ausgabe', grund: 'Tanken', text: 'Wagen 5', betragCent: 4500 });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  belegId = b.json.id;
  assert.equal(b.json.nummer, `B-K${belegId}`);
  await rufe('POST', '/api/kasse/belege', { art: 'einnahme', grund: 'Sonstiges', betragCent: 1000 });
  const t1 = await rufe('GET', `/api/kasse/tag?datum=${heute}`);
  assert.equal(t1.json.ausgabenCent, 4500);
  assert.equal(t1.json.einnahmenCent, 1000);
  assert.equal(t1.json.sollCent, 18000 - 4500 + 1000);
  const pdf = await rufe('GET', `/api/kasse/belege/${belegId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.roh.subarray(0, 4).toString(), '%PDF');
});

test('Gegenbeleg hebt den Beleg auf; Belege sind unveränderlich', async () => {
  const s = await rufe('POST', `/api/kasse/belege/${belegId}/storno`, { grund: 'falscher Betrag' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.art, 'einnahme');
  assert.equal(s.json.stornoVon, belegId);
  assert.equal((await rufe('POST', `/api/kasse/belege/${belegId}/storno`, { grund: 'nochmal' })).status, 409);
  const t = await rufe('GET', `/api/kasse/tag?datum=${heute}`);
  assert.equal(t.json.ausgabenCent, 0);
  assert.equal(t.json.sollCent, 19000);
  assert.ok(t.json.belege.find((b: { id: number }) => b.id === belegId).storniertDurch);
  const db = mandantDb('demo');
  await assert.rejects(db.deleteFrom('kassenbeleg').execute(), /unveränderlich/);
});

test('Tagesabschluss: Zählung, Differenz, Entnahme, Z-Bon; danach keine Belege mehr', async () => {
  const zaehlung = { '5000': 3, '2000': 1, '1000': 1, '200': 5, '100': 3 }; // 150 + 20 + 10 + 10 + 3 = 193 €
  assert.equal(zaehlungSumme(zaehlung), 19300);
  assert.equal((await rufe('POST', '/api/kasse/abschluss', { datum: heute, zaehlung: { '7': 1 } })).status, 400);
  const a = await rufe('POST', '/api/kasse/abschluss', { datum: heute, zaehlung, zBonNr: '0815', zBarCent: 5000, uebergebenVon: 'A', uebernommenVon: 'B' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.sollCent, 19000);
  assert.equal(a.json.istCent, 19300);
  assert.equal(a.json.differenzCent, 300);
  assert.equal(a.json.entnahmeCent, 19300 - 13000);
  assert.equal(a.json.ecCent, 3000);
  assert.equal((await rufe('POST', '/api/kasse/abschluss', { datum: heute, zaehlung })).status, 409);
  assert.equal((await rufe('POST', '/api/kasse/belege', { art: 'ausgabe', grund: 'Tanken', betragCent: 100 })).status, 409);
  const pdf = await rufe('GET', `/api/kasse/abschluesse/${a.json.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.roh.subarray(0, 4).toString(), '%PDF');
  const liste = await rufe('GET', '/api/kasse/abschluesse');
  assert.equal(liste.json.length, 1);
  await assert.rejects(mandantDb('demo').updateTable('kassenabschluss').set({ ist_cent: 0 }).execute(), /unveränderlich/);
});
