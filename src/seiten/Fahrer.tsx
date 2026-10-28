// Fahrer: Meine Tour heute – Stopps mit Navigation, Geliefert, Zahlung bei Lieferung.
import { useState } from 'react';
import { FAHRER_ROLLEN, navigationsLink, type Tour } from '../../shared/dispo.ts';
import type { Ich } from '../../shared/types.ts';
import { datumDeutsch, euro, type Vorgang } from '../../shared/verkauf.ts';
import { api } from '../api.ts';
import { Meldung, useAktion, useLaden } from '../ui.tsx';
import { AuftragZeile, GeliefertKnopf } from './Dispo.tsx';
import { ZahlungDialog } from './Vorgang.tsx';

export const darfFahren = (ich: Ich) => FAHRER_ROLLEN.some((r) => ich.rollen.includes(r));

const heute = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

export function Fahrer() {
  const [datum, setDatum] = useState(heute());
  const touren = useLaden(() => api.get<Tour[]>(`/api/dispo/meine?datum=${datum}`), [datum]);
  const [zahlung, setZahlung] = useState<Vorgang | null>(null);
  const a = useAktion();
  return (
    <div className="touch">
      <div className="titelzeile">
        <h1>Meine Tour</h1>
        <input type="date" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <Meldung>{touren.fehler ?? a.fehler}</Meldung>
      {touren.daten?.length === 0 && <p className="leise">Keine Tour für den {datumDeutsch(datum)}.</p>}
      {touren.daten?.map((t) => (
        <div className="karte" key={t.id}>
          <div className="titelzeile">
            <h2 style={{ margin: 0 }}>{t.fahrzeug?.name ?? 'Tour'} {t.fahrer && `· ${t.fahrer.name}`}</h2>
            {t.streckeKm !== null && <span className="leise">{t.streckeKm} km · {t.dauerMin} min</span>}
            <a className="knopf" href={`/api/dispo/touren/${t.id}/pdf`} target="_blank" rel="noopener">Tourenzettel</a>
          </div>
          {t.bemerkung && <p>{t.bemerkung}</p>}
          {t.stopps.map((s, j) => (
            <div key={s.vorgangId} className={`stopp${s.status === 'geliefert' ? ' erledigt' : ''}`}>
              <span className="stopp-nr">{j + 1}</span>
              <AuftragZeile s={s} />
              <div className="stopp-knoepfe">
                <a className="knopf" href={navigationsLink(s)} target="_blank" rel="noopener">Navigation</a>
                {s.kunde.telefon && <a className="knopf" href={`tel:${s.kunde.telefon.replace(/\s/g, '')}`}>Anrufen</a>}
                {s.offenCent > 0 && (
                  <button onClick={() => a.ausfuehren(async () => setZahlung(await api.get<Vorgang>(`/api/vorgaenge/${s.vorgangId}`)))} disabled={a.laeuft}>
                    Kassieren {euro(s.offenCent)}
                  </button>
                )}
                {s.status === 'geliefert' ? <span className="marker gruen">geliefert</span> : <GeliefertKnopf s={s} text="Geliefert" fertig={touren.neu} />}
              </div>
            </div>
          ))}
        </div>
      ))}
      {zahlung && <ZahlungDialog v={zahlung} schliessen={() => setZahlung(null)} fertig={async () => touren.neu()} />}
    </div>
  );
}
