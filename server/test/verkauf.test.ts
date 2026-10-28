// Verkauf: Entwurf, Festschreiben mit lückenloser Nummer, Zahlung, Storno, Suche, PDFs.
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
const { heuteBerlin, nummerBilden } = await import('../src/verkauf.ts');
const { centAus, leererVorgang, summenBerechnen } = await import('../../shared/verkauf.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';
const jj = heuteBerlin().slice(2, 4);

async function rufe(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({
    method: methode,
    url,
    headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) },
    payload: body as object | undefined,
  });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  const istJson = String(r.headers['content-type'] ?? '').includes('json');
  return { status: r.statusCode, json: istJson && r.body ? JSON.parse(r.body) : null, roh: r.rawPayload, typ: r.headers['content-type'] };
}

function verkauf(overrides: Partial<ReturnType<typeof leererVorgang>> = {}) {
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, anrede: 'Frau', name: 'Müller, Erika', strasse: 'Teststraße 1', plz: '12345', ort: 'Musterstadt', telefon: '0123 456' };
  d.positionen = [
    { menge: 1, text: 'Kleiderschrank', preisCent: 10000, ust: 7, lagerort: 'Halle 2', kennzeichen: [] },
    { menge: 2, text: 'Stuhl', preisCent: 1250, ust: 19, lagerort: '', kennzeichen: ['*'] },
    { menge: 1, text: '', preisCent: 0, ust: 7, lagerort: '', kennzeichen: [] }, // leere Zeile
  ];
  return { ...d, ...overrides };
}

before(async () => {
  app = await appBauen({ logger: false });
  await rufe('POST', '/api/auth/einrichtung', { benutzername: 'notfall', name: 'Notfall', passwort: 'Test-Passwort-123' });
  const e = await rufe('POST', '/api/auth/mfa/totp/einrichten');
  await rufe('POST', '/api/auth/mfa/totp/bestaetigen', { code: totpAt(e.json.secret, totpCounter()) });
  await rufe('POST', '/api/plattform/mandanten', { id: 'demo', name: 'Demo GmbH', admin: null });
  await rufe('POST', '/api/plattform/mandanten/demo/betreten');
  const leer = { strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', aktiv: true };
  await rufe('POST', '/api/admin/filialen', { ...leer, kuerzel: 'B', name: 'Nord', ipBereiche: ['127.0.0.1'] });
  await rufe('POST', '/api/admin/filialen', { ...leer, kuerzel: 'S', name: 'Süd', ipBereiche: [] });
});

after(async () => {
  await app.close();
  await alleSchliessen();
  fs.rmSync(daten, { recursive: true, force: true });
});

test('Berechnung: Brutto, Rabatt nur auf Artikel, USt je Satz', () => {
  const d = verkauf({ rabatt: { kuerzel: 'FK', name: 'Familienkarte', prozent: 15 } });
  d.lieferung = { ...d.lieferung, art: 'lieferung', lieferkostenCent: 2000, montage: true, montagekostenCent: 1500 };
  const s = summenBerechnen(d, 7);
  assert.equal(s.artikelCent, 12500);
  assert.equal(s.rabattCent, 1500 + 375);
  assert.equal(s.bruttoCent, 12500 - 1875 + 3500);
  const s7 = s.steuer.find((z) => z.satz === 7)!;
  assert.equal(s7.bruttoCent, 8500 + 3500);
  assert.equal(s7.steuerCent, Math.round((12000 * 7) / 107));
  assert.equal(s.steuer.find((z) => z.satz === 19)!.bruttoCent, 2125);
  assert.equal(centAus('1.234,50'), 123450);
  assert.equal(centAus('12.5'), 1250);
  assert.equal(centAus('abc'), null);
  assert.equal(nummerBilden('{F}-{N}-{JJ}', 'B', 7, 2026), 'B-7-26');
  assert.equal(nummerBilden('{JJJJ}/{F}{N}', 'S', 12, 2027), '2027/S12');
});

let rechnungId = 0;

test('Entwurf anlegen, ändern, Festschreiben prüft Pflichtangaben', async () => {
  const leer = await rufe('POST', '/api/vorgaenge', leererVorgang(7));
  assert.equal(leer.status, 200, JSON.stringify(leer.json));
  const f = await rufe('POST', `/api/vorgaenge/${leer.json.id}/festschreiben`);
  assert.equal(f.status, 400);
  assert.match(f.json.fehler, /Name fehlt/);
  assert.equal((await rufe('DELETE', `/api/vorgaenge/${leer.json.id}`)).status, 200);

  const r = await rufe('POST', '/api/vorgaenge', verkauf());
  rechnungId = r.json.id;
  const v = await rufe('GET', `/api/vorgaenge/${rechnungId}`);
  assert.equal(v.json.status, 'entwurf');
  assert.equal(v.json.nummer, null);
  assert.equal(v.json.filiale.kuerzel, 'B');
  assert.equal(v.json.summen.bruttoCent, 12500);

  // nicht eingerichteter Rabatt und zu hohe Anzahlung werden beim Festschreiben abgelehnt
  const mitRabatt = verkauf({ rabatt: { kuerzel: 'X', name: 'Erfunden', prozent: 90 } });
  assert.equal((await rufe('PUT', `/api/vorgaenge/${rechnungId}`, mitRabatt)).status, 200);
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/festschreiben`)).status, 400);
  const zuViel = verkauf({ zahlung: { anzahlungCent: 99999, anzahlungMittel: 'bar', rest: 'lieferung' } });
  assert.equal((await rufe('PUT', `/api/vorgaenge/${rechnungId}`, zuViel)).status, 200);
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/festschreiben`)).status, 400);

  const ok = verkauf({ zahlung: { anzahlungCent: 5000, anzahlungMittel: 'ec', rest: 'lieferung' } });
  ok.lieferung = { ...ok.lieferung, art: 'lieferung', datum: '2030-01-15', etage: 3, aufzug: false, lieferkostenCent: 3000 };
  assert.equal((await rufe('PUT', `/api/vorgaenge/${rechnungId}`, ok)).status, 200);
});

test('Festschreiben: lückenlose Nummer je Filiale und Jahr, Anzahlung gebucht, unveränderlich', async () => {
  const f = await rufe('POST', `/api/vorgaenge/${rechnungId}/festschreiben`);
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.nummer, `B-1-${jj}`);
  assert.equal(f.json.positionen.length, 2); // leere Zeile entfernt
  assert.equal(f.json.summen.bruttoCent, 15500);
  assert.equal(f.json.bezahltCent, 5000);
  assert.equal(f.json.offenCent, 10500);
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/festschreiben`)).status, 409);
  assert.equal((await rufe('PUT', `/api/vorgaenge/${rechnungId}`, verkauf())).status, 409);
  assert.equal((await rufe('DELETE', `/api/vorgaenge/${rechnungId}`)).status, 409);

  const db = mandantDb('demo');
  await assert.rejects(db.updateTable('vorgang').set({ brutto_cent: 1 }).where('id', '=', rechnungId).execute(), /unveränderlich/);
  await assert.rejects(db.deleteFrom('zahlung').execute(), /unveränderlich/);
  await assert.rejects(db.deleteFrom('dokument').execute(), /unveränderlich/);

  const zweite = await rufe('POST', '/api/vorgaenge', verkauf());
  assert.equal((await rufe('POST', `/api/vorgaenge/${zweite.json.id}/festschreiben`)).json.nummer, `B-2-${jj}`);

  // andere Filiale: eigener Nummernkreis
  const ich = await rufe('GET', '/api/ich');
  const sued = ich.json.filialen.find((x: { kuerzel: string }) => x.kuerzel === 'S');
  await rufe('POST', '/api/ich/filiale', { filialeId: sued.id });
  const dritte = await rufe('POST', '/api/vorgaenge', verkauf());
  assert.equal((await rufe('POST', `/api/vorgaenge/${dritte.json.id}/festschreiben`)).json.nummer, `S-1-${jj}`);
});

test('Restzahlung mit Quittung', async () => {
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/zahlungen`, { betragCent: 10501, mittel: 'bar' })).status, 400);
  const z = await rufe('POST', `/api/vorgaenge/${rechnungId}/zahlungen`, { betragCent: 10500, mittel: 'bar', kassenBon: '4711' });
  assert.equal(z.status, 200, JSON.stringify(z.json));
  const v = await rufe('GET', `/api/vorgaenge/${rechnungId}`);
  assert.equal(v.json.offenCent, 0);
  assert.equal(v.json.zahlungen.length, 2);
  const q = await rufe('GET', `/api/vorgaenge/${rechnungId}/pdf/quittung?zahlung=${z.json.zahlungId}`);
  assert.equal(q.status, 200);
  assert.equal(q.roh.subarray(0, 4).toString(), '%PDF');
});

test('PDFs: Rechnung aus dem Archiv, Lieferschein, Kommission, Entwurf', async () => {
  for (const art of ['rechnung', 'lieferschein', 'kommission']) {
    const r = await rufe('GET', `/api/vorgaenge/${rechnungId}/pdf/${art}`);
    assert.equal(r.status, 200, art);
    assert.equal(r.typ, 'application/pdf');
    assert.equal(r.roh.subarray(0, 4).toString(), '%PDF');
  }
  const entwurf = await rufe('POST', '/api/vorgaenge', verkauf());
  assert.equal((await rufe('GET', `/api/vorgaenge/${entwurf.json.id}/pdf/rechnung`)).status, 200);
  assert.equal((await rufe('GET', `/api/vorgaenge/${rechnungId}/pdf/unbekannt`)).status, 404);
});

test('Storno: eigener Vorgang mit Nummer, Erstattung, nur einmal', async () => {
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/storno`, { grund: '', mittel: 'bar' })).status, 400);
  const s = await rufe('POST', `/api/vorgaenge/${rechnungId}/storno`, { grund: 'Kunde tritt zurück', mittel: 'bar' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const storno = await rufe('GET', `/api/vorgaenge/${s.json.id}`);
  assert.equal(storno.json.art, 'storno');
  assert.equal(storno.json.nummer, `B-3-${jj}`); // gleicher Nummernkreis wie die Filiale der Rechnung
  assert.equal(storno.json.summen.bruttoCent, -15500);
  assert.equal(storno.json.zahlungen[0].betragCent, -15500);
  assert.equal(storno.json.bezug.nummer, `B-1-${jj}`);
  const original = await rufe('GET', `/api/vorgaenge/${rechnungId}`);
  assert.equal(original.json.storno.nummer, `B-3-${jj}`);
  assert.equal(original.json.offenCent, 0);
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/storno`, { grund: 'nochmal', mittel: 'bar' })).status, 409);
  assert.equal((await rufe('POST', `/api/vorgaenge/${rechnungId}/zahlungen`, { betragCent: 100, mittel: 'bar' })).status, 409);
  assert.equal((await rufe('GET', `/api/vorgaenge/${s.json.id}/pdf/rechnung`)).status, 200);
});

test('Suche nach Name (auch Umlaute) und Nummer, Kundenvorschläge', async () => {
  const name = await rufe('GET', `/api/vorgaenge?q=${encodeURIComponent('MÜLLER')}`);
  assert.ok(name.json.length >= 4);
  const nr = await rufe('GET', `/api/vorgaenge?q=B-1-${jj}`);
  assert.ok(nr.json.some((v: { nummer: string; storniert: boolean }) => v.nummer === `B-1-${jj}` && v.storniert));
  assert.equal((await rufe('GET', '/api/vorgaenge?q=niemand')).json.length, 0);
  const k = await rufe('GET', '/api/kunden?q=müll');
  assert.equal(k.json.length, 1);
  assert.equal(k.json[0].strasse, 'Teststraße 1');
});
