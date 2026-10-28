// Lager: Bestand je Lagerort, Wareneingang, Umlagerung, Inventur, Buchungen.
import { useState } from 'react';
import { type Artikel, type Bestand, BUCHUNGSART_NAMEN, LAGER_ROLLEN, type Lagerbuchung, type Lagerort } from '../../shared/lager.ts';
import type { Ich } from '../../shared/types.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { Wahl } from './Verkauf.tsx';

export const darfLager = (ich: Ich) => LAGER_ROLLEN.some((r) => ich.rollen.includes(r));

type Art = 'wareneingang' | 'umlagerung' | 'inventur' | 'korrektur';

export function Lager() {
  const [q, setQ] = useState('');
  const [begriff, setBegriff] = useState('');
  const bestand = useLaden(() => api.get<Bestand[]>(`/api/lager/bestand?q=${encodeURIComponent(begriff)}`), [begriff]);
  const buchungen = useLaden(() => api.get<Lagerbuchung[]>('/api/lager/buchungen'));
  const [dialog, setDialog] = useState<{ art: Art; vorgabe?: Bestand } | null>(null);
  const neu = () => {
    bestand.neu();
    buchungen.neu();
  };
  return (
    <div className="touch">
      <h1>Lager</h1>
      <div className="kacheln aktionen">
        <button className="kachel knopf-kachel primaer" onClick={() => setDialog({ art: 'wareneingang' })}>
          <h3>Wareneingang</h3>
          <span>Ware einbuchen</span>
        </button>
        <button className="kachel knopf-kachel" onClick={() => setDialog({ art: 'umlagerung' })}>
          <h3>Umlagerung</h3>
          <span className="leise">zwischen Lagerorten</span>
        </button>
        <button className="kachel knopf-kachel" onClick={() => setDialog({ art: 'inventur' })}>
          <h3>Inventur</h3>
          <span className="leise">gezählten Bestand eintragen</span>
        </button>
      </div>

      <div className="karte">
        <form className="suchzeile" onSubmit={(e) => { e.preventDefault(); setBegriff(q); }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artikel suchen" />
          <button className="primaer gross">Suchen</button>
        </form>
        <Meldung>{bestand.fehler}</Meldung>
        <table>
          <thead><tr><th>Nr.</th><th>Artikel</th><th>Lagerort</th><th className="zahl">Bestand</th><th /></tr></thead>
          <tbody>
            {bestand.daten?.map((b) => (
              <tr key={`${b.artikelId}-${b.lagerortId}`}>
                <td className="mono">{b.nummer}</td>
                <td>{b.bezeichnung}</td>
                <td>{b.lagerort}</td>
                <td className={`zahl${b.menge < 0 ? ' fehlt' : ''}`}>{b.menge}</td>
                <td><button className="link" onClick={() => setDialog({ art: 'umlagerung', vorgabe: b })}>umlagern</button></td>
              </tr>
            ))}
            {bestand.daten?.length === 0 && <tr><td colSpan={5} className="leise">Kein Bestand gebucht.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="karte">
        <h2>Letzte Buchungen</h2>
        <table>
          <tbody>
            {buchungen.daten?.map((b) => (
              <tr key={b.id}>
                <td>{datumZeit(b.zeit)}</td>
                <td>{BUCHUNGSART_NAMEN[b.art]}</td>
                <td>{b.bezeichnung}</td>
                <td>{b.lagerort}{b.bezug && <span className="leise"> {b.bezug}</span>}</td>
                <td className={`zahl${b.menge < 0 ? ' fehlt' : ''}`}>{b.menge > 0 ? `+${b.menge}` : b.menge}</td>
                <td className="leise">{b.text || b.person}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog && <BuchenDialog art={dialog.art} vorgabe={dialog.vorgabe} schliessen={() => setDialog(null)} fertig={neu} />}
    </div>
  );
}

/** Artikel suchen und wählen (auch im Verkauf verwendet) */
export function ArtikelSuche({ waehlen, autoFocus }: { waehlen: (a: Artikel) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const liste = useLaden(() => (q.trim().length >= 1 ? api.get<Artikel[]>(`/api/artikel?q=${encodeURIComponent(q)}`) : Promise.resolve([] as Artikel[])), [q]);
  return (
    <div className="feld">
      Artikel
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer oder Bezeichnung" autoFocus={autoFocus} />
      {liste.daten && liste.daten.length > 0 && (
        <div className="vorschlaege">
          {liste.daten.map((a) => (
            <button key={a.id} type="button" onClick={() => { waehlen(a); setQ(''); }}>
              <strong>{a.bezeichnung}</strong> <span className="leise">{a.nummer} · Bestand {a.bestand}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TITEL: Record<Art, string> = { wareneingang: 'Wareneingang', umlagerung: 'Umlagerung', inventur: 'Inventur', korrektur: 'Korrektur' };

function BuchenDialog({ art, vorgabe, schliessen, fertig }: { art: Art; vorgabe?: Bestand; schliessen: () => void; fertig: () => void }) {
  const lagerorte = useLaden(() => api.get<Lagerort[]>('/api/lagerorte'));
  const [artikel, setArtikel] = useState<{ id: number; bezeichnung: string; lagerortId: number | null } | null>(vorgabe ? { id: vorgabe.artikelId, bezeichnung: vorgabe.bezeichnung, lagerortId: vorgabe.lagerortId } : null);
  const [lagerortId, setLagerortId] = useState<number | null>(vorgabe?.lagerortId ?? null);
  const [ziel, setZiel] = useState<number | null>(null);
  const [menge, setMenge] = useState('');
  const [text, setText] = useState('');
  const a = useAktion();
  const aktive = (lagerorte.daten ?? []).filter((l) => l.aktiv);
  const buchen = () =>
    a.ausfuehren(async () => {
      await api.post('/api/lager/buchen', { art, artikelId: artikel!.id, lagerortId, menge: Number(menge.replace(',', '.')), zielLagerortId: ziel, text });
      fertig();
      schliessen();
    });
  return (
    <Dialog titel={TITEL[art]} schliessen={schliessen}>
      <div className="touch stapel">
        {artikel ? (
          <p>
            <strong>{artikel.bezeichnung}</strong> <button className="link" onClick={() => setArtikel(null)}>ändern</button>
          </p>
        ) : (
          <ArtikelSuche autoFocus waehlen={(x) => { setArtikel({ id: x.id, bezeichnung: x.bezeichnung, lagerortId: x.lagerortId }); if (lagerortId === null) setLagerortId(x.lagerortId); }} />
        )}
        <div className="feld">
          {art === 'umlagerung' ? 'Von Lagerort' : 'Lagerort'}
          <Wahl optionen={aktive.map((l) => [l.id, l.name])} wert={lagerortId} aendern={setLagerortId} />
        </div>
        {art === 'umlagerung' && (
          <div className="feld">
            Nach Lagerort
            <Wahl optionen={aktive.filter((l) => l.id !== lagerortId).map((l) => [l.id, l.name])} wert={ziel} aendern={setZiel} />
          </div>
        )}
        <Feld titel={art === 'inventur' ? 'Gezählter Bestand' : art === 'korrektur' ? 'Differenz (±)' : 'Menge'}>
          <input inputMode="decimal" value={menge} onChange={(e) => setMenge(e.target.value)} style={{ maxWidth: 160 }} />
        </Feld>
        <Feld titel="Text (Lieferant, Lieferschein-Nr., Grund)">
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </Feld>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross" onClick={buchen} disabled={a.laeuft || !artikel || lagerortId === null || menge === '' || (art === 'umlagerung' && ziel === null)}>Buchen</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}
