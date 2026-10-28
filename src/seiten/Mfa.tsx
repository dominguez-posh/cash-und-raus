import { useState } from 'react';
import type { AuthInfo, Ich } from '../../shared/types.ts';
import { api } from '../api.ts';
import { passkeyMoeglich, passkeyPruefen } from '../passkey.ts';
import { Feld, Meldung, useAktion } from '../ui.tsx';
import { PasskeyEinrichten, RecoveryCodes, TotpEinrichten } from './Faktoren.tsx';

export function Mfa({ ich, info, fertig }: { ich: Ich; info: AuthInfo; fertig: () => Promise<void> }) {
  const mfa = ich.mfa!;
  const [weg, setWeg] = useState<'auswahl' | 'totp' | 'passkey' | 'recovery'>(mfa.status === 'pruefen' ? (mfa.passkey ? 'passkey' : 'totp') : 'auswahl');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const a = useAktion();

  const abbrechen = async () => {
    await api.post('/api/auth/abmelden');
    location.replace('/');
  };

  const pruefen = (e: React.FormEvent) => {
    e.preventDefault();
    void a.ausfuehren(async () => {
      await api.post(weg === 'recovery' ? '/api/auth/mfa/recovery' : '/api/auth/mfa/totp', { code });
      await fertig();
    });
  };

  const mitPasskey = () =>
    a.ausfuehren(async () => {
      const optionen = await api.post<Parameters<typeof passkeyPruefen>[0]>('/api/auth/mfa/passkey/optionen');
      const credential = await passkeyPruefen(optionen);
      await api.post('/api/auth/mfa/passkey', { credential });
      await fertig();
    });

  let inhalt;
  if (codes) {
    inhalt = <RecoveryCodes codes={codes} weiter={fertig} />;
  } else if (mfa.status === 'einrichten') {
    inhalt = (
      <>
        <Meldung art="hinweis">Für dieses Konto ist noch kein zweiter Faktor eingerichtet. Bitte jetzt einrichten.</Meldung>
        {weg === 'auswahl' && (
          <div className="stapel">
            <button className="primaer" onClick={() => setWeg('totp')}>Authenticator-App (TOTP)</button>
            <button onClick={() => setWeg('passkey')} disabled={!passkeyMoeglich()}>Passkey / Sicherheitsschlüssel</button>
          </div>
        )}
        {weg === 'totp' && <TotpEinrichten fertig={(c) => (c ? setCodes(c) : fertig())} />}
        {weg === 'passkey' && <PasskeyEinrichten fertig={(c) => (c ? setCodes(c) : fertig())} />}
        {weg !== 'auswahl' && (
          <button className="link" onClick={() => setWeg('auswahl')}>Andere Methode</button>
        )}
      </>
    );
  } else {
    inhalt = (
      <>
        {weg === 'passkey' && (
          <div className="stapel">
            <button className="primaer" onClick={mitPasskey} disabled={a.laeuft}>Mit Passkey bestätigen</button>
          </div>
        )}
        {(weg === 'totp' || weg === 'recovery') && (
          <form className="stapel" onSubmit={pruefen}>
            <Feld titel={weg === 'totp' ? 'Code aus der Authenticator-App' : 'Wiederherstellungscode'}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={weg === 'totp' ? 'numeric' : 'text'}
                autoComplete="one-time-code"
                maxLength={20}
                required
                autoFocus
              />
            </Feld>
            <button className="primaer" disabled={a.laeuft}>Bestätigen</button>
          </form>
        )}
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          {mfa.passkey && weg !== 'passkey' && <button className="link" onClick={() => setWeg('passkey')}>Passkey verwenden</button>}
          {mfa.totp && weg !== 'totp' && <button className="link" onClick={() => setWeg('totp')}>Authenticator-Code</button>}
          {weg !== 'recovery' && <button className="link" onClick={() => setWeg('recovery')}>Wiederherstellungscode</button>}
        </div>
      </>
    );
  }

  return (
    <div className="anmelde-huelle">
      <div className="karte anmelde-karte">
        <div className="titel">
          <img src="/favicon.svg" alt="" />
          <h1>{info.produktName}</h1>
        </div>
        <p className="leise">Angemeldet als {ich.email} – zweiter Faktor</p>
        {inhalt}
        {!codes && (
          <div className="knopfreihe">
            <button onClick={abbrechen}>Abbrechen</button>
          </div>
        )}
      </div>
    </div>
  );
}
