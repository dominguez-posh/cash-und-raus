// Neuer Verkauf in Schritten (Touch-first): Kunde → Artikel → Lieferung → Zahlung → Abschluss.
// Je Schritt nur das Nötige; Seltenes steht hinter „Weitere Angaben“.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Artikel } from '../../shared/lager.ts';
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
import { Aufklapp, Feld, Meldung, useAktion, useLaden } from '../ui.tsx';
import { VorgangAnsicht } from './Vorgang.tsx';

export const darfVerkaufen = (ich: Ich) => VERKAUF_ROLLEN.some((r) => ich.rollen.includes(r));
export const darfStornieren = (ich: Ich) => STORNO_ROLLEN.some((r) => ich.rollen.includes(r));

type Pos = VorgangDaten['positionen'][number];

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
      <div className="schritt-kopf">
        <h1>{SCHRITTE[schritt]}</h1>
        <span className="leise">Schritt {schritt + 1} von {SCHRITTE.length}</span>
        <div className="punkte" aria-label="Schritte">
          {SCHRITTE.map((t, i) => (
            <button key={t} title={t} aria-label={`${i + 1} ${t}`} className={i === schritt ? 'aktiv' : i < schritt ? 'erledigt' : ''} onClick={() => gehe(i)} disabled={a.laeuft} />
          ))}
        </div>
      </div>

      {schritt === 0 && <KundeSchritt d={d} setD={setD} />}
      {schritt === 1 && <ArtikelSchritt d={d} setD={setD} vorgaben={vorgaben} />}
      {schritt === 2 && <LieferSchritt d={d} setD={setD} vorgaben={vorgaben} />}
      {schritt === 3 && <ZahlSchritt d={d} setD={setD} bruttoCent={summen.bruttoCent} />}
      {schritt === 4 && (
        <AbschlussSchritt d={d} setD={setD} summen={summen}>
          <Meldung>{a.fehler}</Meldung>
          <div className="aktionen-haupt">
            <button className="primaer" onClick={festschreiben} disabled={a.laeuft}>Rechnung festschreiben</button>
            <button onClick={vorschau} disabled={a.laeuft}>Vorschau (PDF)</button>
          </div>
          <div className="aktionen-weitere">
            <button onClick={() => a.ausfuehren(speichern, 'Entwurf gespeichert.')} disabled={a.laeuft}>Entwurf speichern</button>
            <button className="gefahr" onClick={loeschen} disabled={a.laeuft}>Verwerfen</button>
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

/** Auswahl per Knopf statt Dropdown; `klein` für Zeilen mit vielen Werten */
export function Wahl<T extends string | number | boolean | null>({ optionen, wert, aendern, klein }: { optionen: [T, string][]; wert: T; aendern: (w: T) => void; klein?: boolean }) {
  return (
    <div className={`wahl${klein ? ' chips' : ''}`} role="radiogroup">
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
      {feld('name', 'Name', { autoComplete: 'off' })}
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
      <Wahl klein optionen={ANREDEN.map((x) => [x, x || 'ohne Anrede'])} wert={k.anrede} aendern={(anrede) => setD({ ...d, kunde: { ...k, anrede } })} />
      <div className="raster" style={{ marginTop: 12 }}>
        <AnschriftFelder
          a={k}
          setA={(a) => {
            if (a.name !== k.name) setOffen(true);
            setD({ ...d, kunde: { ...k, ...a } });
          }}
        />
        {vorschlaege.length > 0 && (
          <div className="breit vorschlaege">
            <span className="leise">Schon einmal gekauft:</span>
            {vorschlaege.map((v) => (
              <button
                key={`${v.name}|${v.strasse}|${v.plz}`}
                type="button"
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
      </div>
      <Aufklapp offen={Boolean(k.zusatz || k.email || d.rechnungsanschrift)}>
        <div className="raster">
          <Feld titel="Zusatz (z. B. c/o, Firma)">
            <input value={k.zusatz} onChange={(e) => setD({ ...d, kunde: { ...k, zusatz: e.target.value } })} />
          </Feld>
          <Feld titel="E-Mail (für den Rechnungsversand)">
            <input type="email" value={k.email} onChange={(e) => setD({ ...d, kunde: { ...k, email: e.target.value } })} />
          </Feld>
          <div className="feld breit">
            Rechnungsanschrift
            <Wahl
              klein
              optionen={[[false, 'wie Kunde'], [true, 'abweichend']]}
              wert={d.rechnungsanschrift !== null}
              aendern={(ab) => setD({ ...d, rechnungsanschrift: ab ? { ...LEERE_ANSCHRIFT } : null })}
            />
          </div>
          {d.rechnungsanschrift && <AnschriftFelder a={d.rechnungsanschrift} setA={(a) => setD({ ...d, rechnungsanschrift: a })} />}
        </div>
      </Aufklapp>
    </div>
  );
}

// ---------- 2 Artikel ----------

function ArtikelSchritt({ d, setD, vorgaben }: SchrittProps & { vorgaben: VerkaufVorgaben }) {
  const setPos = (i: number, p: Partial<Pos>) => setD({ ...d, positionen: d.positionen.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const mehrNoetig = vorgaben.ustSaetze.length > 1 || vorgaben.lagerorte.length > 0 || vorgaben.hinweise.length > 0;
  return (
    <>
      {d.positionen.map((p, i) => (
        <div className="karte position" key={i}>
          <div className="pos-kopf">
            <strong>Artikel {i + 1}</strong>
            <span className="leise">{positionGefuellt(p) ? euro(positionBrutto(p)) : ''}</span>
            {d.positionen.length > 1 && (
              <button className="link gefahr" onClick={() => setD({ ...d, positionen: d.positionen.filter((_, j) => j !== i) })}>entfernen</button>
            )}
          </div>
          <div className="raster">
            <ArtikelFeld p={p} setP={(x) => setPos(i, x)} vorgaben={vorgaben} />
            <div className="feld">
              Menge
              <div className="menge">
                <button onClick={() => setPos(i, { menge: Math.max(1, p.menge - 1) })} aria-label="weniger">−</button>
                <input inputMode="numeric" value={p.menge} onChange={(e) => Number(e.target.value) > 0 && setPos(i, { menge: Number(e.target.value) })} />
                <button onClick={() => setPos(i, { menge: p.menge + 1 })} aria-label="mehr">+</button>
              </div>
            </div>
            <div className="feld">
              Preis (brutto)
              <Betrag cent={p.preisCent} aendern={(preisCent) => setPos(i, { preisCent })} aria-label={`Preis Artikel ${i + 1}`} />
            </div>
          </div>
          {mehrNoetig && (
            <Aufklapp titel="USt, Lagerort, Hinweise" offen={p.kennzeichen.length > 0 || (p.lagerortId ?? null) !== null || p.ust !== vorgaben.ustSatz}>
              <div className="raster">
                {vorgaben.ustSaetze.length > 1 && (
                  <div className="feld">
                    USt
                    <Wahl klein optionen={vorgaben.ustSaetze.map((s) => [s, `${s} %`])} wert={p.ust} aendern={(ust) => setPos(i, { ust })} />
                  </div>
                )}
                {vorgaben.lagerorte.length > 0 ? (
                  <div className="feld">
                    Lagerort
                    <Wahl
                      klein
                      optionen={[[null, p.artikelId ? 'Standard' : '–'], ...vorgaben.lagerorte.map((l) => [l.id, l.name] as [number, string])]}
                      wert={p.lagerortId ?? null}
                      aendern={(lid) => setPos(i, { lagerortId: lid, lagerort: vorgaben.lagerorte.find((l) => l.id === lid)?.name ?? '' })}
                    />
                  </div>
                ) : (
                  <Feld titel="Lagerort">
                    <input value={p.lagerort} onChange={(e) => setPos(i, { lagerort: e.target.value })} />
                  </Feld>
                )}
                {vorgaben.hinweise.length > 0 && (
                  <div className="feld breit">
                    Hinweis auf der Rechnung
                    <div className="wahl chips">
                      {vorgaben.hinweise.map((h) => {
                        const an = p.kennzeichen.includes(h.zeichen);
                        return (
                          <button key={h.zeichen} type="button" className={an ? 'aktiv' : ''} aria-pressed={an} title={h.text}
                            onClick={() => setPos(i, { kennzeichen: an ? p.kennzeichen.filter((z) => z !== h.zeichen) : [...p.kennzeichen, h.zeichen] })}>
                            ({h.zeichen}) {h.text.length > 32 ? `${h.text.slice(0, 32)}…` : h.text}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Aufklapp>
          )}
        </div>
      ))}
      <div className="aktionen-weitere">
        <button className="gross" onClick={() => setD({ ...d, positionen: [...d.positionen, leerePosition(vorgaben.ustSatz)] })} disabled={d.positionen.length >= 50}>
          + Weiterer Artikel
        </button>
      </div>
      {vorgaben.rabattarten.length > 0 && (
        <div className="karte">
          <div className="feld">
            Rabatt auf die Artikel
            <Wahl
              klein
              optionen={[[null, 'kein Rabatt'], ...vorgaben.rabattarten.map((r) => [r.kuerzel, `${r.name} −${r.prozent} %`] as [string, string])]}
              wert={d.rabatt?.kuerzel ?? null}
              aendern={(kz) => setD({ ...d, rabatt: vorgaben.rabattarten.find((r) => r.kuerzel === kz) ?? null })}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** Bezeichnung mit Vorschlägen aus dem Artikelstamm; Auswahl übernimmt Preis, USt und Lagerort */
function ArtikelFeld({ p, setP, vorgaben }: { p: Pos; setP: (x: Partial<Pos>) => void; vorgaben: VerkaufVorgaben }) {
  const [vorschlaege, setVorschlaege] = useState<Artikel[]>([]);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    if (!offen || p.text.trim().length < 2 || p.artikelId) return setVorschlaege([]);
    const t = setTimeout(() => api.get<Artikel[]>(`/api/artikel?q=${encodeURIComponent(p.text)}`).then(setVorschlaege, () => {}), 200);
    return () => clearTimeout(t);
  }, [p.text, p.artikelId, offen]);
  return (
    <div className="feld breit">
      Artikel {p.artikelId && <span className="marker gruen">aus dem Artikelstamm</span>}
      <input
        value={p.text}
        placeholder="z. B. Kleiderschrank Eiche"
        onChange={(e) => {
          setOffen(true);
          setP({ text: e.target.value, artikelId: null });
        }}
        onBlur={() => setTimeout(() => setOffen(false), 150)}
      />
      {vorschlaege.length > 0 && (
        <div className="vorschlaege">
          {vorschlaege.map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setP({ text: a.bezeichnung, preisCent: a.preisCent, ust: a.ust, artikelId: a.id, lagerortId: a.lagerortId, lagerort: vorgaben.lagerorte.find((l) => l.id === a.lagerortId)?.name ?? '' });
                setVorschlaege([]);
                setOffen(false);
              }}
            >
              <strong>{a.bezeichnung}</strong> <span className="leise">{a.nummer} · {euro(a.preisCent)} · Bestand {a.bestand}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 3 Lieferung ----------

const ETAGEN: [number, string][] = [[-1, 'Bordstein'], [0, 'EG'], ...Array.from({ length: 10 }, (_, i) => [i + 1, `${i + 1}.`] as [number, string])];

function LieferSchritt({ d, setD, vorgaben }: SchrittProps & { vorgaben: VerkaufVorgaben }) {
  const l = d.lieferung;
  const setL = (x: Partial<VorgangDaten['lieferung']>) => setD({ ...d, lieferung: { ...l, ...x } });
  return (
    <div className="karte">
      <Wahl optionen={LIEFERARTEN.map((x) => [x, LIEFERART_NAMEN[x]])} wert={l.art} aendern={(art) => setL({ art })} />
      {l.art === 'abholung' && (
        <div className="raster" style={{ marginTop: 16 }}>
          <Feld titel="Abholtag">
            <input type="date" value={l.datum ?? ''} onChange={(e) => setL({ datum: e.target.value || null })} />
          </Feld>
          <Feld titel="Abholung aus">
            <input value={l.von} onChange={(e) => setL({ von: e.target.value })} list="orte" />
            <datalist id="orte">{vorgaben.orte.map((o) => <option key={o} value={o} />)}</datalist>
          </Feld>
        </div>
      )}
      {l.art === 'lieferung' && (
        <>
          <div className="raster" style={{ marginTop: 16 }}>
            <Feld titel="Liefertag">
              <input type="date" value={l.datum ?? ''} onChange={(e) => setL({ datum: e.target.value || null })} />
            </Feld>
            <div className="feld breit">
              Zeitfenster
              <Wahl klein optionen={[['', 'offen'], ...vorgaben.lieferzeiten.map((z) => [z, z] as [string, string])]} wert={l.zeitfenster} aendern={(zeitfenster) => setL({ zeitfenster })} />
            </div>
            <div className="feld breit">
              Etage {etageText(l) && <strong>– {etageText(l)}</strong>}
              <Wahl klein optionen={ETAGEN} wert={l.etage} aendern={(etage) => setL({ etage })} />
              {l.etage !== null && l.etage > 0 && <Wahl klein optionen={[[false, 'ohne Aufzug'], [true, 'mit Aufzug']]} wert={l.aufzug} aendern={(aufzug) => setL({ aufzug })} />}
            </div>
            <div className="feld">
              Lieferkosten
              <Betrag cent={l.lieferkostenCent} aendern={(lieferkostenCent) => setL({ lieferkostenCent })} />
              <Entfernung d={d} uebernehmen={(lieferkostenCent) => setL({ lieferkostenCent })} />
            </div>
            <div className="feld">
              Montage
              <Wahl klein optionen={[[false, 'keine'], [true, 'mit Montage']]} wert={l.montage} aendern={(montage) => setL({ montage })} />
            </div>
            {l.montage && (
              <>
                <div className="feld">
                  Dauer
                  <Wahl klein optionen={MONTAGE_MINUTEN.map((m) => [m, `${m} min`])} wert={l.montageMinuten as (typeof MONTAGE_MINUTEN)[number]} aendern={(montageMinuten) => setL({ montageMinuten })} />
                </div>
                <div className="feld">
                  Montagekosten
                  <Betrag cent={l.montagekostenCent} aendern={(montagekostenCent) => setL({ montagekostenCent })} />
                </div>
              </>
            )}
          </div>
          <Aufklapp offen={Boolean(l.von || l.wagen || l.hinweis)}>
            <div className="raster">
              <Feld titel="Ausliefern von">
                <input value={l.von} onChange={(e) => setL({ von: e.target.value })} list="orte" />
                <datalist id="orte">{vorgaben.orte.map((o) => <option key={o} value={o} />)}</datalist>
              </Feld>
              <Feld titel="Wagen">
                <input value={l.wagen} onChange={(e) => setL({ wagen: e.target.value })} />
              </Feld>
              <Feld titel="Hinweis für Lager und Fahrer" breit>
                <textarea value={l.hinweis} onChange={(e) => setL({ hinweis: e.target.value })} />
              </Feld>
            </div>
          </Aufklapp>
        </>
      )}
    </div>
  );
}

/** Lieferkosten-Vorschlag aus der Fahrstrecke Filiale → Kunde */
function Entfernung({ d, uebernehmen }: { d: VorgangDaten; uebernehmen: (cent: number) => void }) {
  const [ergebnis, setErgebnis] = useState<{ km: number; minuten: number; vorschlagCent: number } | null>(null);
  const a = useAktion();
  const k = d.kunde;
  return (
    <div className="knopfreihe" style={{ marginTop: 6 }}>
      <button
        type="button"
        disabled={a.laeuft || !k.strasse || !k.ort}
        onClick={() => a.ausfuehren(async () => setErgebnis(await api.post('/api/dispo/entfernung', { strasse: k.strasse, plz: k.plz, ort: k.ort })))}
      >
        Nach Entfernung
      </button>
      {ergebnis && (
        <span>
          {ergebnis.km} km → <button type="button" className="link" onClick={() => uebernehmen(ergebnis.vorschlagCent)}>{euro(ergebnis.vorschlagCent)} übernehmen</button>
        </span>
      )}
      <Meldung>{a.fehler}</Meldung>
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
      <p style={{ fontSize: 18 }}>Rechnungsbetrag: <strong>{euro(bruttoCent)}</strong></p>
      <div className="feld">
        Der Kunde zahlt jetzt
        <Wahl<Art>
          optionen={[['voll', 'alles'], ['anzahlung', 'eine Anzahlung'], ['keine', 'nichts']]}
          wert={art}
          aendern={(x) => {
            setArt(x);
            setZ({ anzahlungCent: x === 'voll' ? bruttoCent : x === 'keine' ? 0 : Math.min(z.anzahlungCent, bruttoCent) });
          }}
        />
      </div>
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
        <div className="feld" style={{ marginTop: 16 }}>
          Rest {euro(rest)} kommt
          <Wahl optionen={RESTZAHLUNGEN.map((r) => [r, RESTZAHLUNG_NAMEN[r].toLowerCase()])} wert={z.rest} aendern={(r) => setZ({ rest: r })} />
        </div>
      )}
      {rest < 0 && <Meldung>Die Anzahlung ist höher als der Rechnungsbetrag.</Meldung>}
    </div>
  );
}

// ---------- 5 Abschluss ----------

function AbschlussSchritt({ d, setD, summen, children }: SchrittProps & { summen: ReturnType<typeof summenBerechnen>; children: ReactNode }) {
  const l = d.lieferung;
  return (
    <>
      <div className="karte">
        <p style={{ fontSize: 17 }}>
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
        <Aufklapp titel="Bemerkung auf der Rechnung" offen={Boolean(d.bemerkung)}>
          <textarea value={d.bemerkung} onChange={(e) => setD({ ...d, bemerkung: e.target.value })} />
        </Aufklapp>
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
