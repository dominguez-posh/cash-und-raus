// Einrichten von TOTP und Passkey; verwendet beim ersten Login und unter „Mein Konto“.
import qrcode from 'qrcode-generator';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { passkeyErstellen } from '../passkey.ts';
import { Feld, Meldung, useAktion } from '../ui.tsx';

type Fertig = (recoveryCodes: string[] | null) => void;

export function TotpEinrichten({ fertig }: { fertig: Fertig }) {
  const [daten, setDaten] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const a = useAktion();

  useEffect(() => {
    void a.ausfuehren(async () => setDaten(await api.post('/api/auth/mfa/totp/einrichten')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qr = (() => {
    if (!daten) return '';
    const q = qrcode(0, 'M');
    q.addData(daten.uri);
    q.make();
    return q.createDataURL(5, 2);
  })();

  const bestaetigen = (e: React.FormEvent) => {
    e.preventDefault();
    void a.ausfuehren(async () => {
      const r = await api.post<{ recoveryCodes: string[] | null }>('/api/auth/mfa/totp/bestaetigen', { code });
      fertig(r.recoveryCodes);
    });
  };

  return (
    <form className="stapel" onSubmit={bestaetigen}>
      <p>QR-Code mit der Authenticator-App scannen (z. B. Microsoft Authenticator) und den angezeigten Code eingeben.</p>
      {daten && (
        <>
          <div className="qr"><img src={qr} alt="QR-Code für die Authenticator-App" /></div>
          <p className="leise">
            Manuell: <span className="mono">{daten.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
          </p>
        </>
      )}
      <Feld titel="Code aus der App">
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </Feld>
      <Meldung>{a.fehler}</Meldung>
      <button className="primaer" disabled={a.laeuft || !daten}>Einrichten</button>
    </form>
  );
}

export function PasskeyEinrichten({ fertig }: { fertig: Fertig }) {
  const [name, setName] = useState('');
  const a = useAktion();
  const los = (e: React.FormEvent) => {
    e.preventDefault();
    void a.ausfuehren(async () => {
      const optionen = await api.post<Parameters<typeof passkeyErstellen>[0]>('/api/auth/mfa/passkey/registrieren/optionen');
      const credential = await passkeyErstellen(optionen);
      const r = await api.post<{ recoveryCodes: string[] | null }>('/api/auth/mfa/passkey/registrieren', { credential, name });
      fertig(r.recoveryCodes);
    });
  };
  return (
    <form className="stapel" onSubmit={los}>
      <p>Windows Hello, Touch ID, Smartphone oder Sicherheitsschlüssel (FIDO2).</p>
      <Feld titel="Bezeichnung (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="z. B. YubiKey Büro" />
      </Feld>
      <Meldung>{a.fehler}</Meldung>
      <button className="primaer" disabled={a.laeuft}>Passkey einrichten</button>
    </form>
  );
}

export function RecoveryCodes({ codes, weiter }: { codes: string[]; weiter: () => void }) {
  return (
    <div className="stapel">
      <Meldung art="hinweis">
        Wiederherstellungscodes – nur jetzt sichtbar. Sicher aufbewahren (z. B. im Passwortmanager). Jeder Code gilt einmal.
      </Meldung>
      <div className="codes mono">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <button className="primaer" onClick={weiter}>Gespeichert, weiter</button>
    </div>
  );
}
