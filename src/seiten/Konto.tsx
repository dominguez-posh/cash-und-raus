import { useState } from 'react';
import type { LokalesKonto } from '../../shared/types.ts';
import { api } from '../api.ts';
import { passkeyMoeglich } from '../passkey.ts';
import { datumZeit, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { PasskeyEinrichten, RecoveryCodes, TotpEinrichten } from './Faktoren.tsx';

export function Konto() {
  const { daten: konto, fehler, neu } = useLaden(() => api.get<LokalesKonto>('/api/konto'));
  const [alt, setAlt] = useState('');
  const [neues, setNeues] = useState('');
  const [hinzu, setHinzu] = useState<'totp' | 'passkey' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const pw = useAktion();
  const fa = useAktion();
  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!konto) return null;

  const faktorFertig = (c: string[] | null) => {
    setHinzu(null);
    if (c) setCodes(c);
    neu();
  };

  return (
    <>
      <h1>Mein Konto</h1>
      <div className="karte">
        <h2>Passwort ändern</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pw.ausfuehren(async () => {
              await api.post('/api/konto/passwort', { alt, neu: neues });
              setAlt('');
              setNeues('');
            }, 'Passwort geändert. Andere Sitzungen wurden beendet.');
          }}
        >
          <input type="text" autoComplete="username" value={konto.benutzername} readOnly hidden />
          <div className="raster">
            <Feld titel="Bisheriges Passwort"><input type="password" autoComplete="current-password" value={alt} onChange={(e) => setAlt(e.target.value)} required /></Feld>
            <Feld titel="Neues Passwort (mind. 12 Zeichen)"><input type="password" autoComplete="new-password" value={neues} onChange={(e) => setNeues(e.target.value)} required /></Feld>
          </div>
          <Meldung>{pw.fehler}</Meldung>
          <Meldung art="ok">{pw.ok}</Meldung>
          <div className="knopfreihe"><button className="primaer" disabled={pw.laeuft}>Ändern</button></div>
        </form>
      </div>

      <div className="karte">
        <h2>Zweiter Faktor</h2>
        {codes ? (
          <RecoveryCodes codes={codes} weiter={() => setCodes(null)} />
        ) : (
          <>
            <p>
              Authenticator-App: {konto.totp ? <span className="marker gruen">eingerichtet</span> : <span className="marker">nicht eingerichtet</span>}
              {' · '}Wiederherstellungscodes übrig: <strong>{konto.recoveryUebrig}</strong>
            </p>
            <div className="tabelle-huelle">
              <table>
                <thead><tr><th>Passkey</th><th>Eingerichtet</th><th>Zuletzt verwendet</th><th></th></tr></thead>
                <tbody>
                  {konto.passkeys.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{datumZeit(p.erstelltAm)}</td>
                      <td>{datumZeit(p.zuletztAm)}</td>
                      <td>
                        <button
                          className="gefahr"
                          onClick={() =>
                            confirm(`Passkey „${p.name}“ entfernen?`) &&
                            fa.ausfuehren(async () => {
                              await api.del(`/api/konto/passkeys/${encodeURIComponent(p.id)}`);
                              neu();
                            })
                          }
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!konto.passkeys.length && <tr><td colSpan={4} className="leise">Keine Passkeys.</td></tr>}
                </tbody>
              </table>
            </div>
            <Meldung>{fa.fehler}</Meldung>
            {hinzu === 'totp' && <TotpEinrichten fertig={faktorFertig} />}
            {hinzu === 'passkey' && <PasskeyEinrichten fertig={faktorFertig} />}
            <div className="knopfreihe">
              {!konto.totp && <button onClick={() => setHinzu('totp')}>Authenticator-App einrichten</button>}
              <button onClick={() => setHinzu('passkey')} disabled={!passkeyMoeglich()}>Passkey hinzufügen</button>
              <button
                onClick={() =>
                  confirm('Neue Wiederherstellungscodes erzeugen? Die bisherigen werden ungültig.') &&
                  fa.ausfuehren(async () => {
                    const r = await api.post<{ recoveryCodes: string[] }>('/api/konto/recovery');
                    setCodes(r.recoveryCodes);
                    neu();
                  })
                }
              >
                Neue Wiederherstellungscodes
              </button>
              {hinzu && <button onClick={() => setHinzu(null)}>Abbrechen</button>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
