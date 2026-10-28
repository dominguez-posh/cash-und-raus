// Import (Stufe 4): nachgebaute Altdatei (Blätter Daten/Rechnung) → festgeschriebener Vorgang, Nummernkreis zieht nach.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import XLSX, { type WorkSheet } from 'xlsx';

const daten = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
process.env.CR_DATA_DIR = daten;
process.env.CR_WEB_DIR = path.join(daten, 'kein-web');

const { appBauen } = await import('../src/app.ts');
const { totpAt, totpCounter } = await import('../src/auth/totp.ts');
const { alleSchliessen } = await import('../src/db/index.ts');
const { datumAus } = await import('../src/import.ts');
const { leererVorgang } = await import('../../shared/verkauf.ts');

type App = Awaited<ReturnType<typeof appBauen>>;
let app: App;
let cookie = '';

async function rufe(methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method: methode, url, headers: { cookie, ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) }, payload: body as object | undefined });
  const gesetzt = r.cookies.find((c) => c.name === 'cr_sitzung');
  if (gesetzt) cookie = `cr_sitzung=${gesetzt.value}`;
  const json = String(r.headers['content-type'] ?? '').includes('json');
  return { status: r.statusCode, json: json && r.body ? JSON.parse(r.body) : null, roh: r.rawPayload };
}

/** Baut eine Datei im Aufbau der Altvorlage (nur die genutzten Zellen). */
function altdatei(zellen: Record<string, string | number>, rechnung: Record<string, string | number> = {}): string {
  const blatt = (z: Record<string, string | number>) => {
    const ws: Record<string, unknown> = { '!ref': 'A1:T100' };
    for (const [adr, wert] of Object.entries(z)) ws[adr] = { v: wert, t: typeof wert === 'number' ? 'n' : 's' };
    return ws as WorkSheet;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, blatt(zellen), 'Daten');
  XLSX.utils.book_append_sheet(wb, blatt(rechnung), 'Rechnung');
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }).toString('base64');
}

const basis = {
  A1: 'B', C2: 'Frau Test', F2: 46224, C4: 'B-7-26', C7: 'Anzahlung', C9: 'Lieferung', F9: 46226, F11: '8:30 - 12:00 Uhr', C13: 'Zentrallager',
  F13: 49, F15: 'Keine Montage', F17: 5, C19: 'Frau', C20: 'Muster', E20: 'Erika', C21: 'Teststr. 1', C22: '12345', C23: 'Musterstadt', C24: '0123',
  C25: '3.OG ohne Aufzug', B30: 'Schrank', D30: 1, E30: 250, B31: 'Düsselpass 30%', D31: 1, E31: -75,
};

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

test('Datum aus Excel-Seriennummer und Text', () => {
  assert.equal(datumAus(46224), '2026-07-21');
  assert.equal(datumAus('5.3.26'), '2026-03-05');
  assert.equal(datumAus('offen'), null);
});

test('Prüfen zeigt die Auswertung ohne zu speichern', async () => {
  const r = await rufe('POST', '/api/admin/import/altrechnungen', { nurPruefen: true, dateien: [{ name: 'B-7-26.xls', base64: altdatei(basis, { D39: 50, E40: 224 }) }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = r.json[0];
  assert.equal(a.status, 'geprueft');
  assert.equal(a.nummer, 'B-7-26');
  assert.equal(a.filiale, 'B');
  assert.equal(a.kunde, 'Erika Muster');
  assert.equal(a.bruttoCent, 25000 - 7500 + 4900);
  assert.equal(a.anzahlungCent, 5000);
  assert.equal((await rufe('GET', '/api/vorgaenge?q=B-7-26')).json.length, 0);
});

test('Import legt festgeschriebenen Vorgang mit Zahlung an; Dubletten werden übersprungen; Nummernkreis zieht nach', async () => {
  const dateien = [
    { name: 'B-7-26.xls', base64: altdatei(basis, { D39: 50, E40: 224 }) },
    { name: 'B-8-26.xls', base64: altdatei({ ...basis, C4: 'B-8-26ec', C7: 'Barverkauf', C9: 'Mitnahme', B31: '', E31: '' }) },
    { name: 'kaputt.xls', base64: Buffer.from('kein excel').toString('base64') },
    { name: 'X-1-26.xls', base64: altdatei({ ...basis, A1: 'X', C4: 'X-1-26' }) },
  ];
  const r = await rufe('POST', '/api/admin/import/altrechnungen', { dateien });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.map((x: { status: string }) => x.status), ['importiert', 'importiert', 'fehler', 'fehler']);
  assert.match(r.json[3].meldung, /Filiale X/);

  const v = await rufe('GET', `/api/vorgaenge/${r.json[0].vorgangId}`);
  assert.equal(v.json.status, 'festgeschrieben');
  assert.equal(v.json.nummer, 'B-7-26');
  assert.equal(v.json.datum, '2026-07-21');
  assert.equal(v.json.lieferung.etage, 3);
  assert.equal(v.json.lieferung.lieferkostenCent, 4900);
  assert.equal(v.json.bezahltCent, 5000);
  assert.equal(v.json.offenCent, 22400 - 5000);
  assert.equal((await rufe('GET', `/api/vorgaenge/${v.json.id}/pdf/rechnung`)).status, 200); // ohne Archiv live erzeugt

  const bar = await rufe('GET', `/api/vorgaenge/${r.json[1].vorgangId}`);
  assert.equal(bar.json.zahlungen[0].mittel, 'ec');
  assert.equal(bar.json.offenCent, 0);

  const nochmal = await rufe('POST', '/api/admin/import/altrechnungen', { dateien: [dateien[0]] });
  assert.equal(nochmal.json[0].status, 'uebersprungen');

  // Neue Rechnung in Filiale B bekommt die 9 (Jahr der importierten Nummer: 2026)
  const d = leererVorgang(7);
  d.kunde = { ...d.kunde, name: 'Neu' };
  d.positionen = [{ menge: 1, text: 'Stuhl', preisCent: 1000, ust: 7, lagerort: '', kennzeichen: [] }];
  const neu = await rufe('POST', '/api/vorgaenge', d);
  const f = await rufe('POST', `/api/vorgaenge/${neu.json.id}/festschreiben`);
  const jahr = new Date().getFullYear();
  assert.equal(f.json.nummer, jahr === 2026 ? 'B-9-26' : `B-1-${String(jahr).slice(2)}`);
});
