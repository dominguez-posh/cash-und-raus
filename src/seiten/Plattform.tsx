import { useState } from 'react';
import type { Ich, LokalesKonto, Mandant, SamlKonfig } from '../../shared/types.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { Protokoll } from './Admin.tsx';

type Reiter = 'mandanten' | 'konten' | 'protokoll';

export function Plattform({ ich, neuLaden }: { ich: Ich; neuLaden: () => Promise<void> }) {
  const [reiter, setReiter] = useState<Reiter>('mandanten');
  const titel: [Reiter, string][] = [
    ['mandanten', 'Mandanten'],
    ['konten', 'Lokale Konten'],
    ['protokoll', 'Protokoll'],
  ];
  return (
    <>
      <h1>Plattform</h1>
      <div className="reiter" role="tablist">
        {titel.map(([r, t]) => (
          <button key={r} role="tab" aria-selected={reiter === r} className={reiter === r ? 'aktiv' : ''} onClick={() => setReiter(r)}>
            {t}
          </button>
        ))}
      </div>
      {reiter === 'mandanten' && <Mandanten neuLaden={neuLaden} />}
      {reiter === 'konten' && <Konten ich={ich} />}
      {reiter === 'protokoll' && <Protokoll pfad="/api/plattform/protokoll" />}
    </>
  );
}

// ---------- Mandanten ----------

function Mandanten({ neuLaden }: { neuLaden: () => Promise<void> }) {
  const { daten, fehler, neu } = useLaden(() => api.get<Mandant[]>('/api/plattform/mandanten'));
  const [neuer, setNeuer] = useState(false);
  const [offen, setOffen] = useState<Mandant | null>(null);
  const a = useAktion();
  if (fehler) return <Meldung>{fehler}</Meldung>;

  const betreten = (id: string) =>
    a.ausfuehren(async () => {
      await api.post(`/api/plattform/mandanten/${id}/betreten`);
      location.hash = '#/admin';
      await neuLaden();
    });

  return (
    <div className="karte">
      <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Mandanten</h2>
        <button className="primaer" onClick={() => setNeuer(true)}>Neuer Mandant</button>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <div className="tabelle-huelle">
        <table>
          <thead>
            <tr><th>Kennung</th><th>Name</th><th>Firmenanmeldung</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {daten?.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.id}</td>
                <td>{m.name}</td>
                <td>
                  {m.saml?.aktiv ? <span className="marker gruen">SAML aktiv</span> : <span className="marker">nicht eingerichtet</span>}
                  {m.saml?.emailDomaenen.map((d) => <span key={d} className="marker">{d}</span>)}
                </td>
                <td><span className={`marker ${m.aktiv ? 'gruen' : 'rot'}`}>{m.aktiv ? 'aktiv' : 'gesperrt'}</span></td>
                <td>
                  <div className="knopfreihe" style={{ marginTop: 0 }}>
                    <button onClick={() => setOffen(m)}>Einstellungen</button>
                    <button onClick={() => betreten(m.id)} disabled={a.laeuft}>Betreuen</button>
                  </div>
                </td>
              </tr>
            ))}
            {daten?.length === 0 && <tr><td colSpan={5} className="leise">Noch keine Mandanten.</td></tr>}
          </tbody>
        </table>
      </div>
      {neuer && (
        <NeuerMandant
          schliessen={() => setNeuer(false)}
          fertig={() => {
            setNeuer(false);
            neu();
          }}
        />
      )}
      {offen && (
        <MandantDialog
          mandant={offen}
          schliessen={() => setOffen(null)}
          gespeichert={() => {
            setOffen(null);
            neu();
          }}
        />
      )}
    </div>
  );
}

function NeuerMandant({ schliessen, fertig }: { schliessen: () => void; fertig: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const a = useAktion();
  const anlegen = () =>
    a.ausfuehren(async () => {
      await api.post('/api/plattform/mandanten', {
        id,
        name,
        admin: adminEmail ? { email: adminEmail, name: adminName || adminEmail } : null,
      });
      fertig();
    });
  return (
    <Dialog titel="Neuer Mandant" schliessen={schliessen}>
      <div className="raster">
        <Feld titel="Kennung (z. B. firma, dauerhaft)"><input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} className="mono" /></Feld>
        <Feld titel="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld titel="Erster Admin: E-Mail (Firmenkonto, optional)"><input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></Feld>
        <Feld titel="Erster Admin: Name"><input value={adminName} onChange={(e) => setAdminName(e.target.value)} /></Feld>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" onClick={anlegen} disabled={a.laeuft}>Anlegen</button>
        <button onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}

const LEERE_SAML: SamlKonfig = { idpEntityId: '', idpSsoUrl: '', idpZertifikate: [], emailDomaenen: [], aktiv: false };

function MandantDialog({ mandant, schliessen, gespeichert }: { mandant: Mandant; schliessen: () => void; gespeichert: () => void }) {
  const [name, setName] = useState(mandant.name);
  const [aktiv, setAktiv] = useState(mandant.aktiv);
  const [saml, setSaml] = useState<SamlKonfig>(mandant.saml ?? LEERE_SAML);
  const [zertText, setZertText] = useState((mandant.saml?.idpZertifikate ?? []).join('\n\n'));
  const [domText, setDomText] = useState((mandant.saml?.emailDomaenen ?? []).join(', '));
  const [metaUrl, setMetaUrl] = useState('');
  const a = useAktion();

  const metadatenLaden = () =>
    a.ausfuehren(async () => {
      const r = await api.post<Omit<SamlKonfig, 'emailDomaenen' | 'aktiv'>>('/api/plattform/saml/metadaten', { url: metaUrl });
      setSaml({ ...saml, ...r });
      setZertText(r.idpZertifikate.join('\n\n'));
    }, 'Metadaten übernommen. Bitte prüfen und speichern.');

  const speichern = () =>
    a.ausfuehren(async () => {
      await api.put(`/api/plattform/mandanten/${mandant.id}`, { name, aktiv });
      const zertifikate = zertText.split(/\n\s*\n|-----END CERTIFICATE-----/).map((s) => s.trim()).filter(Boolean);
      const domaenen = domText.split(/[\s,;]+/).filter(Boolean);
      if (saml.idpEntityId || saml.idpSsoUrl || zertifikate.length) {
        await api.put(`/api/plattform/mandanten/${mandant.id}/saml`, { ...saml, idpZertifikate: zertifikate, emailDomaenen: domaenen });
      }
      gespeichert();
    });

  return (
    <Dialog titel={`Mandant ${mandant.id}`} schliessen={schliessen}>
      <div className="raster">
        <Feld titel="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <label className="haken"><input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} /> Mandant aktiv</label>
      </div>

      <h3 style={{ marginTop: 20 }}>Firmenanmeldung (SAML2)</h3>
      <p className="leise">In Entra: Unternehmensanwendungen → Neue Anwendung → Eigene Anwendung erstellen → Einmaliges Anmelden → SAML. Dort eintragen:</p>
      <div className="raster">
        <Feld titel="Bezeichner (Entity ID)"><input readOnly value={mandant.sp.entityId} className="mono" onFocus={(e) => e.target.select()} /></Feld>
        <Feld titel="Antwort-URL (ACS)"><input readOnly value={mandant.sp.acsUrl} className="mono" onFocus={(e) => e.target.select()} /></Feld>
      </div>
      <p className="leise">
        Danach die „App-Verbundmetadaten-URL“ aus Entra hier einfügen oder die Werte manuell eintragen. Benutzer/Gruppen der Unternehmensanwendung zuweisen.
      </p>
      <div className="raster">
        <Feld titel="App-Verbundmetadaten-URL" breit><input value={metaUrl} onChange={(e) => setMetaUrl(e.target.value)} placeholder="https://login.microsoftonline.com/…/federationmetadata/…" /></Feld>
      </div>
      <div className="knopfreihe" style={{ marginTop: 8 }}>
        <button onClick={metadatenLaden} disabled={a.laeuft || !metaUrl}>Metadaten laden</button>
      </div>
      <div className="raster" style={{ marginTop: 12 }}>
        <Feld titel="IdP Entity ID (Microsoft Entra-ID-Bezeichner)" breit><input value={saml.idpEntityId} onChange={(e) => setSaml({ ...saml, idpEntityId: e.target.value })} className="mono" /></Feld>
        <Feld titel="Anmelde-URL des IdP" breit><input value={saml.idpSsoUrl} onChange={(e) => setSaml({ ...saml, idpSsoUrl: e.target.value })} className="mono" /></Feld>
        <Feld titel="Signaturzertifikat(e), Base64 – mehrere durch Leerzeile trennen" breit>
          <textarea value={zertText} onChange={(e) => setZertText(e.target.value)} className="mono" />
        </Feld>
        <Feld titel="E-Mail-Domänen für die Anmeldung (z. B. firma.de)" breit>
          <input value={domText} onChange={(e) => setDomText(e.target.value)} />
        </Feld>
        <label className="haken breit"><input type="checkbox" checked={saml.aktiv} onChange={(e) => setSaml({ ...saml, aktiv: e.target.checked })} /> Firmenanmeldung aktiv</label>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <Meldung art="ok">{a.ok}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" onClick={speichern} disabled={a.laeuft}>Speichern</button>
        <button onClick={schliessen}>Abbrechen</button>
      </div>
    </Dialog>
  );
}

// ---------- lokale Konten ----------

function Konten({ ich }: { ich: Ich }) {
  const { daten, fehler, neu } = useLaden(() => api.get<LokalesKonto[]>('/api/plattform/konten'));
  const [neuer, setNeuer] = useState(false);
  const [benutzername, setBenutzername] = useState('');
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const a = useAktion();
  if (fehler) return <Meldung>{fehler}</Meldung>;

  const aendern = (k: LokalesKonto, daten: object, frage?: string) => {
    if (frage && !confirm(frage)) return;
    void a.ausfuehren(async () => {
      await api.put(`/api/plattform/konten/${encodeURIComponent(k.benutzername)}`, daten);
      neu();
    }, 'Gespeichert.');
  };

  const anlegen = () =>
    a.ausfuehren(async () => {
      await api.post('/api/plattform/konten', { benutzername, name, passwort });
      setNeuer(false);
      setBenutzername('');
      setName('');
      setPasswort('');
      neu();
    }, 'Konto angelegt. Beim ersten Login wird der zweite Faktor eingerichtet.');

  return (
    <div className="karte">
      <div className="knopfreihe" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Lokale Konten</h2>
        <button className="primaer" onClick={() => setNeuer(true)}>Neues Konto</button>
      </div>
      <p className="leise">Plattform-Admins und Notfallzugang: Passwort und zweiter Faktor (TOTP oder Passkey).</p>
      <Meldung>{a.fehler}</Meldung>
      <Meldung art="ok">{a.ok}</Meldung>
      <div className="tabelle-huelle">
        <table>
          <thead>
            <tr><th>Benutzername</th><th>Name</th><th>Zweiter Faktor</th><th>Letzte Anmeldung</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {daten?.map((k) => {
              const selbst = k.benutzername.toLowerCase() === ich.email.toLowerCase();
              return (
                <tr key={k.benutzername}>
                  <td className="mono">{k.benutzername}</td>
                  <td>{k.name}</td>
                  <td>
                    {k.totp && <span className="marker gruen">TOTP</span>}
                    {k.passkeys.length > 0 && <span className="marker gruen">{k.passkeys.length} Passkey</span>}
                    {!k.totp && !k.passkeys.length && <span className="marker">wird beim Login eingerichtet</span>}
                  </td>
                  <td>{datumZeit(k.letzteAnmeldung)}</td>
                  <td><span className={`marker ${k.aktiv ? 'gruen' : 'rot'}`}>{k.aktiv ? 'aktiv' : 'gesperrt'}</span></td>
                  <td>
                    {!selbst && (
                      <div className="knopfreihe" style={{ marginTop: 0 }}>
                        <button onClick={() => aendern(k, { aktiv: !k.aktiv })}>{k.aktiv ? 'Sperren' : 'Entsperren'}</button>
                        <button
                          onClick={() => {
                            const pw = prompt(`Neues Passwort für ${k.benutzername} (mind. 12 Zeichen):`);
                            if (pw) aendern(k, { passwort: pw });
                          }}
                        >
                          Passwort setzen
                        </button>
                        <button className="gefahr" onClick={() => aendern(k, { mfaZuruecksetzen: true }, `Zweiten Faktor von ${k.benutzername} zurücksetzen? Er wird beim nächsten Login neu eingerichtet.`)}>
                          MFA zurücksetzen
                        </button>
                      </div>
                    )}
                    {selbst && <span className="leise">eigenes Konto</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {neuer && (
        <Dialog titel="Neues lokales Konto" schliessen={() => setNeuer(false)}>
          <div className="raster">
            <Feld titel="Benutzername"><input value={benutzername} onChange={(e) => setBenutzername(e.target.value)} autoComplete="off" /></Feld>
            <Feld titel="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Feld>
            <Feld titel="Startpasswort (mind. 12 Zeichen)"><input type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoComplete="new-password" /></Feld>
          </div>
          <Meldung>{a.fehler}</Meldung>
          <div className="knopfreihe">
            <button className="primaer" onClick={anlegen} disabled={a.laeuft}>Anlegen</button>
            <button onClick={() => setNeuer(false)}>Abbrechen</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
