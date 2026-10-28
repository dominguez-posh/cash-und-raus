import type { Ich } from '../../shared/types.ts';
import { Meldung } from '../ui.tsx';
import { darfKasse } from './Kasse.tsx';
import { darfLager } from './Lager.tsx';
import { darfVerkaufen } from './Verkauf.tsx';

// Funktionen des Altsystems, die noch kommen (docs/PLAN.md).
const SPAETER: [string, string, string][] = [
  ['Dispo & Touren', 'Lieferkalender, Touren auf der Karte', 'Stufe 6'],
];

export function Start({ ich }: { ich: Ich }) {
  const verkauf = darfVerkaufen(ich);
  return (
    <>
      <h1>Guten Tag, {ich.name.split(' ')[0]}</h1>
      {!ich.filiale && ich.filialen.length === 0 && (
        <Meldung art="hinweis">
          Noch keine Filiale verfügbar.{ich.rollen.includes('admin') ? ' Bitte unter „Verwaltung“ Filialen anlegen.' : ' Bitte die Administration ansprechen.'}
        </Meldung>
      )}
      <div className="kacheln haupt">
        {verkauf && ich.filiale && (
          <a className="kachel knopf-kachel primaer" href="#/verkauf/neu">
            <h3>Neuer Verkauf</h3>
            <span>Rechnung mit Anzahlung, Lieferung, Montage</span>
          </a>
        )}
        <a className="kachel knopf-kachel" href="#/suche">
          <h3>Rechnung suchen</h3>
          <span className="leise">Nach Nummer, Name oder Telefon; Restzahlung, Storno, Lieferschein</span>
        </a>
        {darfKasse(ich) && ich.filiale && (
          <a className="kachel knopf-kachel" href="#/kasse">
            <h3>Kasse</h3>
            <span className="leise">Belege, Tagesabschluss mit Zählprotokoll und Z-Bon</span>
          </a>
        )}
        {darfLager(ich) && (
          <a className="kachel knopf-kachel" href="#/lager">
            <h3>Lager</h3>
            <span className="leise">Bestand, Wareneingang, Umlagerung, Inventur</span>
          </a>
        )}
      </div>
      <h2 style={{ marginTop: 28 }}>Demnächst</h2>
      <div className="kacheln">
        {SPAETER.map(([titel, text, stufe]) => (
          <div className="kachel" key={titel}>
            <h3>{titel}</h3>
            <p className="leise">{text}</p>
            <span className="stufe">kommt in {stufe}</span>
          </div>
        ))}
      </div>
    </>
  );
}
