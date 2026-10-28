// Dispo (Stufe 6): Lieferauftrag beim Festschreiben, Geocoding/Routing über nachgebaute Dienste, Touren, Tourenzettel,
// Geliefert, Lieferkosten nach Entfernung, Storno nimmt den Auftrag von der Tour.
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
const { alleSchliessen } = await import('../src/db/index.ts');
const { heuteBerlin } = await import('../src/verkauf.ts');
const { leererVorgang } = await import('../../shared/verkauf.ts');
const { lieferkostenVorschlag } = await import('../../shared/dispo.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';
const heute = heuteBerlin();
const echtesFetch = globalThis.fetch;
let geocodeAnfragen = 0;
let distanzMeter = 12_345;

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  return { status: r.statusCode, json: String(r.headers['content-type'] ?? '').includes('json') && r.body ? JSON.parse(r.body) : null, roh: r.rawPayload };
}

function lieferung(name: string, art: 'lieferung' | 'abholung' = 'lieferung') {
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, name, strasse: 'Kundenweg 1', plz: '22222', ort: 'Kundenstadt', telefon: '0151 1' };
  d.positionen = [{ menge: 1, text: 'Sofa', preisCent: 50000, ust: 7, lagerort: '', kennzeichen: [] }];
  d.lieferung = { ...d.lieferung, art, datum: heute, zeitfenster: '08:30 – 12:00 Uhr', etage: 2, lieferkostenCent: 4900 };
  d.zahlung = { anzahlungCent: 10000, anzahlungMittel: 'bar', rest: 'lieferung' };
  return d;
}

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  await rufe('POST', '/api/plattform/mandanten/demo/betreten');
  await rufe('POST', '/api/admin/filialen', { kuerzel: 'B', name: 'Nord', strasse: 'Nordweg 5', plz: '11111', ort: 'Beispielstadt', telefon: '', fax: '', email: '', ipBereiche: ['127.0.0.1'], aktiv: true, wechselgeldCent: 0 });
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('nominatim')) {
      geocodeAnfragen++;
      const q = decodeURIComponent(u);
      if (q.includes('Nirgendwo')) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify([q.includes('Nordweg') ? { lat: '51.2', lon: '6.7' } : { lat: '51.25', lon: '6.8' }]), { status: 200 });
    }
    if (u.includes('project-osrm')) {
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: distanzMeter, duration: 900, geometry: { coordinates: [[6.7, 51.2], [6.8, 51.25]] } }] }), { status: 200 });
    }
    return new Response('nicht erwartet', { status: 500 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = echtesFetch;
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

let auftragId = 0;
let abholungId = 0;
let tourId = 0;

test('Festschreiben legt Lieferauftrag an; Geocoding setzt Koordinaten und nutzt den Zwischenspeicher', async () => {
  const v = await rufe('POST', '/api/vorgaenge', lieferung('Erste Kundin'));
  auftragId = v.json.id;
  assert.equal((await rufe('POST', `/api/vorgaenge/${auftragId}/festschreiben`)).status, 200);
  const ab = await rufe('POST', '/api/vorgaenge', lieferung('Abholer', 'abholung'));
  abholungId = ab.json.id;
  await rufe('POST', `/api/vorgaenge/${abholungId}/festschreiben`);
  const mit = await rufe('POST', '/api/vorgaenge', { ...lieferung('Mitnahme'), lieferung: { ...lieferung('x').lieferung, art: 'mitnahme' } });
  await rufe('POST', `/api/vorgaenge/${mit.json.id}/festschreiben`);

  const liste = await rufe('GET', `/api/dispo/auftraege?bis=${heute}`);
  assert.equal(liste.status, 200, JSON.stringify(liste.json));
  assert.equal(liste.json.length, 2);
  const a = liste.json.find((x: { vorgangId: number }) => x.vorgangId === auftragId);
  assert.equal(a.status, 'offen');
  assert.equal(a.geoStatus, 'offen');
  assert.equal(a.offenCent, 50000 + 4900 - 10000);

  const g = await rufe('POST', '/api/dispo/geocode', { vorgangIds: [auftragId, abholungId] });
  assert.equal(g.json.gefunden, 2);
  assert.equal(geocodeAnfragen, 1); // gleiche Adresse nur einmal angefragt
  const nach = (await rufe('GET', `/api/dispo/auftraege?bis=${heute}`)).json.find((x: { vorgangId: number }) => x.vorgangId === auftragId);
  assert.equal(nach.lat, 51.25);
  assert.equal(nach.geoStatus, 'ok');
});

test('Tour anlegen, Stopps zuordnen (keine Abholungen), Route berechnen, Tourenzettel', async () => {
  const f = await rufe('POST', '/api/dispo/fahrzeuge', { name: 'Wagen 5', kennzeichen: 'D-CR 5' });
  tourId = (await rufe('POST', '/api/dispo/touren', { datum: heute, fahrzeugId: f.json.id })).json.id;
  assert.equal((await rufe('PUT', `/api/dispo/touren/${tourId}`, { stopps: [abholungId] })).status, 400);
  const t = await rufe('PUT', `/api/dispo/touren/${tourId}`, { fahrzeugId: f.json.id, stopps: [auftragId] });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.stopps.length, 1);
  assert.equal(t.json.stopps[0].status, 'geplant');
  assert.equal(t.json.stopps[0].reihenfolge, 1);
  assert.equal((await rufe('GET', `/api/dispo/auftraege?bis=${heute}&status=offen`)).json.length, 1); // nur noch die Abholung

  const r = await rufe('POST', `/api/dispo/touren/${tourId}/route`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.km, 12.3);
  assert.equal(r.json.minuten, 15);
  assert.equal(r.json.linie[0][0], 51.2);
  assert.equal((await rufe('GET', `/api/dispo/touren?datum=${heute}`)).json[0].streckeKm, 12.3);

  const pdf = await rufe('GET', `/api/dispo/touren/${tourId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.roh.subarray(0, 4).toString(), '%PDF');
});

test('Lieferkosten nach Entfernung', async () => {
  assert.equal(lieferkostenVorschlag(12.3, { grundCent: 4900, freiKm: 13, proKmCent: 140 }), 4900);
  assert.equal(lieferkostenVorschlag(20, { grundCent: 4900, freiKm: 13, proKmCent: 140 }), 4900 + 7 * 140);
  const r = await rufe('POST', '/api/dispo/entfernung', { strasse: 'Kundenweg 1', plz: '22222', ort: 'Kundenstadt' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.km, 12.3);
  assert.equal(r.json.vorschlagCent, 4900);
  distanzMeter = 20_000;
  assert.equal((await rufe('POST', '/api/dispo/entfernung', { strasse: 'Kundenweg 1', plz: '22222', ort: 'Kundenstadt' })).json.vorschlagCent, 5880);
  assert.equal((await rufe('POST', '/api/dispo/entfernung', { strasse: 'Nirgendwo 1', plz: '', ort: 'Nirgendwo' })).status, 400);
});

test('Geliefert schließt Tour ab; Storno nimmt den Auftrag von der Tour', async () => {
  assert.equal((await rufe('POST', `/api/dispo/auftraege/${auftragId}/geliefert`)).status, 200);
  const meine = await rufe('GET', `/api/dispo/meine?datum=${heute}`);
  assert.equal(meine.json[0].status, 'fertig');
  assert.equal(meine.json[0].stopps[0].status, 'geliefert');

  const v2 = await rufe('POST', '/api/vorgaenge', lieferung('Zweite'));
  await rufe('POST', `/api/vorgaenge/${v2.json.id}/festschreiben`);
  await rufe('PUT', `/api/dispo/touren/${tourId}`, { stopps: [auftragId, v2.json.id] });
  await rufe('POST', `/api/vorgaenge/${v2.json.id}/storno`, { grund: 'Kunde tritt zurück', mittel: 'bar' });
  const t = await rufe('GET', `/api/dispo/touren?datum=${heute}`);
  assert.equal(t.json[0].stopps.length, 1);
  assert.equal((await rufe('GET', `/api/dispo/auftraege?bis=${heute}&status=storniert`)).json.length, 1);
});
