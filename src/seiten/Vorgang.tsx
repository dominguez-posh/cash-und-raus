// Festgeschriebener Vorgang: Dokumente, Restzahlung, Storno. Dazu die Suche.
import { type FormEvent, useState } from 'react';
import type { Ich } from '../../shared/types.ts';
import {
  anschriftZeilen,
  datumDeutsch,
  euro,
  LIEFERART_NAMEN,
  RESTZAHLUNG_NAMEN,
  type Vorgang,
  type VorgangKurz,
  ZAHLMITTEL,
  ZAHLMITTEL_NAMEN,
  type Zahlmittel,
} from '../../shared/verkauf.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, Meldung, speicherLesen, speicherSchreiben, useAktion, useLaden } from '../ui.tsx';
import { ZAHLUNG_ROLLEN } from '../../shared/verkauf.ts';
import { Betrag, darfStornieren, darfVerkaufen, Summentabelle, Wahl } from './Verkauf.tsx';

const ZWECK = { anzahlung: 'Anzahlung', restzahlung: 'Restzahlung', erstattung: 'Erstattung' } as const;

export function VorgangAnsicht({ ich, vorgang: v, neuLaden }: { ich: Ich; vorgang: Vorgang; neuLaden: () => Promise<void> }) {
  const [dialog, setDialog] = useState<'zahlung' | 'storno' | 'email' | null>(null);
  const emails = useLaden(() => api.get<EmailEintrag[]>(`/api/vorgaenge/${v.id}/emails`), [v.id]);
  const pdf = (art: string, zahlung?: number) => `/api/vorgaenge/${v.id}/pdf/${art}${zahlung ? `?zahlung=${zahlung}` : ''}`;
  const storno = v.art === 'storno';
  const offen = v.offenCent > 0 && !v.storno;

  return (
    <div className="touch">
      <div className="titelzeile">
        <h1>
          {storno ? 'Storno' : 'Rechnung'} {v.nummer}
        </h1>
        {v.storno && <a className="marker rot" href={`#/verkauf/${v.storno.id}`}>storniert durch {v.storno.nummer}</a>}
        {storno && v.bezug && <a className="marker" href={`#/verkauf/${v.bezug.id}`}>zu Rechnung {v.bezug.nummer}</a>}
        {!storno && !v.storno && <span className={`marker ${offen ? 'rot' : 'gruen'}`}>{offen ? `offen ${euro(v.offenCent)}` : 'bezahlt'}</span>}
      </div>
      <p className="leise">
        {datumDeutsch(v.datum)} · Filiale {v.filiale.kuerzel} · {v.sachbearbeiter}
      </p>

      <div className="kacheln aktionen">
        <a className="kachel knopf-kachel" href={pdf('rechnung')} target="_blank" rel="noopener">
          <h3>{storno ? 'Stornorechnung' : 'Rechnung'}</h3>
          <span className="leise">PDF öffnen / drucken</span>
        </a>
        {!storno && (
          <>
            {v.lieferung.art !== 'mitnahme' && (
              <a className="kachel knopf-kachel" href={pdf('lieferschein')} target="_blank" rel="noopener">
                <h3>Lieferschein</h3>
                <span className="leise">mit Unterschriftsfeld</span>
              </a>
            )}
            <a className="kachel knopf-kachel" href={pdf('kommission')} target="_blank" rel="noopener">
              <h3>Kommission</h3>
              <span className="leise">fürs Lager, mit Lagerorten</span>
            </a>
            {offen && ZAHLUNG_ROLLEN.some((r) => ich.rollen.includes(r)) && (
              <button className="kachel knopf-kachel primaer" onClick={() => setDialog('zahlung')}>
                <h3>Zahlung erfassen</h3>
                <span>offen {euro(v.offenCent)}</span>
              </button>
            )}
            {darfVerkaufen(ich) && (
              <button className="kachel knopf-kachel" onClick={() => setDialog('email')}>
                <h3>Per E-Mail senden</h3>
                <span className="leise">{emails.daten?.length ? `zuletzt an ${emails.daten[0]!.an}` : 'Rechnung, Lieferschein als PDF'}</span>
              </button>
            )}
            {!v.storno && darfStornieren(ich) && (
              <button className="kachel knopf-kachel" onClick={() => setDialog('storno')}>
                <h3>Stornieren</h3>
                <span className="leise">erzeugt eine Stornorechnung</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="karte">
        <div className="raster">
          <div>
            <h3>Kunde</h3>
            {anschriftZeilen(v.kunde).map((z) => <div key={z}>{z}</div>)}
            {v.kunde.telefon && <div>Tel. {v.kunde.telefon}</div>}
            {v.kunde.email && <div>{v.kunde.email}</div>}
          </div>
          {v.rechnungsanschrift && (
            <div>
              <h3>Rechnungsanschrift</h3>
              {anschriftZeilen(v.rechnungsanschrift).map((z) => <div key={z}>{z}</div>)}
            </div>
          )}
          <div>
            <h3>{LIEFERART_NAMEN[v.lieferung.art]}</h3>
            {v.lieferung.datum && <div>{datumDeutsch(v.lieferung.datum)} {v.lieferung.zeitfenster}</div>}
            {v.lieferung.von && <div>{v.lieferung.von}</div>}
            {v.lieferung.hinweis && <div className="leise">{v.lieferung.hinweis}</div>}
            {!storno && v.offenCent > 0 && <div>Rest: {RESTZAHLUNG_NAMEN[v.zahlung.rest]}</div>}
          </div>
        </div>
        {storno && v.stornoGrund && <p style={{ marginTop: 12 }}>Grund: {v.stornoGrund}</p>}
      </div>

      <div className="karte">
        <Summentabelle d={v} summen={v.summen} />
        {v.bemerkung && <p style={{ marginTop: 12 }}>{v.bemerkung}</p>}
      </div>

      {v.zahlungen.length > 0 && (
        <div className="karte">
          <h2>Zahlungen</h2>
          <table>
            <tbody>
              {v.zahlungen.map((z) => (
                <tr key={z.id}>
                  <td>{datumZeit(z.zeit)}</td>
                  <td>{ZWECK[z.zweck]}</td>
                  <td>{ZAHLMITTEL_NAMEN[z.mittel]}{z.kassenBon && ` · Bon ${z.kassenBon}`}</td>
                  <td className="zahl">{euro(z.betragCent)}</td>
                  <td>{z.zweck === 'restzahlung' && <a href={pdf('quittung', z.id)} target="_blank" rel="noopener">Quittung</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {emails.daten && emails.daten.length > 0 && (
        <div className="karte">
          <h2>Gesendete E-Mails</h2>
          <table>
            <tbody>
              {emails.daten.map((m) => (
                <tr key={m.id}>
                  <td>{datumZeit(m.zeit)}</td>
                  <td>{m.an}</td>
                  <td>{m.anhaenge.join(', ')}</td>
                  <td className="leise">{m.person}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog === 'email' && <EmailDialog v={v} schliessen={() => setDialog(null)} fertig={emails.neu} />}
      {dialog === 'zahlung' && <ZahlungDialog v={v} schliessen={() => setDialog(null)} fertig={neuLaden} />}
      {dialog === 'storno' && <StornoDialog v={v} schliessen={() => setDialog(null)} />}
    </div>
  );
}

export function ZahlungDialog({ v, schliessen, fertig }: { v: Vorgang; schliessen: () => void; fertig: () => Promise<void> }) {
  const [betragCent, setBetrag] = useState(v.offenCent);
  const [mittel, setMittel] = useState<Zahlmittel>('bar');
  const [kassenBon, setBon] = useState('');
  const a = useAktion();
  const buchen = () =>
    a.ausfuehren(async () => {
      const { zahlungId } = await api.post<{ zahlungId: number }>(`/api/vorgaenge/${v.id}/zahlungen`, { betragCent, mittel, kassenBon });
      window.open(`/api/vorgaenge/${v.id}/pdf/quittung?zahlung=${zahlungId}`, '_blank');
      schliessen();
      await fertig();
    });
  return (
    <Dialog titel={`Zahlung zu ${v.nummer}`} schliessen={schliessen}>
      <div className="touch stapel">
        <div className="feld">
          Betrag (offen {euro(v.offenCent)})
          <Betrag cent={betragCent} aendern={setBetrag} autoFocus />
        </div>
        <Wahl optionen={ZAHLMITTEL.map((m) => [m, ZAHLMITTEL_NAMEN[m]])} wert={mittel} aendern={setMittel} />
        <Feld titel="Kassenbon-Nr. (optional)">
          <input inputMode="numeric" value={kassenBon} onChange={(e) => setBon(e.target.value)} />
        </Feld>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross" onClick={buchen} disabled={a.laeuft || betragCent <= 0}>Buchen und Quittung drucken</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

function StornoDialog({ v, schliessen }: { v: Vorgang; schliessen: () => void }) {
  const [grund, setGrund] = useState('');
  const [mittel, setMittel] = useState<Zahlmittel>(v.zahlungen[0]?.mittel ?? 'bar');
  const a = useAktion();
  const stornieren = () =>
    a.ausfuehren(async () => {
      const { id } = await api.post<{ id: number }>(`/api/vorgaenge/${v.id}/storno`, { grund, mittel });
      window.open(`/api/vorgaenge/${id}/pdf/rechnung`, '_blank');
      location.hash = `#/verkauf/${id}`;
    });
  return (
    <Dialog titel={`Rechnung ${v.nummer} stornieren`} schliessen={schliessen}>
      <div className="touch stapel">
        <p>Es wird eine Stornorechnung über {euro(-v.summen.bruttoCent)} mit eigener Nummer erstellt. Das lässt sich nicht rückgängig machen.</p>
        <Feld titel="Grund">
          <textarea value={grund} onChange={(e) => setGrund(e.target.value)} autoFocus />
        </Feld>
        {v.bezahltCent > 0 && (
          <div className="feld">
            Erstattung von {euro(v.bezahltCent)} per
            <Wahl optionen={ZAHLMITTEL.map((m) => [m, ZAHLMITTEL_NAMEN[m]])} wert={mittel} aendern={setMittel} />
          </div>
        )}
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross gefahr-voll" onClick={stornieren} disabled={a.laeuft || grund.trim().length < 3}>Stornieren</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

interface EmailEintrag {
  id: number;
  zeit: string;
  an: string;
  betreff: string;
  anhaenge: string[];
  person: string;
}

function EmailDialog({ v, schliessen, fertig }: { v: Vorgang; schliessen: () => void; fertig: () => void }) {
  const [an, setAn] = useState(v.kunde.email);
  const [text, setText] = useState('');
  const [anhaenge, setAnhaenge] = useState<string[]>(['rechnung']);
  const a = useAktion();
  const umschalten = (x: string) => setAnhaenge(anhaenge.includes(x) ? anhaenge.filter((y) => y !== x) : [...anhaenge, x]);
  const senden = () =>
    a.ausfuehren(async () => {
      await api.post(`/api/vorgaenge/${v.id}/email`, { an, text, anhaenge });
      fertig();
      schliessen();
    });
  const moeglich: [string, string][] = [['rechnung', v.art === 'storno' ? 'Stornorechnung' : 'Rechnung']];
  if (v.art !== 'storno') moeglich.push(['lieferschein', 'Lieferschein'], ['kommission', 'Kommission']);
  return (
    <Dialog titel={`${v.nummer} per E-Mail senden`} schliessen={schliessen}>
      <div className="touch stapel">
        <Feld titel="Empfänger">
          <input type="email" value={an} onChange={(e) => setAn(e.target.value)} autoFocus />
        </Feld>
        <div className="feld">
          Anhänge
          <div className="wahl">
            {moeglich.map(([k, t]) => (
              <button key={k} className={anhaenge.includes(k) ? 'aktiv' : ''} aria-pressed={anhaenge.includes(k)} onClick={() => umschalten(k)} type="button">
                {t}
              </button>
            ))}
          </div>
        </div>
        <Feld titel="Nachricht (leer = Standardtext)">
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </Feld>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross" onClick={senden} disabled={a.laeuft || !an || !anhaenge.length}>Senden</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Suche ----------

export function Suche() {
  const [q, setQ] = useState(() => speicherLesen('cr-suche'));
  const [begriff, setBegriff] = useState(q);
  const liste = useLaden(() => api.get<VorgangKurz[]>(`/api/vorgaenge?q=${encodeURIComponent(begriff)}`), [begriff]);
  const suchen = (e?: FormEvent) => {
    e?.preventDefault();
    speicherSchreiben('cr-suche', q);
    setBegriff(q);
  };
  return (
    <div className="touch">
      <h1>Rechnung suchen</h1>
      <form className="suchzeile" onSubmit={suchen}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechnungsnummer, Name, Straße oder Telefon" autoFocus />
        <button className="primaer gross">Suchen</button>
      </form>
      <Meldung>{liste.fehler}</Meldung>
      <div className="trefferliste">
        {liste.daten?.map((v) => (
          <a key={v.id} className="treffer" href={`#/verkauf/${v.id}`}>
            <div>
              <strong>{v.nummer ?? 'Entwurf'}</strong>
              {v.art === 'storno' && <span className="marker rot">Storno</span>}
              {v.storniert && <span className="marker rot">storniert</span>}
              {v.status === 'entwurf' && <span className="marker">Entwurf</span>}
              <div className="leise">{datumDeutsch(v.datum)} · {v.filiale}</div>
            </div>
            <div>
              {v.kunde || <span className="leise">ohne Namen</span>}
              <div className="leise">{v.ort}</div>
            </div>
            <div className="zahl">
              {euro(v.bruttoCent)}
              {v.offenCent > 0 && <div className="offen">offen {euro(v.offenCent)}</div>}
            </div>
          </a>
        ))}
        {liste.daten?.length === 0 && <p className="leise">Nichts gefunden.</p>}
      </div>
    </div>
  );
}
