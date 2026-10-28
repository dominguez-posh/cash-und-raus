import { useState } from 'react';
import type { Artikel, Lagerort } from '../../shared/lager.ts';
import type { Benutzer, Einstellungen, Filiale, GraphKonfig, ProtokollEintrag, Rolle } from '../../shared/types.ts';
import { ROLLEN, ROLLEN_NAMEN } from '../../shared/types.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, hashParameter, Meldung, useAktion, useLaden } from '../ui.tsx';
import { EntraVerbinden } from './Plattform.tsx';

type Reiter = 'firma' | 'filialen' | 'benutzer' | 'artikel' | 'anmeldung' | 'email' | 'import' | 'protokoll';

export function Admin({ neuLaden, mandantId }: { neuLaden: () => Promise<void>; mandantId: string }) {
  const [reiter, setReiter] = useState<Reiter>(() => (location.hash.includes('entra=') ? 'anmeldung' : 'firma'));
  const titel: [Reiter, string][] = [
    ['firma', 'Firma & Logo'],
    ['filialen', 'Filialen'],
    ['benutzer', 'Benutzer'],
    ['artikel', 'Artikel & Lager'],
    ['anmeldung', 'Anmeldung'],
    ['email', 'E-Mail'],
    ['import', 'Import'],
    ['protokoll', 'Protokoll'],
  ];
  return (
    <>
      <h1>Verwaltung</h1>
      <div className="reiter" role="tablist">
        {titel.map(([r, t]) => (
          <button key={r} role="tab" aria-selected={reiter === r} className={reiter === r ? 'aktiv' : ''} onClick={() => setReiter(r)}>
            {t}
          </button>
        ))}
      </div>
      {reiter === 'firma' && <Firma neuLaden={neuLaden} />}
      {reiter === 'filialen' && <Filialen neuLaden={neuLaden} />}
      {reiter === 'benutzer' && <BenutzerListe />}
      {reiter === 'artikel' && <ArtikelUndLager />}
      {reiter === 'anmeldung' && <Anmeldung mandantId={mandantId} />}
      {reiter === 'email' && <EmailEinstellungen />}
      {reiter === 'import' && <Import />}
      {reiter === 'protokoll' && <Protokoll pfad="/api/admin/protokoll" />}
    </>
  );
}

// ---------- Import Altsystem ----------

interface ImportZeile {
  datei: string;
  nummer: string;
  status: 'geprueft' | 'importiert' | 'uebersprungen' | 'fehler';
  meldung: string;
  filiale?: string;
  datum?: string;
  kunde?: string;
  bruttoCent?: number;
  anzahlungCent?: number;
  vorgangId?: number;
}

function Import() {
  const [dateien, setDateien] = useState<File[]>([]);
  const [zeilen, setZeilen] = useState<ImportZeile[]>([]);
  const [geprueft, setGeprueft] = useState(false);
  const a = useAktion();
  const lesen = (f: File) =>
    new Promise<string>((ok, fehler) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => fehler(new Error(`${f.name} konnte nicht gelesen werden`));
      r.readAsDataURL(f);
    });
  const senden = (nurPruefen: boolean) =>
    a.ausfuehren(async () => {
      const ergebnis: ImportZeile[] = [];
      for (let i = 0; i < dateien.length; i += 10) {
        const teil = dateien.slice(i, i + 10);
        const daten = await Promise.all(teil.map(async (f) => ({ name: f.name, base64: await lesen(f) })));
        ergebnis.push(...(await api.post<ImportZeile[]>('/api/admin/import/altrechnungen', { nurPruefen, dateien: daten })));
        setZeilen([...ergebnis]);
      }
      setGeprueft(nurPruefen);
    });
  const euroText = (c?: number) => (c === undefined ? '' : (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
  return (
    <div className="karte">
      <h2>Altrechnungen importieren</h2>
      <p className="leise">
        Rechnungsdateien des Altsystems (eine <code>.xls</code> je Rechnung, z. B. <code>B-1-26.xls</code>). Die Filiale muss vorher mit demselben
        Kürzel angelegt sein. Erst prüfen, dann importieren; bereits vorhandene Nummern werden übersprungen. Importierte Rechnungen sind
        festgeschrieben, der Nummernkreis läuft hinter der höchsten importierten Nummer weiter.
      </p>
      <div className="knopfreihe" style={{ marginTop: 0 }}>
        <label className="knopf">
          Dateien wählen
          <input type="file" accept=".xls" multiple hidden onChange={(ev) => { setDateien([...(ev.target.files ?? [])]); setZeilen([]); setGeprueft(false); }} />
        </label>
        <span className="leise">{dateien.length ? `${dateien.length} Datei(en)` : 'keine Dateien gewählt'}</span>
        <button onClick={() => senden(true)} disabled={a.laeuft || !dateien.length}>Prüfen</button>
        <button className="primaer" onClick={() => senden(false)} disabled={a.laeuft || !dateien.length || !geprueft}>Importieren</button>
      </div>
      <Meldung>{a.fehler}</Meldung>
      {zeilen.length > 0 && (
        <div className="tabelle-huelle" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Datei</th><th>Nummer</th><th>Filiale</th><th>Datum</th><th>Kunde</th><th className="zahl">Brutto</th><th className="zahl">Anzahlung</th><th>Status</th></tr></thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.datei}>
                  <td className="mono">{z.datei}</td>
                  <td>{z.vorgangId ? <a href={`#/verkauf/${z.vorgangId}`}>{z.nummer}</a> : z.nummer}</td>
                  <td>{z.filiale}</td>
                  <td>{z.datum?.split('-').reverse().join('.')}</td>
                  <td>{z.kunde}</td>
                  <td className="zahl">{euroText(z.bruttoCent)}</td>
                  <td className="zahl">{euroText(z.anzahlungCent)}</td>
                  <td>
                    <span className={`marker ${z.status === 'fehler' ? 'rot' : z.status === 'importiert' ? 'gruen' : ''}`}>{z.status}</span>
                    {z.meldung && <div className="leise">{z.meldung}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Artikel und Lagerorte ----------

type ArtikelForm = Omit<Artikel, 'id' | 'bestand'> & { id?: number };
const LEERER_ARTIKEL: ArtikelForm = { nummer: '', bezeichnung: '', preisCent: 0, ust: 7, lagerortId: null, aktiv: true };

function ArtikelUndLager() {
  const artikel = useLaden(() => api.get<Artikel[]>('/api/artikel?alle=1'));
  const lagerorte = useLaden(() => api.get<Lagerort[]>('/api/lagerorte'));
  const einst = useLaden(() => api.get<Einstellungen>('/api/admin/einstellungen'));
  const filialen = useLaden(() => api.get<Filiale[]>('/api/admin/filialen'));
  const [bearbeiten, setBearbeiten] = useState<ArtikelForm | null>(null);
  const [lagerort, setLagerort] = useState<(Omit<Lagerort, 'id'> & { id?: number }) | null>(null);
  const a = useAktion();
  const lagerName = (id: number | null) => lagerorte.daten?.find((l) => l.id === id)?.name ?? '–';
  const euroText = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  return (
    <>
      <div className="karte">
        <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Lagerorte</h2>
          <button className="primaer" onClick={() => setLagerort({ name: '', filialeId: null, aktiv: true })}>Neuer Lagerort</button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Filiale</th><th>Status</th></tr></thead>
          <tbody>
            {lagerorte.daten?.map((l) => (
              <tr key={l.id} className="klickbar" onClick={() => setLagerort(l)}>
                <td>{l.name}</td>
                <td>{filialen.daten?.find((f) => f.id === l.filialeId)?.kuerzel ?? 'zentral'}</td>
                <td><span className={`marker ${l.aktiv ? 'gruen' : 'rot'}`}>{l.aktiv ? 'aktiv' : 'inaktiv'}</span></td>
              </tr>
            ))}
            {lagerorte.daten?.length === 0 && <tr><td colSpan={3} className="leise">Noch keine Lagerorte. Ohne Lagerort wird kein Bestand geführt.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="karte">
        <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Artikel</h2>
          <button className="primaer" onClick={() => setBearbeiten({ ...LEERER_ARTIKEL, ust: einst.daten?.ustSatz ?? 7 })}>Neuer Artikel</button>
        </div>
        <p className="leise">Im Verkauf erscheinen aktive Artikel als Vorschlag im Artikelfeld; beim Festschreiben wird vom Lagerort abgebucht.</p>
        <Meldung>{artikel.fehler}</Meldung>
        <div className="tabelle-huelle">
          <table>
            <thead><tr><th>Nr.</th><th>Bezeichnung</th><th className="zahl">Preis</th><th className="zahl">USt</th><th>Lagerort</th><th className="zahl">Bestand</th><th>Status</th></tr></thead>
            <tbody>
              {artikel.daten?.map((x) => (
                <tr key={x.id} className="klickbar" onClick={() => setBearbeiten(x)}>
                  <td className="mono">{x.nummer}</td>
                  <td>{x.bezeichnung}</td>
                  <td className="zahl">{euroText(x.preisCent)}</td>
                  <td className="zahl">{x.ust} %</td>
                  <td>{lagerName(x.lagerortId)}</td>
                  <td className="zahl">{x.bestand}</td>
                  <td><span className={`marker ${x.aktiv ? 'gruen' : 'rot'}`}>{x.aktiv ? 'aktiv' : 'inaktiv'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {lagerort && (
        <Dialog titel={lagerort.id ? lagerort.name : 'Neuer Lagerort'} schliessen={() => setLagerort(null)}>
          <div className="raster">
            <Feld titel="Name"><input value={lagerort.name} onChange={(e) => setLagerort({ ...lagerort, name: e.target.value })} /></Feld>
            <Feld titel="Filiale (leer = zentral)">
              <select value={lagerort.filialeId ?? ''} onChange={(e) => setLagerort({ ...lagerort, filialeId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">zentral</option>
                {filialen.daten?.map((f) => <option key={f.id} value={f.id}>{f.kuerzel} {f.name}</option>)}
              </select>
            </Feld>
            <label className="haken breit"><input type="checkbox" checked={lagerort.aktiv} onChange={(e) => setLagerort({ ...lagerort, aktiv: e.target.checked })} /> aktiv</label>
          </div>
          <Meldung>{a.fehler}</Meldung>
          <div className="knopfreihe">
            <button className="primaer" disabled={a.laeuft} onClick={() => a.ausfuehren(async () => {
              const { id, ...rest } = lagerort;
              if (id) await api.put(`/api/lagerorte/${id}`, rest);
              else await api.post('/api/lagerorte', rest);
              setLagerort(null);
              lagerorte.neu();
            })}>Speichern</button>
            <button onClick={() => setLagerort(null)}>Abbrechen</button>
          </div>
        </Dialog>
      )}

      {bearbeiten && (
        <Dialog titel={bearbeiten.id ? bearbeiten.bezeichnung : 'Neuer Artikel'} schliessen={() => setBearbeiten(null)}>
          <div className="raster">
            <Feld titel="Artikelnummer (optional)"><input value={bearbeiten.nummer} onChange={(e) => setBearbeiten({ ...bearbeiten, nummer: e.target.value })} className="mono" /></Feld>
            <Feld titel="Bezeichnung" breit><input value={bearbeiten.bezeichnung} onChange={(e) => setBearbeiten({ ...bearbeiten, bezeichnung: e.target.value })} /></Feld>
            <Feld titel="Preis brutto (€)">
              <input inputMode="decimal" value={(bearbeiten.preisCent / 100).toFixed(2).replace('.', ',')} onChange={(e) => {
                const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
                if (Number.isFinite(n)) setBearbeiten({ ...bearbeiten, preisCent: Math.round(n * 100) });
              }} />
            </Feld>
            <Feld titel="USt">
              <select value={bearbeiten.ust} onChange={(e) => setBearbeiten({ ...bearbeiten, ust: Number(e.target.value) })}>
                {(einst.daten?.ustSaetze ?? [bearbeiten.ust]).map((s) => <option key={s} value={s}>{s} %</option>)}
              </select>
            </Feld>
            <Feld titel="Standard-Lagerort">
              <select value={bearbeiten.lagerortId ?? ''} onChange={(e) => setBearbeiten({ ...bearbeiten, lagerortId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">kein Bestand</option>
                {lagerorte.daten?.filter((l) => l.aktiv).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Feld>
            <label className="haken breit"><input type="checkbox" checked={bearbeiten.aktiv} onChange={(e) => setBearbeiten({ ...bearbeiten, aktiv: e.target.checked })} /> aktiv (im Verkauf wählbar)</label>
          </div>
          <Meldung>{a.fehler}</Meldung>
          <div className="knopfreihe">
            <button className="primaer" disabled={a.laeuft} onClick={() => a.ausfuehren(async () => {
              const { id, ...rest } = bearbeiten;
              if (id) await api.put(`/api/artikel/${id}`, rest);
              else await api.post('/api/artikel', rest);
              setBearbeiten(null);
              artikel.neu();
            })}>Speichern</button>
            <button onClick={() => setBearbeiten(null)}>Abbrechen</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------- Firmenanmeldung ----------

interface AnmeldungStand {
  saml: { aktiv: boolean; emailDomaenen: string[]; idpEntityId: string; zertifikate: number } | null;
  sp: { entityId: string; acsUrl: string; metadatenUrl: string };
  entraBereit: boolean;
}

function Anmeldung({ mandantId }: { mandantId: string }) {
  const { daten, fehler } = useLaden(() => api.get<AnmeldungStand>('/api/admin/anmeldung'));
  const [p] = useState(() => hashParameter());
  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!daten) return null;
  return (
    <div className="karte">
      <h2>Anmeldung mit dem Firmenkonto (Microsoft 365)</h2>
      {p.get('entra') && (
        <Meldung art={p.get('entra') === 'ok' ? 'ok' : 'fehler'}>
          {p.get('entra') === 'ok' ? 'Firmenanmeldung eingerichtet. ' : 'Einrichtung fehlgeschlagen: '}
          {p.get('meldung')}
        </Meldung>
      )}
      <p>
        Stand:{' '}
        {daten.saml?.aktiv ? (
          <span className="marker gruen">aktiv</span>
        ) : daten.saml ? (
          <span className="marker">eingerichtet, nicht aktiv</span>
        ) : (
          <span className="marker rot">nicht eingerichtet</span>
        )}
        {daten.saml?.emailDomaenen.map((d) => <span key={d} className="marker">{d}</span>)}
      </p>
      <p className="leise">
        Mit einem Klick: Sie melden sich als Administrator Ihres Microsoft-365-Tenants an und stimmen zu. Danach legt die Anwendung die
        Unternehmensanwendung mit SAML-Anmeldung in Ihrem Tenant an, erstellt das Signaturzertifikat und schaltet die Anmeldung frei.
        Benutzer müssen zusätzlich unter „Benutzer“ angelegt sein.
      </p>
      {daten.entraBereit ? (
        <EntraVerbinden mandantId={mandantId} zurueck="admin" />
      ) : (
        <Meldung art="hinweis">Die automatische Einrichtung ist auf der Plattform noch nicht freigeschaltet; bitte die Plattform-Administration ansprechen.</Meldung>
      )}
      <p className="leise" style={{ marginTop: 16 }}>Für eine manuelle Einrichtung: Bezeichner (Entity ID) <code>{daten.sp.entityId}</code>, Antwort-URL <code>{daten.sp.acsUrl}</code>.</p>
    </div>
  );
}

// ---------- E-Mail (Microsoft Graph) ----------

function EmailEinstellungen() {
  const { daten, fehler, neu } = useLaden(() => api.get<GraphKonfig | null>('/api/admin/email'));
  const [k, setK] = useState<GraphKonfig | null>(null);
  const [secret, setSecret] = useState('');
  const [testAn, setTestAn] = useState('');
  const a = useAktion();
  if (fehler) return <Meldung>{fehler}</Meldung>;
  const w: GraphKonfig = k ?? daten ?? { tenantId: '', clientId: '', clientSecretVorhanden: false, absender: '', aktiv: false, letzterTest: null };
  const feld = (key: 'tenantId' | 'clientId' | 'absender', titel: string, hinweis?: string) => (
    <Feld titel={titel}>
      <input value={w[key]} onChange={(ev) => setK({ ...w, [key]: ev.target.value })} className={key === 'absender' ? '' : 'mono'} />
      {hinweis && <span className="leise">{hinweis}</span>}
    </Feld>
  );
  const speichern = () =>
    a.ausfuehren(async () => {
      await api.put('/api/admin/email', { tenantId: w.tenantId, clientId: w.clientId, clientSecret: secret || null, absender: w.absender, aktiv: w.aktiv });
      setSecret('');
      setK(null);
      neu();
    }, 'Gespeichert.');
  return (
    <div className="karte">
      <h2>E-Mail-Versand über Microsoft 365</h2>
      <p className="leise">
        Rechnungen und Lieferscheine werden über Microsoft Graph aus einem Postfach Ihres Microsoft-365-Tenants gesendet. Dafür braucht es
        eine App-Registrierung in Entra ID mit der Anwendungsberechtigung <code>Mail.Send</code> (mit Admin-Zustimmung) und ein Client-Secret.
        Empfehlung: in Exchange Online eine „Application Access Policy“ anlegen, damit die App nur dieses Postfach nutzen darf.
      </p>
      <div className="raster">
        {feld('tenantId', 'Tenant-ID (Verzeichnis-ID)')}
        {feld('clientId', 'Client-ID (Anwendungs-ID)')}
        <Feld titel={w.clientSecretVorhanden ? 'Client-Secret (leer lassen = unverändert)' : 'Client-Secret'}>
          <input type="password" value={secret} onChange={(ev) => setSecret(ev.target.value)} autoComplete="new-password" />
        </Feld>
        {feld('absender', 'Absender-Postfach', 'z. B. rechnung@ihre-firma.de (Postfach oder freigegebenes Postfach)')}
        <label className="haken breit">
          <input type="checkbox" checked={w.aktiv} onChange={(ev) => setK({ ...w, aktiv: ev.target.checked })} /> Versand aktiv
        </label>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <Meldung art="ok">{a.ok}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" onClick={speichern} disabled={a.laeuft}>Speichern</button>
      </div>
      {daten?.aktiv && (
        <>
          <h3 style={{ marginTop: 20 }}>Testnachricht</h3>
          <p className="leise">Letzter erfolgreicher Test: {datumZeit(daten.letzterTest)}</p>
          <div className="knopfreihe" style={{ marginTop: 0 }}>
            <input type="email" placeholder="Empfänger" value={testAn} onChange={(ev) => setTestAn(ev.target.value)} style={{ maxWidth: 320 }} />
            <button
              onClick={() =>
                a.ausfuehren(async () => {
                  await api.post('/api/admin/email/test', { an: testAn });
                  neu();
                }, 'Testnachricht gesendet.')
              }
              disabled={a.laeuft || !testAn}
            >
              Senden
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Firma ----------

function Firma({ neuLaden }: { neuLaden: () => Promise<void> }) {
  const { daten, fehler, neu } = useLaden(() => api.get<Einstellungen>('/api/admin/einstellungen'));
  const [e, setE] = useState<Einstellungen | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const a = useAktion();
  const werte = e ?? daten;
  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!werte) return null;

  const feld = (k: keyof Einstellungen, titel: string, breit = false) => (
    <Feld titel={titel} breit={breit}>
      <input value={String(werte[k] ?? '')} onChange={(ev) => setE({ ...werte, [k]: ev.target.value })} />
    </Feld>
  );

  const speichern = () =>
    a.ausfuehren(async () => {
      const { hatLogo: _, ...rest } = werte;
      await api.put('/api/admin/einstellungen', { ...rest, ustSatz: Number(rest.ustSatz) });
      await neuLaden();
    }, 'Gespeichert.');

  const logoWaehlen = (datei: File | undefined) => {
    if (!datei) return;
    const leser = new FileReader();
    leser.onload = () =>
      a.ausfuehren(async () => {
        await api.put('/api/admin/logo', { dataUrl: leser.result });
        setLogoVersion((v) => v + 1);
        neu();
        await neuLaden();
      }, 'Logo gespeichert.');
    leser.readAsDataURL(datei);
  };

  return (
    <>
      <div className="karte">
        <h2>Firmendaten</h2>
        <p className="leise">Erscheinen auf Rechnungen, Lieferscheinen und Belegen.</p>
        <div className="raster">
          {feld('firmenname', 'Firmenname', true)}
          {feld('strasse', 'Straße, Nr.')}
          {feld('plz', 'PLZ')}
          {feld('ort', 'Ort')}
          {feld('telefon', 'Telefon')}
          {feld('email', 'E-Mail')}
          {feld('web', 'Webseite')}
          {feld('steuernummer', 'Steuernummer')}
          {feld('ustId', 'USt-IdNr.')}
          {feld('bankName', 'Bank')}
          {feld('iban', 'IBAN')}
          {feld('bic', 'BIC')}
          <Feld titel="Rechnungsnummer ({F} Filiale, {N} Nummer, {JJ}/{JJJJ} Jahr)">
            <input value={werte.nummernformat} onChange={(ev) => setE({ ...werte, nummernformat: ev.target.value })} />
          </Feld>
          <Feld titel="Fußtext" breit>
            <textarea value={werte.fusstext} onChange={(ev) => setE({ ...werte, fusstext: ev.target.value })} />
          </Feld>
        </div>
      </div>

      <VerkaufEinstellungen werte={werte} setE={setE} />

      <div className="karte">
        <Meldung>{a.fehler}</Meldung>
        <Meldung art="ok">{a.ok}</Meldung>
        <div className="knopfreihe" style={{ marginTop: 0 }}>
          <button className="primaer" onClick={speichern} disabled={a.laeuft}>Speichern</button>
        </div>
      </div>

      <div className="karte">
        <h2>Logo</h2>
        {werte.hatLogo ? (
          <p><img src={`/api/mandant/logo?v=${logoVersion}`} alt="Logo" style={{ maxHeight: 80, maxWidth: 300 }} /></p>
        ) : (
          <p className="leise">Noch kein Logo hinterlegt.</p>
        )}
        <div className="knopfreihe">
          <label className="knopf">
            Logo hochladen
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(ev) => logoWaehlen(ev.target.files?.[0])} />
          </label>
          {werte.hatLogo && (
            <button
              className="gefahr"
              onClick={() =>
                a.ausfuehren(async () => {
                  await api.put('/api/admin/logo', { dataUrl: null });
                  neu();
                  await neuLaden();
                }, 'Logo entfernt.')
              }
            >
              Entfernen
            </button>
          )}
        </div>
        <p className="leise">PNG, JPEG, SVG oder WebP, höchstens 1 MB.</p>
      </div>
    </>
  );
}

function VerkaufEinstellungen({ werte, setE }: { werte: Einstellungen; setE: (e: Einstellungen) => void }) {
  const [saetze, setSaetze] = useState(werte.ustSaetze.join(', '));
  const [zeiten, setZeiten] = useState(werte.lieferzeiten.join('\n'));
  const [gruende, setGruende] = useState(werte.belegGruende.join('\n'));
  const rabatte = werte.rabattarten;
  const setRabatt = (i: number, r: Partial<Einstellungen['rabattarten'][number]>) =>
    setE({ ...werte, rabattarten: rabatte.map((x, j) => (j === i ? { ...x, ...r } : x)) });
  const setHinweis = (i: number, text: string) => setE({ ...werte, hinweise: werte.hinweise.map((x, j) => (j === i ? { ...x, text } : x)) });
  return (
    <div className="karte">
      <h2>Verkauf</h2>
      <div className="raster">
        <Feld titel="Wählbare USt-Sätze in % (mit Komma getrennt)">
          <input
            value={saetze}
            onChange={(ev) => {
              setSaetze(ev.target.value);
              const liste = ev.target.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
              setE({ ...werte, ustSaetze: liste });
            }}
          />
        </Feld>
        <Feld titel="Standardsatz (neue Artikel, Lieferung, Montage)">
          <select value={werte.ustSatz} onChange={(ev) => setE({ ...werte, ustSatz: Number(ev.target.value) })}>
            {[...new Set([werte.ustSatz, ...werte.ustSaetze])].map((s) => <option key={s} value={s}>{s} %</option>)}
          </select>
        </Feld>
        <Feld titel="Lieferzeitfenster (eines je Zeile)" breit>
          <textarea
            value={zeiten}
            onChange={(ev) => {
              setZeiten(ev.target.value);
              setE({ ...werte, lieferzeiten: ev.target.value.split('\n').map((z) => z.trim()).filter(Boolean) });
            }}
          />
        </Feld>
      </div>

      <h3 style={{ marginTop: 16 }}>Kasse: Gründe für Belege</h3>
      <Feld titel="Einer je Zeile (Auswahl beim Beleg)">
        <textarea value={gruende} onChange={(ev) => {
          setGruende(ev.target.value);
          setE({ ...werte, belegGruende: ev.target.value.split('\n').map((z) => z.trim()).filter(Boolean) });
        }} />
      </Feld>

      <h3 style={{ marginTop: 16 }}>Rabattarten</h3>
      <p className="leise">Werden im Verkauf als Knopf angeboten und gelten für die Artikel, nicht für Lieferung und Montage.</p>
      <table>
        <thead><tr><th>Kürzel</th><th>Name</th><th>%</th><th /></tr></thead>
        <tbody>
          {rabatte.map((r, i) => (
            <tr key={i}>
              <td><input value={r.kuerzel} onChange={(ev) => setRabatt(i, { kuerzel: ev.target.value })} style={{ maxWidth: 100 }} /></td>
              <td><input value={r.name} onChange={(ev) => setRabatt(i, { name: ev.target.value })} /></td>
              <td><input type="number" min={1} max={100} value={r.prozent} onChange={(ev) => setRabatt(i, { prozent: Number(ev.target.value) })} style={{ maxWidth: 90 }} /></td>
              <td><button className="gefahr" onClick={() => setE({ ...werte, rabattarten: rabatte.filter((_, j) => j !== i) })}>Entfernen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="knopfreihe">
        <button onClick={() => setE({ ...werte, rabattarten: [...rabatte, { kuerzel: '', name: '', prozent: 10 }] })}>Rabattart hinzufügen</button>
      </div>

      <h3 style={{ marginTop: 16 }}>Hinweistexte zu Artikeln</h3>
      <p className="leise">Im Verkauf je Artikel ankreuzbar; der Text steht dann mit Kennzeichen auf Rechnung und Lieferschein.</p>
      <div className="stapel">
        {werte.hinweise.map((h, i) => (
          <Feld key={h.zeichen} titel={`(${h.zeichen})`}>
            <textarea value={h.text} onChange={(ev) => setHinweis(i, ev.target.value)} style={{ minHeight: 56 }} />
          </Feld>
        ))}
      </div>
      <div className="knopfreihe">
        {werte.hinweise.length < 3 && (
          <button onClick={() => setE({ ...werte, hinweise: [...werte.hinweise, { zeichen: '*'.repeat(werte.hinweise.length + 1), text: '' }] })}>Hinweis hinzufügen</button>
        )}
        {werte.hinweise.length > 0 && (
          <button className="gefahr" onClick={() => setE({ ...werte, hinweise: werte.hinweise.slice(0, -1) })}>Letzten Hinweis entfernen</button>
        )}
      </div>
    </div>
  );
}

// ---------- Filialen ----------

const LEERE_FILIALE: Omit<Filiale, 'id'> & { id?: number } = {
  kuerzel: '', name: '', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', ipBereiche: [], aktiv: true, wechselgeldCent: 0,
};

function Filialen({ neuLaden }: { neuLaden: () => Promise<void> }) {
  const { daten, fehler, neu } = useLaden(() => api.get<Filiale[]>('/api/admin/filialen'));
  const [bearbeiten, setBearbeiten] = useState<typeof LEERE_FILIALE | null>(null);
  if (fehler) return <Meldung>{fehler}</Meldung>;
  return (
    <div className="karte">
      <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Filialen</h2>
        <button className="primaer" onClick={() => setBearbeiten({ ...LEERE_FILIALE })}>Neue Filiale</button>
      </div>
      <p className="leise">Mit IP-Bereichen wird die Filiale beim Anmelden automatisch erkannt (feste öffentliche IP der Filiale).</p>
      <div className="tabelle-huelle">
        <table>
          <thead>
            <tr><th>Kürzel</th><th>Name</th><th>Adresse</th><th>IP-Erkennung</th><th>Status</th></tr>
          </thead>
          <tbody>
            {daten?.map((f) => (
              <tr key={f.id} className="klickbar" onClick={() => setBearbeiten(f)}>
                <td><strong>{f.kuerzel}</strong></td>
                <td>{f.name}</td>
                <td>{[f.strasse, `${f.plz} ${f.ort}`.trim()].filter(Boolean).join(', ')}</td>
                <td>{f.ipBereiche.length ? f.ipBereiche.map((b) => <span key={b} className="marker mono">{b}</span>) : <span className="leise">–</span>}</td>
                <td><span className={`marker ${f.aktiv ? 'gruen' : 'rot'}`}>{f.aktiv ? 'aktiv' : 'inaktiv'}</span></td>
              </tr>
            ))}
            {daten?.length === 0 && <tr><td colSpan={5} className="leise">Noch keine Filialen.</td></tr>}
          </tbody>
        </table>
      </div>
      {bearbeiten && (
        <FilialDialog
          filiale={bearbeiten}
          schliessen={() => setBearbeiten(null)}
          gespeichert={async () => {
            setBearbeiten(null);
            neu();
            await neuLaden();
          }}
        />
      )}
    </div>
  );
}

function FilialDialog({ filiale, schliessen, gespeichert }: { filiale: typeof LEERE_FILIALE; schliessen: () => void; gespeichert: () => void }) {
  const [f, setF] = useState(filiale);
  const [ipText, setIpText] = useState(filiale.ipBereiche.join('\n'));
  const a = useAktion();
  const text = (k: keyof typeof f, titel: string) => (
    <Feld titel={titel}>
      <input value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Feld>
  );
  const speichern = () =>
    a.ausfuehren(async () => {
      const daten = { ...f, ipBereiche: ipText.split(/[\s,;]+/).filter(Boolean) };
      delete daten.id;
      if (f.id) await api.put(`/api/admin/filialen/${f.id}`, daten);
      else await api.post('/api/admin/filialen', daten);
      gespeichert();
    });
  const meineIp = () =>
    a.ausfuehren(async () => {
      const { ip } = await api.get<{ ip: string }>('/api/admin/meine-ip');
      setIpText((t) => (t.split(/\s+/).includes(ip) ? t : `${t.trim()}\n${ip}`.trim()));
    });
  return (
    <Dialog titel={f.id ? `Filiale ${filiale.kuerzel}` : 'Neue Filiale'} schliessen={schliessen}>
      <div className="raster">
        {text('kuerzel', 'Kürzel (für Rechnungsnummern)')}
        {text('name', 'Name')}
        {text('strasse', 'Straße, Nr.')}
        {text('plz', 'PLZ')}
        {text('ort', 'Ort')}
        {text('telefon', 'Telefon')}
        {text('fax', 'Fax')}
        {text('email', 'E-Mail')}
        <Feld titel="Wechselgeld in der Barkasse (fester Anfangsbestand, €)">
          <input inputMode="decimal" value={(f.wechselgeldCent / 100).toFixed(2).replace('.', ',')} onChange={(e) => {
            const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
            if (Number.isFinite(n)) setF({ ...f, wechselgeldCent: Math.round(n * 100) });
          }} />
        </Feld>
        <Feld titel="IP-Adressen / Bereiche (eine je Zeile, z. B. 203.0.113.10 oder 203.0.113.0/29)" breit>
          <textarea className="mono" value={ipText} onChange={(e) => setIpText(e.target.value)} />
        </Feld>
        <label className="haken breit">
          <input type="checkbox" checked={f.aktiv} onChange={(e) => setF({ ...f, aktiv: e.target.checked })} /> aktiv
        </label>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" onClick={speichern} disabled={a.laeuft}>Speichern</button>
        <button onClick={meineIp} disabled={a.laeuft}>Meine aktuelle IP eintragen</button>
        <button onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}

// ---------- Benutzer ----------

type BenutzerForm = Pick<Benutzer, 'email' | 'name' | 'rollen' | 'alleFilialen' | 'filialIds' | 'aktiv'> & { id?: number; entraVerknuepft?: boolean };
const LEERER_BENUTZER: BenutzerForm = { email: '', name: '', rollen: ['verkauf'], alleFilialen: false, filialIds: [], aktiv: true };

function BenutzerListe() {
  const benutzer = useLaden(() => api.get<Benutzer[]>('/api/admin/benutzer'));
  const filialen = useLaden(() => api.get<Filiale[]>('/api/admin/filialen'));
  const [bearbeiten, setBearbeiten] = useState<BenutzerForm | null>(null);
  const kuerzel = (id: number) => filialen.daten?.find((f) => f.id === id)?.kuerzel ?? '?';
  if (benutzer.fehler) return <Meldung>{benutzer.fehler}</Meldung>;
  return (
    <div className="karte">
      <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Benutzer</h2>
        <button className="primaer" onClick={() => setBearbeiten({ ...LEERER_BENUTZER })}>Neuer Benutzer</button>
      </div>
      <p className="leise">Anmeldung mit dem Firmenkonto (SAML). Die E-Mail-Adresse muss der Anmeldeadresse im Firmenkonto entsprechen.</p>
      <div className="tabelle-huelle">
        <table>
          <thead>
            <tr><th>Name</th><th>E-Mail</th><th>Rollen</th><th>Filialen</th><th>Letzte Anmeldung</th><th>Status</th></tr>
          </thead>
          <tbody>
            {benutzer.daten?.map((b) => (
              <tr key={b.id} className="klickbar" onClick={() => setBearbeiten(b)}>
                <td>{b.name}</td>
                <td>{b.email}</td>
                <td>{b.rollen.map((r) => <span key={r} className="marker">{ROLLEN_NAMEN[r]}</span>)}</td>
                <td>{b.alleFilialen ? 'alle' : b.filialIds.map(kuerzel).join(', ')}</td>
                <td>{datumZeit(b.letzteAnmeldung)}</td>
                <td><span className={`marker ${b.aktiv ? 'gruen' : 'rot'}`}>{b.aktiv ? 'aktiv' : 'gesperrt'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bearbeiten && (
        <BenutzerDialog
          benutzer={bearbeiten}
          filialen={filialen.daten ?? []}
          schliessen={() => setBearbeiten(null)}
          gespeichert={() => {
            setBearbeiten(null);
            benutzer.neu();
          }}
        />
      )}
    </div>
  );
}

function BenutzerDialog({ benutzer, filialen, schliessen, gespeichert }: { benutzer: BenutzerForm; filialen: Filiale[]; schliessen: () => void; gespeichert: () => void }) {
  const [b, setB] = useState(benutzer);
  const a = useAktion();
  const umschalten = <T,>(liste: T[], wert: T) => (liste.includes(wert) ? liste.filter((x) => x !== wert) : [...liste, wert]);
  const speichern = () =>
    a.ausfuehren(async () => {
      const daten = { email: b.email, name: b.name, rollen: b.rollen, alleFilialen: b.alleFilialen, filialIds: b.filialIds, aktiv: b.aktiv };
      if (b.id) await api.put(`/api/admin/benutzer/${b.id}`, daten);
      else await api.post('/api/admin/benutzer', daten);
      gespeichert();
    });
  return (
    <Dialog titel={b.id ? benutzer.name : 'Neuer Benutzer'} schliessen={schliessen}>
      <div className="raster">
        <Feld titel="Name"><input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Feld>
        <Feld titel="E-Mail (Anmeldename im Firmenkonto)"><input type="email" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} /></Feld>
        <div className="breit">
          <h3>Rollen</h3>
          {ROLLEN.map((r: Rolle) => (
            <label key={r} className="haken" style={{ marginRight: 16 }}>
              <input type="checkbox" checked={b.rollen.includes(r)} onChange={() => setB({ ...b, rollen: umschalten(b.rollen, r) })} /> {ROLLEN_NAMEN[r]}
            </label>
          ))}
        </div>
        <div className="breit">
          <h3>Filialen</h3>
          <label className="haken" style={{ marginRight: 16 }}>
            <input type="checkbox" checked={b.alleFilialen} onChange={(e) => setB({ ...b, alleFilialen: e.target.checked })} /> alle Filialen
          </label>
          {!b.alleFilialen &&
            filialen.map((f) => (
              <label key={f.id} className="haken" style={{ marginRight: 16 }}>
                <input type="checkbox" checked={b.filialIds.includes(f.id)} onChange={() => setB({ ...b, filialIds: umschalten(b.filialIds, f.id) })} /> {f.kuerzel} {f.name}
              </label>
            ))}
        </div>
        <label className="haken breit">
          <input type="checkbox" checked={b.aktiv} onChange={(e) => setB({ ...b, aktiv: e.target.checked })} /> aktiv (darf sich anmelden)
        </label>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" onClick={speichern} disabled={a.laeuft}>Speichern</button>
        {b.id && benutzer.entraVerknuepft && (
          <button
            onClick={() =>
              a.ausfuehren(async () => {
                await api.post(`/api/admin/benutzer/${b.id}/entra-loesen`);
                gespeichert();
              })
            }
          >
            Entra-Verknüpfung lösen
          </button>
        )}
        <button onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}

// ---------- Protokoll ----------

export function Protokoll({ pfad }: { pfad: string }) {
  const { daten, fehler } = useLaden(() => api.get<ProtokollEintrag[]>(pfad), [pfad]);
  if (fehler) return <Meldung>{fehler}</Meldung>;
  return (
    <div className="karte">
      <h2>Protokoll</h2>
      <p className="leise">Die letzten 200 Einträge. Einträge können nicht geändert oder gelöscht werden.</p>
      <div className="tabelle-huelle">
        <table>
          <thead>
            <tr><th>Zeit</th><th>Person</th><th>Aktion</th><th>Objekt</th></tr>
          </thead>
          <tbody>
            {daten?.map((p) => (
              <tr key={p.id} title={p.details}>
                <td>{datumZeit(p.zeit)}</td>
                <td>{p.person}</td>
                <td>{p.aktion}</td>
                <td>{p.objekt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
