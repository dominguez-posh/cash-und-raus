import { useState } from 'react';
import type { AuthInfo } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Feld, Meldung, speicherLesen, speicherSchreiben, useAktion } from '../ui.tsx';

const EMAIL_SCHLUESSEL = 'cr.email';

export function Anmelden({ info }: { info: AuthInfo }) {
  const [email, setEmail] = useState(() => speicherLesen(EMAIL_SCHLUESSEL));
  const [lokal, setLokal] = useState(false);
  const [benutzername, setBenutzername] = useState('');
  const [passwort, setPasswort] = useState('');
  const firma = useAktion();
  const admin = useAktion();
  const urlFehler = new URLSearchParams(location.search).get('fehler');

  const firmenLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void firma.ausfuehren(async () => {
      const r = await api.post<{ url: string }>('/api/auth/saml/finden', { email });
      speicherSchreiben(EMAIL_SCHLUESSEL, email.trim());
      location.href = r.url;
    });
  };

  const lokalerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void admin.ausfuehren(async () => {
      await api.post('/api/auth/lokal', { benutzername, passwort });
      location.replace('/');
    });
  };

  return (
    <div className="anmelde-huelle">
      <div className="karte anmelde-karte">
        <div className="titel">
          <img src="/favicon.svg" alt="" />
          <h1>{info.produktName}</h1>
        </div>
        <Meldung>{urlFehler}</Meldung>

        {!lokal && (
          <form className="stapel" onSubmit={firmenLogin}>
            <Feld titel="Geschäftliche E-Mail-Adresse">
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Feld>
            <Meldung>{firma.fehler}</Meldung>
            <button className="primaer" disabled={firma.laeuft}>
              Mit Firmenkonto anmelden
            </button>
          </form>
        )}

        {lokal && (
          <form className="stapel" onSubmit={lokalerLogin}>
            <Feld titel="Benutzername">
              <input autoComplete="username" required value={benutzername} onChange={(e) => setBenutzername(e.target.value)} autoFocus />
            </Feld>
            <Feld titel="Passwort">
              <input type="password" autoComplete="current-password" required value={passwort} onChange={(e) => setPasswort(e.target.value)} />
            </Feld>
            <Meldung>{admin.fehler}</Meldung>
            <button className="primaer" disabled={admin.laeuft}>
              Weiter
            </button>
            <p className="leise">Danach folgt der zweite Faktor (Authenticator-App oder Passkey).</p>
          </form>
        )}

        <div className="trenner">oder</div>
        <button className="link" onClick={() => setLokal(!lokal)}>
          {lokal ? 'Mit Firmenkonto anmelden' : 'Admin- / Notfallzugang'}
        </button>
      </div>
    </div>
  );
}
