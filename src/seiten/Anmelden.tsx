import { useState } from 'react';
import type { AuthInfo } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Feld, Meldung, speicherLesen, speicherSchreiben, useAktion } from '../ui.tsx';

const EMAIL_SCHLUESSEL = 'cr.email';

/** Erstes Öffnen: Admin-Konto anlegen, danach folgt die Einrichtung des zweiten Faktors. */
function Ersteinrichtung({ info }: { info: AuthInfo }) {
  const [benutzername, setBenutzername] = useState('');
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const a = useAktion();
  const anlegen = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwort !== wiederholung) {
      a.setFehler('Die Passwörter stimmen nicht überein.');
      return;
    }
    void a.ausfuehren(async () => {
      await api.post('/api/auth/einrichtung', { benutzername, name, passwort });
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
        <h2>Ersteinrichtung</h2>
        <p className="leise">
          Legen Sie das Admin-Konto an (Plattform-Administration und Notfallzugang). Danach richten Sie den zweiten Faktor ein.
        </p>
        <form className="stapel" onSubmit={anlegen}>
          <Feld titel="Benutzername">
            <input autoComplete="username" required value={benutzername} onChange={(e) => setBenutzername(e.target.value)} autoFocus />
          </Feld>
          <Feld titel="Name">
            <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Feld>
          <Feld titel="Passwort (mind. 12 Zeichen)">
            <input type="password" autoComplete="new-password" required minLength={12} value={passwort} onChange={(e) => setPasswort(e.target.value)} />
          </Feld>
          <Feld titel="Passwort wiederholen">
            <input type="password" autoComplete="new-password" required value={wiederholung} onChange={(e) => setWiederholung(e.target.value)} />
          </Feld>
          <Meldung>{a.fehler}</Meldung>
          <button className="primaer" disabled={a.laeuft}>Konto anlegen</button>
        </form>
      </div>
    </div>
  );
}

export function Anmelden({ info }: { info: AuthInfo }) {
  if (info.einrichtung) return <Ersteinrichtung info={info} />;
  return <Login info={info} />;
}

function Login({ info }: { info: AuthInfo }) {
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
