import type { Ich } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Meldung, useAktion } from '../ui.tsx';

export function FilialeWaehlen({
  ich,
  fertig,
  abbrechen,
  abmelden,
}: {
  ich: Ich;
  fertig: () => Promise<void>;
  abbrechen?: () => void;
  abmelden: () => void;
}) {
  const a = useAktion();
  const waehlen = (id: number) =>
    a.ausfuehren(async () => {
      await api.post('/api/ich/filiale', { filialeId: id });
      await fertig();
    });

  return (
    <div className="anmelde-huelle">
      <div className="karte anmelde-karte">
        <h1>Filiale wählen</h1>
        <p className="leise">
          {ich.name} · {ich.mandant?.name}
        </p>
        <div className="stapel">
          {ich.filialen.map((f) => (
            <button key={f.id} onClick={() => waehlen(f.id)} disabled={a.laeuft} className={ich.filiale?.id === f.id ? 'primaer' : ''}>
              <strong>{f.kuerzel}</strong> {f.name}
            </button>
          ))}
        </div>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          {abbrechen && <button onClick={abbrechen}>Zurück</button>}
          <button className="link" onClick={abmelden}>Abmelden</button>
        </div>
      </div>
    </div>
  );
}
