import { useState } from 'react';
import type { Benutzer, Einstellungen, Filiale, GraphKonfig, ProtokollEintrag, Rolle } from '../../shared/types.ts';
import { ROLLEN, ROLLEN_NAMEN } from '../../shared/types.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';

type Reiter = 'firma' | 'filialen' | 'benutzer' | 'email' | 'protokoll';

export function Admin({ neuLaden }: { neuLaden: () => Promise<void> }) {
  const [reiter, setReiter] = useState<Reiter>('firma');
  const titel: [Reiter, string][] = [
    ['firma', 'Firma & Logo'],
    ['filialen', 'Filialen'],
    ['benutzer', 'Benutzer'],
    ['email', 'E-Mail'],
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
      {reiter === 'email' && <EmailEinstellungen />}
      {reiter === 'protokoll' && <Protokoll pfad="/api/admin/protokoll" />}
    </>
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
  kuerzel: '', name: '', strasse: '', plz: '', ort: '', telefon: '', fax: '', email: '', ipBereiche: [], aktiv: true,
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
