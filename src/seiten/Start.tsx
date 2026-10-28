// Startseite: wenige große Kacheln je Rolle. Die Navigation läuft über diese Kacheln.
import type { Ich } from '../../shared/types.ts';
import { Meldung } from '../ui.tsx';
import { darfDispo } from './Dispo.tsx';
import { darfFahren } from './Fahrer.tsx';
import { darfKasse } from './Kasse.tsx';
import { darfLager } from './Lager.tsx';
import { darfVerkaufen } from './Verkauf.tsx';

export function Start({ ich }: { ich: Ich }) {
  const kacheln: { pfad: string; titel: string; text: string; haupt?: boolean }[] = [];
  if (darfVerkaufen(ich) && ich.filiale) kacheln.push({ pfad: '/verkauf/neu', titel: 'Neuer Verkauf', text: 'Rechnung schreiben', haupt: true });
  if (ich.rollen.length) kacheln.push({ pfad: '/suche', titel: 'Rechnung suchen', text: 'Nachsehen, drucken, Restzahlung' });
  if (darfKasse(ich) && ich.filiale) kacheln.push({ pfad: '/kasse', titel: 'Kasse', text: 'Belege und Tagesabschluss' });
  if (darfLager(ich)) kacheln.push({ pfad: '/lager', titel: 'Lager', text: 'Bestand und Wareneingang' });
  if (darfDispo(ich)) kacheln.push({ pfad: '/dispo', titel: 'Dispo', text: 'Lieferungen und Touren' });
  if (darfFahren(ich) && !darfDispo(ich)) kacheln.push({ pfad: '/tour', titel: 'Meine Tour', text: 'Stopps von heute' });

  return (
    <>
      <h1>Guten Tag, {ich.name.split(' ')[0]}</h1>
      {!ich.filiale && ich.filialen.length === 0 && (
        <Meldung art="hinweis">
          Noch keine Filiale verfügbar.{ich.rollen.includes('admin') ? ' Bitte unter „Verwaltung“ Filialen anlegen.' : ' Bitte die Administration ansprechen.'}
        </Meldung>
      )}
      <div className="kacheln haupt">
        {kacheln.map((k) => (
          <a key={k.pfad} className={`kachel knopf-kachel${k.haupt ? ' primaer' : ''}`} href={`#${k.pfad}`}>
            <h3>{k.titel}</h3>
            <span className={k.haupt ? '' : 'leise'}>{k.text}</span>
          </a>
        ))}
      </div>
      {ich.rollen.includes('admin') && (
        <p className="leise" style={{ marginTop: 24 }}>
          Verwaltung (Firma, Filialen, Benutzer, Artikel, Import) finden Sie oben rechts im Menü unter Ihrem Namen.
        </p>
      )}
    </>
  );
}
