// Dispo: Lieferaufträge des Tages, Touren je Fahrzeug/Fahrer, Karte mit Stopps und Routen, Tourenzettel.
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { DISPO_ROLLEN, type Fahrzeug, type Lieferauftrag, type Route, type Tour, TOUR_STATUS, TOUR_STATUS_NAMEN } from '../../shared/dispo.ts';
import type { Ich } from '../../shared/types.ts';
import { datumDeutsch, etageText, euro } from '../../shared/verkauf.ts';
import { api } from '../api.ts';
import { Dialog, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';

export const darfDispo = (ich: Ich) => DISPO_ROLLEN.some((r) => ich.rollen.includes(r));

const heute = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
const FARBEN = ['#0f766e', '#b45309', '#1d4ed8', '#be185d', '#4d7c0f', '#7c3aed', '#0e7490', '#9f1239'];

export function Dispo() {
  const [datum, setDatum] = useState(heute());
  const auftraege = useLaden(() => api.get<Lieferauftrag[]>(`/api/dispo/auftraege?bis=${datum}`), [datum]);
  const touren = useLaden(() => api.get<Tour[]>(`/api/dispo/touren?datum=${datum}`), [datum]);
  const fahrzeuge = useLaden(() => api.get<Fahrzeug[]>('/api/dispo/fahrzeuge'));
  const fahrer = useLaden(() => api.get<{ id: number; name: string }[]>('/api/dispo/fahrer'));
  const [routen, setRouten] = useState<Record<number, Route>>({});
  const [zielTour, setZielTour] = useState<number | null>(null);
  const [fahrzeugDialog, setFahrzeugDialog] = useState(false);
  const a = useAktion();
  const neu = () => {
    auftraege.neu();
    touren.neu();
  };

  // Koordinaten für neue Aufträge nachholen
  useEffect(() => {
    const ohne = (auftraege.daten ?? []).filter((x) => x.geoStatus === 'offen').map((x) => x.vorgangId);
    if (!ohne.length) return;
    api.post<{ gefunden: number }>('/api/dispo/geocode', { vorgangIds: ohne.slice(0, 20) }).then((r) => r.gefunden && auftraege.neu(), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auftraege.daten]);

  const offen = (auftraege.daten ?? []).filter((x) => x.status === 'offen');
  const lieferungen = offen.filter((x) => x.art === 'lieferung');
  const abholungen = offen.filter((x) => x.art === 'abholung');
  const tourenListe = touren.daten ?? [];
  if (zielTour === null && tourenListe[0]) setZielTour(tourenListe[0].id);

  const tourSpeichern = (t: Tour, aenderung: Partial<{ fahrzeugId: number | null; fahrerId: number | null; status: Tour['status']; bemerkung: string; stopps: number[] }>) =>
    a.ausfuehren(async () => {
      await api.put(`/api/dispo/touren/${t.id}`, {
        fahrzeugId: t.fahrzeug?.id ?? null,
        fahrerId: t.fahrer?.id ?? null,
        status: t.status,
        bemerkung: t.bemerkung,
        stopps: t.stopps.map((s) => s.vorgangId),
        ...aenderung,
      });
      setRouten((r) => { const { [t.id]: _, ...rest } = r; return rest; });
      neu();
    });

  const neueTour = () =>
    a.ausfuehren(async () => {
      const { id } = await api.post<{ id: number }>('/api/dispo/touren', { datum, fahrzeugId: fahrzeuge.daten?.find((f) => f.aktiv)?.id ?? null, fahrerId: null, bemerkung: '' });
      setZielTour(id);
      neu();
    });

  const zurTour = (s: Lieferauftrag) => {
    const t = tourenListe.find((x) => x.id === zielTour);
    if (!t) return;
    void tourSpeichern(t, { stopps: [...t.stopps.map((x) => x.vorgangId), s.vorgangId] });
  };

  const routeBerechnen = (t: Tour) =>
    a.ausfuehren(async () => {
      const r = await api.post<Route>(`/api/dispo/touren/${t.id}/route`);
      setRouten((x) => ({ ...x, [t.id]: r }));
      touren.neu();
    });

  return (
    <div className="touch">
      <div className="titelzeile">
        <h1>Dispo</h1>
        <input type="date" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} style={{ width: 'auto' }} />
        <button className="primaer" onClick={neueTour} disabled={a.laeuft}>Neue Tour</button>
        <button onClick={() => setFahrzeugDialog(true)}>Fahrzeuge</button>
      </div>
      <Meldung>{a.fehler ?? auftraege.fehler ?? touren.fehler}</Meldung>

      <Karte auftraege={offen} touren={tourenListe} routen={routen} />

      <div className="dispo-raster">
        <div className="karte">
          <h2>Offene Lieferungen bis {datumDeutsch(datum)}</h2>
          {tourenListe.length > 1 && (
            <p className="leise">
              Zuordnen zu:{' '}
              <select value={zielTour ?? ''} onChange={(e) => setZielTour(Number(e.target.value))} style={{ width: 'auto' }}>
                {tourenListe.map((t, i) => <option key={t.id} value={t.id}>Tour {i + 1} {t.fahrzeug?.name ?? ''}</option>)}
              </select>
            </p>
          )}
          {lieferungen.length === 0 && <p className="leise">Keine offenen Lieferungen.</p>}
          {lieferungen.map((s) => (
            <div key={s.vorgangId} className="stopp">
              <AuftragZeile s={s} />
              <button className="primaer" onClick={() => zurTour(s)} disabled={a.laeuft || !tourenListe.length} title={tourenListe.length ? '' : 'Zuerst eine Tour anlegen'}>
                → Tour
              </button>
            </div>
          ))}
          {abholungen.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Abholungen (Kunde holt ab)</h3>
              {abholungen.map((s) => (
                <div key={s.vorgangId} className="stopp">
                  <AuftragZeile s={s} />
                  <GeliefertKnopf s={s} text="Abgeholt" fertig={neu} />
                </div>
              ))}
            </>
          )}
        </div>

        <div>
          {tourenListe.length === 0 && <div className="karte"><p className="leise">Noch keine Tour für diesen Tag.</p></div>}
          {tourenListe.map((t, i) => (
            <div className="karte" key={t.id} style={{ borderLeft: `6px solid ${FARBEN[i % FARBEN.length]}` }}>
              <div className="titelzeile">
                <h2 style={{ margin: 0 }}>Tour {i + 1}</h2>
                <span className="marker">{TOUR_STATUS_NAMEN[t.status]}</span>
                {t.streckeKm !== null && <span className="leise">{t.streckeKm} km · {t.dauerMin} min</span>}
              </div>
              <div className="raster" style={{ marginTop: 10 }}>
                <Feld titel="Fahrzeug">
                  <select value={t.fahrzeug?.id ?? ''} onChange={(e) => tourSpeichern(t, { fahrzeugId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {fahrzeuge.daten?.filter((f) => f.aktiv || f.id === t.fahrzeug?.id).map((f) => <option key={f.id} value={f.id}>{f.name} {f.kennzeichen}</option>)}
                  </select>
                </Feld>
                <Feld titel="Fahrer">
                  <select value={t.fahrer?.id ?? ''} onChange={(e) => tourSpeichern(t, { fahrerId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {fahrer.daten?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Feld>
                <Feld titel="Status">
                  <select value={t.status} onChange={(e) => tourSpeichern(t, { status: e.target.value as Tour['status'] })}>
                    {TOUR_STATUS.map((s) => <option key={s} value={s}>{TOUR_STATUS_NAMEN[s]}</option>)}
                  </select>
                </Feld>
              </div>
              {t.stopps.map((s, j) => (
                <div key={s.vorgangId} className="stopp">
                  <span className="stopp-nr" style={{ background: FARBEN[i % FARBEN.length] }}>{j + 1}</span>
                  <AuftragZeile s={s} />
                  <div className="stopp-knoepfe">
                    <button aria-label="nach oben" disabled={j === 0 || a.laeuft} onClick={() => tourSpeichern(t, { stopps: tausche(t.stopps.map((x) => x.vorgangId), j, j - 1) })}>↑</button>
                    <button aria-label="nach unten" disabled={j === t.stopps.length - 1 || a.laeuft} onClick={() => tourSpeichern(t, { stopps: tausche(t.stopps.map((x) => x.vorgangId), j, j + 1) })}>↓</button>
                    {s.status === 'geliefert' ? (
                      <span className="marker gruen">geliefert</span>
                    ) : (
                      <button className="gefahr" aria-label="von der Tour nehmen" disabled={a.laeuft} onClick={() => tourSpeichern(t, { stopps: t.stopps.map((x) => x.vorgangId).filter((x) => x !== s.vorgangId) })}>✕</button>
                    )}
                  </div>
                </div>
              ))}
              <div className="knopfreihe">
                <button onClick={() => routeBerechnen(t)} disabled={a.laeuft || !t.stopps.length}>Route berechnen</button>
                <a className="knopf" href={`/api/dispo/touren/${t.id}/pdf`} target="_blank" rel="noopener">Tourenzettel (PDF)</a>
              </div>
            </div>
          ))}
        </div>
      </div>
      {fahrzeugDialog && <FahrzeugDialog schliessen={() => setFahrzeugDialog(false)} fertig={fahrzeuge.neu} />}
    </div>
  );
}

function tausche(liste: number[], i: number, j: number): number[] {
  const k = [...liste];
  [k[i], k[j]] = [k[j]!, k[i]!];
  return k;
}

export function AuftragZeile({ s }: { s: Lieferauftrag }) {
  const l = s.lieferung;
  return (
    <div className="stopp-text">
      <div>
        <a href={`#/verkauf/${s.vorgangId}`}><strong>{s.nummer}</strong></a> {s.kunde.name}
        {s.offenCent > 0 && <span className="marker rot">kassieren {euro(s.offenCent)}</span>}
        {s.geoStatus === 'fehler' && <span className="marker rot" title="Adresse nicht gefunden">Adresse?</span>}
      </div>
      <div className="leise">
        {s.kunde.strasse}, {s.kunde.plz} {s.kunde.ort}
        {s.kunde.telefon && ` · ${s.kunde.telefon}`}
      </div>
      <div className="leise">
        {[s.datum ? datumDeutsch(s.datum) : 'Termin offen', l.zeitfenster, etageText(l), l.montage ? `Montage ${l.montageMinuten} min` : '', l.hinweis].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

export function GeliefertKnopf({ s, text, fertig }: { s: Lieferauftrag; text: string; fertig: () => void }) {
  const a = useAktion();
  return (
    <button
      className="primaer"
      disabled={a.laeuft}
      onClick={() =>
        a.ausfuehren(async () => {
          await api.post(`/api/dispo/auftraege/${s.vorgangId}/geliefert`);
          fertig();
        })
      }
    >
      {text}
    </button>
  );
}

function Karte({ auftraege, touren, routen }: { auftraege: Lieferauftrag[]; touren: Tour[]; routen: Record<number, Route> }) {
  const ref = useRef<HTMLDivElement>(null);
  const karte = useRef<L.Map | null>(null);
  const ebene = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!ref.current || karte.current) return;
    karte.current = L.map(ref.current, { center: [51.2, 6.8], zoom: 11, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap-Mitwirkende' }).addTo(karte.current);
    ebene.current = L.layerGroup().addTo(karte.current);
  }, []);
  useEffect(() => {
    const k = karte.current;
    const e = ebene.current;
    if (!k || !e) return;
    e.clearLayers();
    const punkte: L.LatLngExpression[] = [];
    const marker = (s: Lieferauftrag, text: string, farbe: string) => {
      if (s.lat === null || s.lng === null) return;
      punkte.push([s.lat, s.lng]);
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'stopp-marker', html: `<span style="background:${farbe}">${text}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
        .bindPopup(`<strong>${s.nummer}</strong> ${s.kunde.name}<br>${s.kunde.strasse}, ${s.kunde.plz} ${s.kunde.ort}`)
        .addTo(e);
    };
    for (const s of auftraege) marker(s, s.art === 'abholung' ? 'A' : '•', '#6b7280');
    touren.forEach((t, i) => {
      t.stopps.forEach((s, j) => marker(s, String(j + 1), FARBEN[i % FARBEN.length]!));
      const r = routen[t.id];
      if (r) L.polyline(r.linie, { color: FARBEN[i % FARBEN.length], weight: 4, opacity: 0.8 }).addTo(e);
    });
    if (punkte.length) k.fitBounds(L.latLngBounds(punkte).pad(0.2), { maxZoom: 14 });
  }, [auftraege, touren, routen]);
  return <div ref={ref} className="landkarte" />;
}

function FahrzeugDialog({ schliessen, fertig }: { schliessen: () => void; fertig: () => void }) {
  const liste = useLaden(() => api.get<Fahrzeug[]>('/api/dispo/fahrzeuge'));
  const [f, setF] = useState<Omit<Fahrzeug, 'id'> & { id?: number }>({ name: '', kennzeichen: '', trackerId: '', aktiv: true });
  const a = useAktion();
  return (
    <Dialog titel="Fahrzeuge" schliessen={schliessen}>
      <table>
        <tbody>
          {liste.daten?.map((x) => (
            <tr key={x.id} className="klickbar" onClick={() => setF(x)}>
              <td>{x.name}</td>
              <td>{x.kennzeichen}</td>
              <td><span className={`marker ${x.aktiv ? 'gruen' : 'rot'}`}>{x.aktiv ? 'aktiv' : 'inaktiv'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="raster" style={{ marginTop: 12 }}>
        <Feld titel="Name (z. B. Wagen 5)"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Feld>
        <Feld titel="Kennzeichen"><input value={f.kennzeichen} onChange={(e) => setF({ ...f, kennzeichen: e.target.value })} /></Feld>
        <Feld titel="Tracker-ID (für später)"><input value={f.trackerId} onChange={(e) => setF({ ...f, trackerId: e.target.value })} className="mono" /></Feld>
        <label className="haken"><input type="checkbox" checked={f.aktiv} onChange={(e) => setF({ ...f, aktiv: e.target.checked })} /> aktiv</label>
      </div>
      <Meldung>{a.fehler}</Meldung>
      <div className="knopfreihe">
        <button className="primaer" disabled={a.laeuft || !f.name} onClick={() => a.ausfuehren(async () => {
          const { id, ...rest } = f;
          if (id) await api.put(`/api/dispo/fahrzeuge/${id}`, rest);
          else await api.post('/api/dispo/fahrzeuge', rest);
          setF({ name: '', kennzeichen: '', trackerId: '', aktiv: true });
          liste.neu();
          fertig();
        })}>{f.id ? 'Speichern' : 'Anlegen'}</button>
        {f.id && <button onClick={() => setF({ name: '', kennzeichen: '', trackerId: '', aktiv: true })}>Neu</button>}
        <button onClick={schliessen}>Schließen</button>
      </div>
    </Dialog>
  );
}
