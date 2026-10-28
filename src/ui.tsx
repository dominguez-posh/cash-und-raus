// Kleine gemeinsame Bausteine der Oberfläche.
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { fehlerText } from './api.ts';

/** Lädt Daten; neu laden über die zurückgegebene Funktion. */
export function useLaden<T>(laden: () => Promise<T>, abh: unknown[] = []) {
  const [daten, setDaten] = useState<T | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const neu = useCallback(() => {
    setFehler(null);
    laden().then(setDaten, (e) => setFehler(fehlerText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, abh);
  useEffect(neu, [neu]);
  return { daten, fehler, neu };
}

/**
 * Hash-Routing: #/admin, #/plattform …
 * `besuch` zählt jeden Hash-Wechsel, auch auf einen Pfad, der per replaceState schon angezeigt wurde
 * (z. B. „Neuer Verkauf“, während ein neuer Entwurf offen ist).
 */
export function useRoute(): { route: string; besuch: number } {
  const [stand, setStand] = useState(() => ({ route: location.hash.slice(1) || '/', besuch: 0 }));
  useEffect(() => {
    const f = () => setStand((s) => ({ route: location.hash.slice(1) || '/', besuch: s.besuch + 1 }));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return stand;
}

export function Meldung({ art = 'fehler', children }: { art?: 'fehler' | 'ok' | 'hinweis'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`meldung ${art}`} role={art === 'fehler' ? 'alert' : 'status'}>{children}</div>;
}

export function Feld({ titel, children, breit }: { titel: string; children: ReactNode; breit?: boolean }) {
  return (
    <label className={`feld${breit ? ' breit' : ''}`}>
      {titel}
      {children}
    </label>
  );
}

export function Dialog({ titel, children, schliessen }: { titel: string; children: ReactNode; schliessen: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && schliessen();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [schliessen]);
  return (
    <div className="dialog-hg" onMouseDown={(e) => e.target === e.currentTarget && schliessen()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={titel}>
        <h2>{titel}</h2>
        {children}
      </div>
    </div>
  );
}

/** Führt eine Aktion aus und zeigt Fehler/Erfolg. */
export function useAktion() {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const ausfuehren = async (f: () => Promise<unknown>, erfolg?: string) => {
    setLaeuft(true);
    setFehler(null);
    setOk(null);
    try {
      await f();
      if (erfolg) setOk(erfolg);
      return true;
    } catch (e) {
      setFehler(fehlerText(e));
      return false;
    } finally {
      setLaeuft(false);
    }
  };
  return { laeuft, fehler, ok, ausfuehren, setFehler };
}

export const datumZeit = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';

export function speicherLesen(schluessel: string): string {
  try {
    return localStorage.getItem(schluessel) ?? '';
  } catch {
    return '';
  }
}

export function speicherSchreiben(schluessel: string, wert: string): void {
  try {
    localStorage.setItem(schluessel, wert);
  } catch {
    /* privates Fenster: ohne Merken weiter */
  }
}
