import { useEffect, useState } from 'react';
import type { AuthInfo, Ich } from '../shared/types.ts';
import { api, ApiFehler, fehlerText } from './api.ts';
import { Admin } from './seiten/Admin.tsx';
import { Anmelden } from './seiten/Anmelden.tsx';
import { FilialeWaehlen } from './seiten/FilialeWaehlen.tsx';
import { darfDispo, Dispo } from './seiten/Dispo.tsx';
import { darfFahren, Fahrer } from './seiten/Fahrer.tsx';
import { darfKasse, Kasse } from './seiten/Kasse.tsx';
import { Konto } from './seiten/Konto.tsx';
import { darfLager, Lager } from './seiten/Lager.tsx';
import { Mfa } from './seiten/Mfa.tsx';
import { Plattform } from './seiten/Plattform.tsx';
import { Start } from './seiten/Start.tsx';
import { darfVerkaufen, VerkaufSeite } from './seiten/Verkauf.tsx';
import { Suche } from './seiten/Vorgang.tsx';
import { Meldung, useRoute } from './ui.tsx';

export function App() {
  const [ich, setIch] = useState<Ich | null | undefined>(undefined);
  const [info, setInfo] = useState<AuthInfo>({ produktName: 'Cash & Raus', einrichtung: false });
  const [fehler, setFehler] = useState<string | null>(null);
  const [filialWahl, setFilialWahl] = useState(false);
  const { route, besuch } = useRoute();

  const laden = async () => {
    try {
      setIch(await api.get<Ich>('/api/ich'));
      setFehler(null);
    } catch (e) {
      if (e instanceof ApiFehler && e.status === 401) setIch(null);
      else setFehler(fehlerText(e));
    }
  };

  useEffect(() => {
    void laden();
    api.get<AuthInfo>('/api/auth/info').then(setInfo, () => {});
  }, []);

  useEffect(() => {
    document.title = ich?.mandant ? `${ich.mandant.name} – ${info.produktName}` : info.produktName;
  }, [ich, info]);

  if (fehler) return <main><Meldung>{fehler}</Meldung></main>;
  if (ich === undefined) return null;
  if (ich === null) return <Anmelden info={info} />;
  if (ich.mfa) return <Mfa ich={ich} info={info} fertig={laden} />;

  const abmelden = async () => {
    await api.post('/api/auth/abmelden');
    location.hash = '';
    setIch(null);
  };

  // Mandant gewählt, aber noch keine Filiale (mehrere erlaubt, IP nicht erkannt)
  if ((ich.mandant && !ich.filiale && ich.filialen.length > 0) || filialWahl) {
    return (
      <FilialeWaehlen
        ich={ich}
        abbrechen={ich.filiale ? () => setFilialWahl(false) : undefined}
        fertig={async () => {
          setFilialWahl(false);
          await laden();
        }}
        abmelden={abmelden}
      />
    );
  }

  const istAdmin = ich.rollen.includes('admin');
  const nav: [string, string][] = [];
  if (ich.mandant) nav.push(['/', 'Start']);
  if (ich.mandant && darfVerkaufen(ich)) nav.push(['/verkauf/neu', 'Neuer Verkauf']);
  if (ich.mandant && ich.rollen.length) nav.push(['/suche', 'Suche']);
  if (ich.mandant && darfKasse(ich)) nav.push(['/kasse', 'Kasse']);
  if (ich.mandant && darfLager(ich)) nav.push(['/lager', 'Lager']);
  if (ich.mandant && darfDispo(ich)) nav.push(['/dispo', 'Dispo']);
  if (ich.mandant && darfFahren(ich)) nav.push(['/tour', 'Meine Tour']);
  if (ich.mandant && istAdmin) nav.push(['/admin', 'Verwaltung']);
  if (ich.plattformAdmin) nav.push(['/plattform', 'Plattform']);
  if (ich.art === 'lokal') nav.push(['/konto', 'Mein Konto']);

  const vorgangId = /^\/verkauf\/(neu|\d+)$/.exec(route)?.[1];
  let seite;
  if (route === '/konto' && ich.art === 'lokal') seite = <Konto />;
  else if (vorgangId && ich.mandant) seite = <VerkaufSeite key={`${route}:${besuch}`} ich={ich} id={vorgangId === 'neu' ? null : Number(vorgangId)} />;
  else if (route === '/suche' && ich.mandant) seite = <Suche />;
  else if (route === '/kasse' && ich.mandant && darfKasse(ich)) seite = <Kasse ich={ich} />;
  else if (route === '/lager' && ich.mandant && darfLager(ich)) seite = <Lager />;
  else if (route === '/dispo' && ich.mandant && darfDispo(ich)) seite = <Dispo />;
  else if (route === '/tour' && ich.mandant && darfFahren(ich)) seite = <Fahrer />;
  else if (route === '/plattform' && ich.plattformAdmin) seite = <Plattform ich={ich} neuLaden={laden} />;
  else if (route === '/admin' && ich.mandant && istAdmin) seite = <Admin neuLaden={laden} mandantId={ich.mandant.id} />;
  else if (ich.mandant) seite = <Start ich={ich} />;
  else if (ich.plattformAdmin) seite = <Plattform ich={ich} neuLaden={laden} />;
  else seite = <Meldung>Kein Mandant zugeordnet.</Meldung>;

  const aktiv = ich.mandant ? route : route === '/konto' ? '/konto' : '/plattform';

  return (
    <>
      <header className="kopf">
        <a className="marke" href="#/">
          {ich.mandant?.hatLogo ? <img src="/api/mandant/logo" alt="" /> : <img src="/favicon.svg" alt="" />}
          <span>{ich.mandant?.name ?? info.produktName}</span>
        </a>
        <nav>
          {nav.map(([pfad, titel]) => (
            <a key={pfad} href={`#${pfad}`} className={aktiv === pfad ? 'aktiv' : ''}>
              {titel}
            </a>
          ))}
        </nav>
        <div className="rechts">
          {ich.filiale && (
            <button
              className="filial-chip"
              title={ich.filiale.perIp ? 'Automatisch über die IP-Adresse erkannt' : 'Filiale wechseln'}
              onClick={() => ich.filialen.length > 1 && setFilialWahl(true)}
            >
              {ich.filiale.kuerzel} · {ich.filiale.name}
              {ich.filiale.perIp ? ' (IP)' : ''}
            </button>
          )}
          {ich.plattformAdmin && ich.mandant && (
            <button
              className="link"
              onClick={async () => {
                await api.post('/api/plattform/verlassen');
                location.hash = '#/plattform';
                await laden();
              }}
            >
              Betreuung beenden
            </button>
          )}
          <span className="person">{ich.name}</span>
          <button onClick={abmelden}>Abmelden</button>
        </div>
      </header>
      <main>{seite}</main>
    </>
  );
}
