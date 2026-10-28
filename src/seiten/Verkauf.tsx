// Neuer Verkauf in Schritten (Touch-first): Kunde → Artikel → Lieferung → Zahlung → Abschluss.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Ich } from '../../shared/types.ts';
import {
  ANREDEN,
  type Anschrift,
  centAus,
  centText,
  datumDeutsch,
  etageText,
  euro,
  LEERE_ANSCHRIFT,
  leerePosition,
  leererVorgang,
  LIEFERART_NAMEN,
  LIEFERARTEN,
  MONTAGE_MINUTEN,
  positionBrutto,
  positionGefuellt,
  RESTZAHLUNG_NAMEN,
  RESTZAHLUNGEN,
  STORNO_ROLLEN,
  summenBerechnen,
  VERKAUF_ROLLEN,
  type VerkaufVorgaben,
  type Vorgang,
  type VorgangDaten,
} from '../../shared/verkauf.ts';
import { api } from '../api.ts';
import { Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { VorgangAnsicht } from './Vorgang.tsx';

export const darfVerkaufen = (ich: Ich) => VERKAUF_ROLLEN.some((r) => ich.rollen.includes(r));
export const darfStornieren = (ich: Ich) => STORNO_ROLLEN.some((r) => ich.rollen.includes(r));

/** Eingaben, die der Server speichert (ohne berechnete Felder) */
function datenAus(v: Vorgang): VorgangDaten {
  const { kunde, rechnungsanschrift, positionen, rabatt, lieferung, zahlung, bemerkung } = v;
  return { kunde, rechnungsanschrift, positionen, rabatt, lieferung, zahlung, bemerkung };
}

/** #/verkauf/neu oder #/verkauf/<id>: Entwurf bearbeiten bzw. festgeschriebenen Vorgang anzeigen */
export function VerkaufSeite({ ich, id }: { ich: Ich; id: number | null }) {
  const vorgaben = useLaden(() => api.get<VerkaufVorgaben>('/api/verkauf/vorgaben'));
  const vorgang = useLaden(() => (id ? api.get<Vorgang>(`/api/vorgaenge/${id}`) : Promise.resolve(null)), [id]);
  const [fest, setFest] = useState<Vorgang | null>(null);

  if (vorgaben.fehler || vorgang.fehler) return <Meldung>{vorgaben.fehler ?? vorgang.fehler}</Meldung>;
  const v = fest ?? vorgang.daten;
  if (v && v.status === 'festgeschrieben') {
    const neu = async () => setFest(await api.get<Vorgang>(`/api/vorgaenge/${v.id}`));
    return <VorgangAnsicht ich={ich} vorgang={v} neuLaden={neu} />;
  }
  if (!vorgaben.daten || (id && !vorgang.daten)) return null;
  if (!ich.filiale && !v) return <Meldung art="hinweis">Bitte zuerst eine Filiale wählen.</Meldung>;
  return <Schritte key={v?.id ?? 'neu'} vorgaben={vorgaben.daten} start={v} fertig={setFest} />;
}

const SCHRITTE = ['Kunde', 'Artikel', 'Lieferung', 'Zahlung', 'Abschluss'] as const;

function Schritte({ vorgaben, start, fertig }: { vorgaben: VerkaufVorgaben; start: Vorgang | null; fertig: (v: Vorgang) => void }) {
  const [d, setD] = useState<VorgangDaten>(() => (start ? datenAus(start) : leererVorgang(vorgaben.ustSatz)));
  const [id, setId] = useState<number | null>(start?.id ?? null);
  const [schritt, setSchritt] = useState(0);
  const gespeichert = useRef(JSON.stringify(d));
  const a = useAktion();
  const summen = summenBerechnen(d, vorgaben.ustSatz);

  const speichern = async (): Promise<number> => {
    const json = JSON.stringify(d);
    if (id && json === gespeichert.current) return id;
    let neueId = id;
    if (neueId) await api.put(`/api/vorgaenge/${neueId}`, d);
    else {
      neueId = (await api.post<{ id: number }>('/api/vorgaenge', d)).id;
      setId(neueId);
      history.replaceState(null, '', `#/verkauf/${neueId}`);
    }
    gespeichert.current = json;
    return neueId;
  };

  const gehe = (ziel: number) =>
    a.ausfuehren(async () => {
      await speichern();
      setSchritt(ziel);
      window.scrollTo(0, 0);
    });

  const festschreiben = () =>
    a.ausfuehren(async () => {
      if (!confirm(`Rechnung über ${euro(summen.bruttoCent)} festschreiben? Danach ist nur noch ein Storno möglich.`)) return;
      const vid = await speichern();
      fertig(await api.post<Vorgang>(`/api/vorgaenge/${vid}/festschreiben`));
      window.scrollTo(0, 0);
    });

  const loeschen = () =>
    a.ausfuehren(async () => {
      if (id && !confirm('Entwurf verwerfen?')) return;
      if (id) await api.del(`/api/vorgaenge/${id}`);
      location.hash = '#/';
    });

  const vorschau = () =>
    a.ausfuehren(async () => {
      const vid = await speichern();
      window.open(`/api/vorgaenge/${vid}/pdf/rechnung`, '_blank');
    });

  return (
    <div className="touch">
      <nav className="schritte" aria-label="Schritte">
        {SCHRITTE.map((t, i) => (
          <button key={t} className={i === schritt ? 'aktiv' : i < schritt ? 'erledigt' : ''} onClick={() => gehe(i)} disabled={a.laeuft}>
            <span className="nr">{i + 1}</span> {t}
          </button>
        ))}
      </nav>

      {schritt === 0 && <KundeSchritt d={d} setD={setD} />}
      {schritt === 1 && <ArtikelSchritt d={d} setD={setD} vorgaben={vorgaben} />}
      {schritt === 2 && <LieferSchritt d={d} setD={setD} vorgaben={vorgaben} />}
      {schritt === 3 && <ZahlSchritt d={d} setD={setD} bruttoCent={summen.bruttoCent} />}
      {schritt === 4 && (
        <AbschlussSchritt d={d} setD={setD} summen={summen}>
          <Meldung>{a.fehler}</Meldung>
          <div className="knopfreihe">
            <button className="primaer gross" onClick={festschreiben} disabled={a.laeuft}>Rechnung festschreiben</button>
            <button className="gross" onClick={vorschau} disabled={a.laeuft}>Vorschau (PDF)</button>
            <button className="gross" onClick={() => a.ausfuehren(speichern, 'Entwurf gespeichert.')} disabled={a.laeuft}>Entwurf speichern</button>
            <button className="gross gefahr" onClick={loeschen} disabled={a.laeuft}>Verwerfen</button>
          </div>
          <Meldung art="ok">{a.ok}</Meldung>
        </AbschlussSchritt>
      )}
      {schritt < 4 && <Meldung>{a.fehler}</Meldung>}

      <div className="fussleiste">
        <button className="gross" onClick={() => gehe(schritt - 1)} disabled={schritt === 0 || a.laeuft}>Zurück</button>
        <div className="summe">
          <span className="leise">Summe</span>
          <strong>{euro(summen.bruttoCent)}</strong>
        </div>
        {schritt < 4 ? (
          <button className="primaer gross" onClick={() => gehe(schritt + 1)} disabled={a.laeuft}>Weiter</button>
        ) : (
          <span style={{ minWidth: 110 }} />
        )}
      </div>
    </div>
  );
}

type SchrittProps = { d: VorgangDaten; setD: (d: VorgangDaten) => void };

// ---------- Bausteine ----------

/** Auswahl per Knopf statt Dropdown */
export function Wahl<T extends string | number | boolean | null>({ optionen, wert, aendern }: { optionen: [T, string][]; wert: T; aendern: (w: T) => void }) {
  return (
    <div className="wahl" role="radiogroup">
      {optionen.map(([w, t]) => (
        <button key={String(w)} role="radio" aria-checked={w === wert} className={w === wert ? 'aktiv' : ''} onClick={() => aendern(w)} type="button">
          {t}
        </button>
      ))}
    </div>
  );
}

/** Betrag in Euro; auf dem iPad mit Ziffernblock */
export function Betrag({ cent, aendern, ...rest }: { cent: number; aendern: (c: number) => void; autoFocus?: boolean; 'aria-label'?: string }) {
  const [text, setText] = useState(cent ? centText(cent) : '');
  useEffect(() => {
    if (centAus(text) !== cent) setText(cent ? centText(cent) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cent]);
  const ungueltig = centAus(text) === null || (centAus(text) ?? 0) < 0;
  return (
    <div className="betrag">
      <input
        {...rest}
        inputMode="decimal"
        placeholder="0,00"
        className={ungueltig ? 'ungueltig' : ''}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = centAus(e.target.value);
          if (c !== null && c >= 0) aendern(c);
        }}
        onBlur={() => !ungueltig && setText(cent ? centText(cent) : '')}
      />
      <span>€</span>
    </div>
  );
}

function AnschriftFelder({ a, setA }: { a: Anschrift; setA: (a: Anschrift) => void }) {
  const feld = (k: Exclude<keyof Anschrift, 'anrede'>, titel: string, extra: Record<string, unknown> = {}) => (
    <Feld titel={titel}>
      <input value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} {...extra} />
    </Feld>
  );
  return (
    <>
      <div className="breit">
        <Wahl optionen={ANREDEN.map((x) => [x, x || 'ohne'])} wert={a.anrede} aendern={(anrede) => setA({ ...a, anrede })} />
      </div>
      {feld('name', 'Name', { autoComplete: 'off' })}
      {feld('zusatz', 'Zusatz (z. B. c/o, Firma)')}
      {feld('strasse', 'Straße, Hausnr.')}
      {feld('plz', 'PLZ', { inputMode: 'numeric' })}
      {feld('ort', 'Ort')}
    </>
  );
}

// ---------- 1 Kunde ----------

function KundeSchritt({ d, setD }: SchrittProps) {
  const k = d.kunde;
  const [vorschlaege, setVorschlaege] = useState<VorgangDaten['kunde'][]>([]);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    if (!offen || k.name.trim().length < 2) return setVorschlaege([]);
    const t = setTimeout(() => api.get<VorgangDaten['kunde'][]>(`/api/kunden?q=${encodeURIComponent(k.name)}`).then(setVorschlaege, () => {}), 250);
    return () => clearTimeout(t);
  }, [k.name, offen]);

  return (
    <div className="karte">
      <h2>Kunde</h2>
      <div className="raster">
        <AnschriftFelder
          a={k}
          setA={(a) => {
            if (a.name !== k.name) setOffen(true);
            setD({ ...d, kunde: { ...k, ...a } });
          }}
        />
        {vorschlaege.length > 0 && (
          <div className="breit vorschlaege">
            <span className="leise">Frühere Kunden:</span>
            {vorschlaege.map((v) => (
              <button
                key={`${v.name}|${v.strasse}|${v.plz}`}
                onClick={() => {
                  setD({ ...d, kunde: v });
                  setOffen(false);
                }}
              >
                <strong>{v.name}</strong> {[v.strasse, `${v.plz} ${v.ort}`.trim()].filter(Boolean).join(', ')}
              </button>
            ))}
          </div>
        )}
        <Feld titel="Telefon">
          <input type="tel" value={k.telefon} onChange={(e) => setD({ ...d, kunde: { ...k, telefon: e.target.value } })} />
        </Feld>
        <Feld titel="E-Mail">
          <input type="email" value={k.email} onChange={(e) => setD({ ...d, kunde: { ...k, email: e.target.value } })} />
        </Feld>
      </div>
      <h3 style={{ marginTop: 20 }}>Rechnungsanschrift</h3>
      <Wahl
        optionen={[[false, 'wie Kunde'], [true, 'abweichend']]}
        wert={d.rechnungsanschrift !== null}
        aendern={(ab) => setD({ ...d, rechnungsanschrift: ab ? { ...LEERE_ANSCHRIFT } : null })}
      />
      {d.rechnungsanschrift && (
        <div className="raster" style={{ marginTop: 12 }}>
          <AnschriftFelder a={d.rechnungsanschrift} setA={(a) => setD({ ...d, rechnungsanschrift: a })} />
        </div>
      )}
    </div>
  );
}

// ---------- 2 Artikel ----------

function ArtikelSchritt({ d, setD, vorgaben }: SchrittProps & { vorgaben: VerkaufVorgaben }) {
  const setPos = (i: number, p: Partial<VorgangDaten['positionen'][number]>) =>
    setD({ ...d, positionen: d.positionen.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const kennzeichen = vorgaben.hinweise.map((h) => h.zeichen);
  return (
    <>
      {d.positionen.map((p, i) => (
        <div className="karte position" key={i}>
          <div className="pos-kopf">
            <strong>Artikel {i + 1}</strong>
            <span className="leise">{positionGefuellt(p) ? euro(positionBrutto(p)) : ''}</span>
            {d.positionen.length > 1 && (
              <button className="gefahr" onClick={() => setD({ ...d, positionen: d.positionen.filter((_, j) => j !== i) })}>Entfernen</button>
            )}
          </div>
          <div className="raster">
            <Feld titel="Bezeichnung" breit>
              <input value={p.text} onChange={(e) => setPos(i, { text: e.target.value })} placeholder="z. B. Kleiderschrank Eiche" />
            </Feld>
            <div className="feld">
              Menge
              <div className="menge">
                <button onClick={() => setPos(i, { menge: Math.max(1, p.menge - 1) })} aria-label="weniger">−</button>
                <input inputMode="numeric" value={p.menge} onChange={(e) => Number(e.target.value) > 0 && setPos(i, { menge: Number(e.target.value) })} />
                <button onClick={() => setPos(i, { menge: p.menge + 1 })} aria-label="mehr">+</button>
              </div>
            </div>
            <div className="feld">
              Einzelpreis (brutto)
              <Betrag cent={p.preisCent} aendern={(preisCent) => setPos(i, { preisCent })} aria-label={`Preis Artikel ${i + 1}`} />
            </div>
            {vorgaben.ustSaetze.length > 1 && (
              <div className="feld">
                USt
                <Wahl optionen={vorgaben.ustSaetze.map((s) => [s, `${s} %`])} wert={p.ust} aendern={(ust) => setPos(i, { ust })} />
              </div>
            )}
            <Feld titel="Lagerort (falls abweichend)">
              <input value={p.lagerort} onChange={(e) => setPos(i, { lagerort: e.target.value })} />
            </Feld>
            {kennzeichen.length > 0 && (
              <div className="feld breit">
                Hinweise
                <div className="wahl">
                  {vorgaben.hinweise.map((h) => {
                    const an = p.kennzeichen.includes(h.zeichen);
                    return (
                      <button
                        key={h.zeichen}
                        className={an ? 'aktiv' : ''}
                        aria-pressed={an}
                        title={h.text}
                        onClick={() => setPos(i, { kennzeichen: an ? p.kennzeichen.filter((z) => z !== h.zeichen) : [...p.kennzeichen, h.zeichen] })}
                      >
                        ({h.zeichen}) {h.text.length > 40 ? `${h.text.slice(0, 40)}…` : h.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="knopfreihe" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="gross" onClick={() => setD({ ...d, positionen: [...d.positionen, leerePosition(vorgaben.ustSatz)] })} disabled={d.positionen.length >= 50}>
          + Weiterer Artikel
        </button>
      </div>
      {vorgaben.rabattarten.length > 0 && (
        <div className="karte">
          <h2>Rabatt</h2>
          <Wahl
            optionen={[[null, 'kein Rabatt'], ...vorgaben.rabattarten.map((r) => [r.kuerzel, `${r.name} (−${r.prozent} %)`] as [string, string])]}
            wert={d.rabatt?.kuerzel ?? null}
            aendern={(kz) => setD({ ...d, rabatt: vorgaben.rabattarten.find((r) => r.kuerzel === kz) ?? null })}
          />
          <p className="leise" style={{ marginTop: 8 }}>Gilt für die Artikel, nicht für Lieferung und Montage.</p>
        </div>
      )}
    </>
  );
}

// ---------- 3 Lieferung ----------

const ETAGEN: [number, string][] = [[-1, 'Bordsteinkante'], [0, 'EG'], ...Array.from({ length: 10 }, (_, i) => [i + 1, `${i + 1}. OG`] as [number, string])];

function LieferSchritt({ d, setD, vorgaben }: SchrittProps & { vorgaben: VerkaufVorgaben }) {
  const l = d.lieferung;
  const setL = (x: Partial<VorgangDaten['lieferung']>) => setD({ ...d, lieferung: { ...l, ...x } });
  return (
    <div className="karte">
      <h2>Lieferung</h2>
      <Wahl optionen={LIEFERARTEN.map((x) => [x, LIEFERART_NAMEN[x]])} wert={l.art} aendern={(art) => setL({ art })} />
      {l.art !== 'mitnahme' && (
        <div className="raster" style={{ marginTop: 16 }}>
          <Feld titel={l.art === 'lieferung' ? 'Ausliefern von' : 'Abholung aus'}>
            <input value={l.von} onChange={(e) => setL({ von: e.target.value })} list="orte" />
            <datalist id="orte">{vorgaben.orte.map((o) => <option key={o} value={o} />)}</datalist>
          </Feld>
          <Feld titel={l.art === 'lieferung' ? 'Liefertag' : 'Abholtag'}>
            <input type="date" value={l.datum ?? ''} onChange={(e) => setL({ datum: e.target.value || null })} />
          </Feld>
          {l.art === 'lieferung' && (
            <>
              <div className="feld breit">
                Zeitfenster
                <Wahl optionen={[['', 'offen'], ...vorgaben.lieferzeiten.map((z) => [z, z] as [string, string])]} wert={l.zeitfenster} aendern={(zeitfenster) => setL({ zeitfenster })} />
              </div>
              <div className="feld breit">
                Etage {etageText(l) && <strong>– {etageText(l)}</strong>}
                <Wahl optionen={ETAGEN} wert={l.etage} aendern={(etage) => setL({ etage })} />
                {l.etage !== null && l.etage > 0 && <Wahl optionen={[[false, 'ohne Aufzug'], [true, 'mit Aufzug']]} wert={l.aufzug} aendern={(aufzug) => setL({ aufzug })} />}
              </div>
              <div className="feld">
                Lieferkosten
                <Betrag cent={l.lieferkostenCent} aendern={(lieferkostenCent) => setL({ lieferkostenCent })} />
              </div>
              <div className="feld breit">
                Montage
                <Wahl optionen={[[false, 'Keine Montage'], [true, 'Mit Montage']]} wert={l.montage} aendern={(montage) => setL({ montage })} />
              </div>
              {l.montage && (
                <>
                  <div className="feld breit">
                    Voraussichtliche Dauer
                    <Wahl optionen={MONTAGE_MINUTEN.map((m) => [m, `${m} min`])} wert={l.montageMinuten as (typeof MONTAGE_MINUTEN)[number]} aendern={(montageMinuten) => setL({ montageMinuten })} />
                  </div>
                  <div className="feld">
                    Montagekosten
                    <Betrag cent={l.montagekostenCent} aendern={(montagekostenCent) => setL({ montagekostenCent })} />
                  </div>
                </>
              )}
              <Feld titel="Wagen">
                <input value={l.wagen} onChange={(e) => setL({ wagen: e.target.value })} />
              </Feld>
            </>
          )}
          <Feld titel="Hinweis für Lager/Fahrer" breit>
            <textarea value={l.hinweis} onChange={(e) => setL({ hinweis: e.target.value })} />
          </Feld>
        </div>
      )}
    </div>
  );
}

// ---------- 4 Zahlung ----------

type Art = 'voll' | 'anzahlung' | 'keine';

function ZahlSchritt({ d, setD, bruttoCent }: SchrittProps & { bruttoCent: number }) {
  const z = d.zahlung;
  const setZ = (x: Partial<VorgangDaten['zahlung']>) => setD({ ...d, zahlung: { ...z, ...x } });
  const [art, setArt] = useState<Art>(z.anzahlungCent === 0 ? 'keine' : z.anzahlungCent >= bruttoCent ? 'voll' : 'anzahlung');
  // Betrag folgt der Summe, solange „vollständig“ gewählt ist
  useEffect(() => {
    if (art === 'voll' && z.anzahlungCent !== bruttoCent) setZ({ anzahlungCent: bruttoCent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, bruttoCent]);
  const rest = bruttoCent - z.anzahlungCent;
  return (
    <div className="karte">
      <h2>Zahlung</h2>
      <p>Rechnungsbetrag: <strong>{euro(bruttoCent)}</strong></p>
      <Wahl<Art>
        optionen={[['voll', 'Jetzt vollständig'], ['anzahlung', 'Anzahlung'], ['keine', 'Jetzt nichts']]}
        wert={art}
        aendern={(a) => {
          setArt(a);
          setZ({ anzahlungCent: a === 'voll' ? bruttoCent : a === 'keine' ? 0 : Math.min(z.anzahlungCent, bruttoCent) });
        }}
      />
      {art !== 'keine' && (
        <div className="raster" style={{ marginTop: 16 }}>
          {art === 'anzahlung' && (
            <div className="feld">
              Anzahlung
              <Betrag cent={z.anzahlungCent} aendern={(anzahlungCent) => setZ({ anzahlungCent })} autoFocus />
            </div>
          )}
          <div className="feld">
            Bezahlt mit
            <Wahl optionen={[['bar', 'Bar'], ['ec', 'EC-Karte']]} wert={z.anzahlungMittel} aendern={(anzahlungMittel) => setZ({ anzahlungMittel })} />
          </div>
        </div>
      )}
      {rest > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Restbetrag {euro(rest)}</h3>
          <Wahl optionen={RESTZAHLUNGEN.map((r) => [r, RESTZAHLUNG_NAMEN[r]])} wert={z.rest} aendern={(r) => setZ({ rest: r })} />
        </div>
      )}
      {rest < 0 && <Meldung>Die Anzahlung ist höher als der Rechnungsbetrag.</Meldung>}
      <p className="leise" style={{ marginTop: 12 }}>Bar- und EC-Zahlungen wie bisher an der Kasse buchen; die Bon-Nummer kann bei Restzahlungen erfasst werden.</p>
    </div>
  );
}

// ---------- 5 Abschluss ----------

function AbschlussSchritt({ d, setD, summen, children }: SchrittProps & { summen: ReturnType<typeof summenBerechnen>; children: ReactNode }) {
  const l = d.lieferung;
  return (
    <>
      <div className="karte">
        <h2>Übersicht</h2>
        <p>
          <strong>{[d.kunde.anrede, d.kunde.name].filter(Boolean).join(' ') || <span className="fehlt">Kunde fehlt</span>}</strong>
          <br />
          {[d.kunde.strasse, `${d.kunde.plz} ${d.kunde.ort}`.trim()].filter(Boolean).join(', ')}
        </p>
        <Summentabelle d={d} summen={summen} />
        <p style={{ marginTop: 12 }}>
          {LIEFERART_NAMEN[l.art]}
          {l.datum && `, ${datumDeutsch(l.datum)}`}
          {l.zeitfenster && `, ${l.zeitfenster}`}
          {l.art === 'lieferung' && etageText(l) && `, ${etageText(l)}`}
          {l.art === 'lieferung' && l.montage && `, Montage ${l.montageMinuten} min`}
          <br />
          {d.zahlung.anzahlungCent > 0 ? `Jetzt ${euro(d.zahlung.anzahlungCent)} (${d.zahlung.anzahlungMittel === 'ec' ? 'EC' : 'bar'})` : 'Jetzt keine Zahlung'}
          {summen.bruttoCent - d.zahlung.anzahlungCent > 0 && `, Rest ${euro(summen.bruttoCent - d.zahlung.anzahlungCent)} ${RESTZAHLUNG_NAMEN[d.zahlung.rest].toLowerCase()}`}
        </p>
        <Feld titel="Bemerkung (erscheint auf der Rechnung)">
          <textarea value={d.bemerkung} onChange={(e) => setD({ ...d, bemerkung: e.target.value })} />
        </Feld>
      </div>
      <div className="karte">{children}</div>
    </>
  );
}

export function Summentabelle({ d, summen }: { d: VorgangDaten; summen: ReturnType<typeof summenBerechnen> }) {
  const vz = summen.bruttoCent < 0 ? -1 : 1;
  return (
    <div className="tabelle-huelle">
      <table className="summen">
        <thead>
          <tr><th>Menge</th><th>Artikel</th><th className="zahl">Einzel</th><th className="zahl">USt</th><th className="zahl">Gesamt</th></tr>
        </thead>
        <tbody>
          {d.positionen.filter(positionGefuellt).map((p, i) => (
            <tr key={i}>
              <td>{p.menge}</td>
              <td>
                {p.text || <span className="fehlt">Bezeichnung fehlt</span>}
                {p.kennzeichen.map((k) => ` (${k})`)}
                {p.lagerort && <div className="leise">Lager: {p.lagerort}</div>}
              </td>
              <td className="zahl">{euro(p.preisCent * vz)}</td>
              <td className="zahl">{p.ust} %</td>
              <td className="zahl">{euro(positionBrutto(p) * vz)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {summen.rabattCent !== 0 && d.rabatt && (
            <tr><td colSpan={4}>{d.rabatt.name} (−{d.rabatt.prozent} %)</td><td className="zahl">{euro(-summen.rabattCent)}</td></tr>
          )}
          {summen.lieferungCent !== 0 && <tr><td colSpan={4}>Lieferkosten</td><td className="zahl">{euro(summen.lieferungCent)}</td></tr>}
          {summen.montageCent !== 0 && <tr><td colSpan={4}>Montage</td><td className="zahl">{euro(summen.montageCent)}</td></tr>}
          <tr className="gesamt"><td colSpan={4}>Gesamt brutto</td><td className="zahl">{euro(summen.bruttoCent)}</td></tr>
          {summen.steuer.map((s) => (
            <tr key={s.satz} className="leise"><td colSpan={4}>darin {s.satz} % USt</td><td className="zahl">{euro(s.steuerCent)}</td></tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
