// Kasse: Tagesstand, Belege, Tagesabschluss mit Zählprotokoll.
import { useState } from 'react';
import { ABSCHLUSS_ROLLEN, BELEG_ART_NAMEN, type BelegArt, KASSE_ROLLEN, type Kassenabschluss, type Kassentag, MUENZEN, SCHEINE, type Zaehlung, zaehlungSumme } from '../../shared/kasse.ts';
import type { Ich } from '../../shared/types.ts';
import { datumDeutsch, euro, type VerkaufVorgaben } from '../../shared/verkauf.ts';
import { api } from '../api.ts';
import { datumZeit, Dialog, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { Betrag, Wahl } from './Verkauf.tsx';

export const darfKasse = (ich: Ich) => KASSE_ROLLEN.some((r) => ich.rollen.includes(r));
const darfAbschluss = (ich: Ich) => ABSCHLUSS_ROLLEN.some((r) => ich.rollen.includes(r));

const heute = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

export function Kasse({ ich }: { ich: Ich }) {
  const [datum, setDatum] = useState(heute());
  const [filialeId, setFilialeId] = useState(ich.filiale?.id ?? ich.filialen[0]?.id);
  const tag = useLaden(() => (filialeId ? api.get<Kassentag>(`/api/kasse/tag?datum=${datum}&filiale=${filialeId}`) : Promise.resolve(null)), [datum, filialeId]);
  const [dialog, setDialog] = useState<'beleg' | 'abschluss' | null>(null);
  if (!filialeId) return <Meldung art="hinweis">Keine Filiale verfügbar.</Meldung>;
  const t = tag.daten;
  return (
    <div className="touch">
      <div className="titelzeile">
        <h1>Kasse</h1>
        {ich.filialen.length > 1 && (
          <select value={filialeId} onChange={(e) => setFilialeId(Number(e.target.value))} style={{ width: 'auto' }}>
            {ich.filialen.map((f) => <option key={f.id} value={f.id}>{f.kuerzel} {f.name}</option>)}
          </select>
        )}
        <input type="date" value={datum} max={heute()} onChange={(e) => e.target.value && setDatum(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <Meldung>{tag.fehler}</Meldung>
      {t && (
        <>
          {t.abschluss ? (
            <Meldung art="ok">
              Tag abgeschlossen am {datumZeit(t.abschluss.zeit)} ·{' '}
              <a href={`/api/kasse/abschluesse/${t.abschluss.id}/pdf`} target="_blank" rel="noopener">Kassenabschluss (PDF)</a>
            </Meldung>
          ) : (
            <div className="kacheln aktionen">
              <button className="kachel knopf-kachel primaer" onClick={() => setDialog('beleg')}>
                <h3>Neuer Beleg</h3>
                <span>Einnahme oder Ausgabe</span>
              </button>
              {darfAbschluss(ich) && (
                <button className="kachel knopf-kachel" onClick={() => setDialog('abschluss')}>
                  <h3>Tagesabschluss</h3>
                  <span className="leise">Zählen, Z-Bon abgleichen</span>
                </button>
              )}
            </div>
          )}

          <div className="karte">
            <h2>Stand {datumDeutsch(t.datum)}</h2>
            <table className="summen">
              <tbody>
                <tr><td>Wechselgeld (Anfangsbestand)</td><td className="zahl">{euro(t.anfangCent)}</td></tr>
                <tr><td>+ Barzahlungen aus dem Verkauf</td><td className="zahl">{euro(t.barZahlungenCent)}</td></tr>
                <tr><td>+ Einnahmen (Belege)</td><td className="zahl">{euro(t.einnahmenCent)}</td></tr>
                <tr><td>− Ausgaben (Belege)</td><td className="zahl">{euro(-t.ausgabenCent)}</td></tr>
                <tr className="gesamt"><td>Soll in der Kasse</td><td className="zahl">{euro(t.sollCent)}</td></tr>
                <tr className="leise"><td>EC-Zahlungen (nicht in der Barkasse)</td><td className="zahl">{euro(t.ecCent)}</td></tr>
                {t.abschluss && (
                  <>
                    <tr><td>Gezählt (Ist)</td><td className="zahl">{euro(t.abschluss.istCent)}</td></tr>
                    <tr className={t.abschluss.differenzCent ? 'offen' : ''}><td>Differenz</td><td className="zahl">{euro(t.abschluss.differenzCent)}</td></tr>
                    <tr><td>Entnahme zur Bank</td><td className="zahl">{euro(t.abschluss.entnahmeCent)}</td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="karte">
            <h2>Barzahlungen aus dem Verkauf</h2>
            {t.zahlungen.filter((z) => z.mittel === 'bar').length === 0 && <p className="leise">Keine Barzahlungen an diesem Tag.</p>}
            <table>
              <tbody>
                {t.zahlungen.filter((z) => z.mittel === 'bar').map((z) => (
                  <tr key={z.zahlungId}>
                    <td>{datumZeit(z.zeit).split(', ')[1]}</td>
                    <td><a href={`#/verkauf/${z.vorgangId}`}>{z.nummer}</a></td>
                    <td>{z.kunde}</td>
                    <td>{z.zweck}</td>
                    <td className="zahl">{euro(z.betragCent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="karte">
            <h2>Belege</h2>
            {t.belege.length === 0 && <p className="leise">Keine Belege an diesem Tag.</p>}
            <table>
              <tbody>
                {t.belege.map((b) => (
                  <tr key={b.id} className={b.storniertDurch ? 'leise' : ''}>
                    <td><a href={`/api/kasse/belege/${b.id}/pdf`} target="_blank" rel="noopener">{b.nummer}</a></td>
                    <td>{BELEG_ART_NAMEN[b.art]}</td>
                    <td>{b.grund}{b.text && <div className="leise">{b.text}</div>}</td>
                    <td className="zahl" style={{ textDecoration: b.storniertDurch ? 'line-through' : undefined }}>{euro(b.art === 'ausgabe' ? -b.betragCent : b.betragCent)}</td>
                    <td>{b.storniertDurch ? <span className="marker rot">storniert</span> : !b.stornoVon && !t.abschluss && <StornoKnopf id={b.id} fertig={tag.neu} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dialog === 'beleg' && <BelegDialog filialeId={t.filiale.id} datum={t.datum} schliessen={() => setDialog(null)} fertig={tag.neu} />}
          {dialog === 'abschluss' && <AbschlussDialog tag={t} schliessen={() => setDialog(null)} fertig={tag.neu} />}
        </>
      )}
      <Abschluesse filialeId={filialeId} />
    </div>
  );
}

function StornoKnopf({ id, fertig }: { id: number; fertig: () => void }) {
  const a = useAktion();
  return (
    <button
      className="link gefahr"
      disabled={a.laeuft}
      onClick={() => {
        const grund = prompt('Grund für den Gegenbeleg?');
        if (grund) void a.ausfuehren(async () => {
          await api.post(`/api/kasse/belege/${id}/storno`, { grund });
          fertig();
        });
      }}
    >
      stornieren
    </button>
  );
}

function BelegDialog({ filialeId, datum, schliessen, fertig }: { filialeId: number; datum: string; schliessen: () => void; fertig: () => void }) {
  const vorgaben = useLaden(() => api.get<VerkaufVorgaben>('/api/verkauf/vorgaben'));
  const [art, setArt] = useState<BelegArt>('ausgabe');
  const [grund, setGrund] = useState('');
  const [text, setText] = useState('');
  const [betragCent, setBetrag] = useState(0);
  const a = useAktion();
  const speichern = () =>
    a.ausfuehren(async () => {
      const b = await api.post<{ id: number }>('/api/kasse/belege', { filiale: filialeId, datum, art, grund, text, betragCent });
      window.open(`/api/kasse/belege/${b.id}/pdf`, '_blank');
      fertig();
      schliessen();
    });
  return (
    <Dialog titel="Neuer Kassenbeleg" schliessen={schliessen}>
      <div className="touch stapel">
        <Wahl optionen={[['ausgabe', 'Ausgabe (aus der Kasse)'], ['einnahme', 'Einnahme (in die Kasse)']]} wert={art} aendern={setArt} />
        <div className="feld">
          Grund
          <div className="wahl">
            {(vorgaben.daten?.belegGruende ?? []).map((g) => (
              <button key={g} className={grund === g ? 'aktiv' : ''} onClick={() => setGrund(g)} type="button">{g}</button>
            ))}
          </div>
          <input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="oder frei eingeben" />
        </div>
        <Feld titel="Text (z. B. Wagen-Nr., Lieferant)">
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </Feld>
        <div className="feld">
          Betrag
          <Betrag cent={betragCent} aendern={setBetrag} />
        </div>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross" onClick={speichern} disabled={a.laeuft || !grund || betragCent <= 0}>Beleg buchen und drucken</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

function AbschlussDialog({ tag, schliessen, fertig }: { tag: Kassentag; schliessen: () => void; fertig: () => void }) {
  const [z, setZ] = useState<Zaehlung>({});
  const [zBonNr, setZBonNr] = useState('');
  const [zBar, setZBar] = useState<number | null>(null);
  const [bemerkung, setBemerkung] = useState('');
  const [uebergeben, setUebergeben] = useState('');
  const [uebernommen, setUebernommen] = useState('');
  const a = useAktion();
  const ist = zaehlungSumme(z);
  const differenz = ist - tag.sollCent;
  const anzahl = (wert: number) => (
    <tr key={wert}>
      <td>{euro(wert)}</td>
      <td>
        <input inputMode="numeric" value={z[String(wert)] ?? ''} placeholder="0" style={{ width: 90, textAlign: 'right' }}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0) setZ({ ...z, [String(wert)]: n }); }} />
      </td>
      <td className="zahl">{euro(wert * (z[String(wert)] ?? 0))}</td>
    </tr>
  );
  const abschliessen = () =>
    a.ausfuehren(async () => {
      if (!confirm(`Tag ${datumDeutsch(tag.datum)} mit Ist ${euro(ist)} abschließen? Danach sind keine Belege für diesen Tag mehr möglich.`)) return;
      const r = await api.post<Kassenabschluss>('/api/kasse/abschluss', { filiale: tag.filiale.id, datum: tag.datum, zaehlung: z, zBonNr, zBarCent: zBar, bemerkung, uebergebenVon: uebergeben, uebernommenVon: uebernommen });
      window.open(`/api/kasse/abschluesse/${r.id}/pdf`, '_blank');
      fertig();
      schliessen();
    });
  return (
    <Dialog titel={`Tagesabschluss ${tag.filiale.kuerzel} · ${datumDeutsch(tag.datum)}`} schliessen={schliessen}>
      <div className="touch">
        <div className="raster">
          <div>
            <h3>Scheine</h3>
            <table className="summen"><tbody>{SCHEINE.map(anzahl)}</tbody></table>
          </div>
          <div>
            <h3>Münzen</h3>
            <table className="summen"><tbody>{MUENZEN.map(anzahl)}</tbody></table>
          </div>
        </div>
        <table className="summen" style={{ marginTop: 12 }}>
          <tbody>
            <tr><td>Soll</td><td className="zahl">{euro(tag.sollCent)}</td></tr>
            <tr className="gesamt"><td>Ist (gezählt)</td><td className="zahl">{euro(ist)}</td></tr>
            <tr className={differenz ? 'offen' : ''}><td>Differenz</td><td className="zahl">{euro(differenz)}</td></tr>
            <tr><td>Entnahme zur Bank (Ist − Wechselgeld)</td><td className="zahl">{euro(Math.max(0, ist - tag.anfangCent))}</td></tr>
          </tbody>
        </table>
        <div className="raster" style={{ marginTop: 12 }}>
          <Feld titel="Z-Bon Nr. (Kasse)"><input value={zBonNr} onChange={(e) => setZBonNr(e.target.value)} /></Feld>
          <div className="feld">
            Z-Bon Barumsatz (zum Abgleich)
            <Betrag cent={zBar ?? 0} aendern={setZBar} />
            {zBar !== null && zBar !== tag.barZahlungenCent && <span className="fehlt">Abweichung zu den Barzahlungen: {euro(zBar - tag.barZahlungenCent)}</span>}
          </div>
          <Feld titel="Übergeben von"><input value={uebergeben} onChange={(e) => setUebergeben(e.target.value)} /></Feld>
          <Feld titel="Übernommen von"><input value={uebernommen} onChange={(e) => setUebernommen(e.target.value)} /></Feld>
          <Feld titel="Bemerkung" breit><textarea value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} /></Feld>
        </div>
        <Meldung>{a.fehler}</Meldung>
        <div className="knopfreihe">
          <button className="primaer gross" onClick={abschliessen} disabled={a.laeuft}>Abschließen und drucken</button>
          <button className="gross" onClick={schliessen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

function Abschluesse({ filialeId }: { filialeId: number }) {
  const liste = useLaden(() => api.get<Kassenabschluss[]>(`/api/kasse/abschluesse?filiale=${filialeId}`), [filialeId]);
  if (!liste.daten?.length) return null;
  return (
    <div className="karte">
      <h2>Letzte Abschlüsse</h2>
      <table>
        <thead><tr><th>Tag</th><th className="zahl">Soll</th><th className="zahl">Ist</th><th className="zahl">Differenz</th><th>Z-Bon</th><th /></tr></thead>
        <tbody>
          {liste.daten.map((x) => (
            <tr key={x.id}>
              <td>{datumDeutsch(x.datum)}</td>
              <td className="zahl">{euro(x.sollCent)}</td>
              <td className="zahl">{euro(x.istCent)}</td>
              <td className={`zahl${x.differenzCent ? ' fehlt' : ''}`}>{euro(x.differenzCent)}</td>
              <td>{x.zBonNr || '–'}</td>
              <td><a href={`/api/kasse/abschluesse/${x.id}/pdf`} target="_blank" rel="noopener">PDF</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
