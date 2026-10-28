// Dispo: Lieferaufträge aus festgeschriebenen Vorgängen, Geocoding (Nominatim, zwischengespeichert),
// Routen (OSRM), Touren je Fahrzeug/Fahrer, Tourenzettel, Lieferkosten nach Entfernung.
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Fahrzeug, Lieferauftrag, Route, Tour } from '../../shared/dispo.ts';
import type { VorgangDaten } from '../../shared/verkauf.ts';
import { config } from './config.ts';
import type { MandantDB } from './db/schema.ts';
import { protokollieren } from './mandant.ts';
import { HttpFehler } from './sitzung.ts';

type Db = Kysely<MandantDB> | Transaction<MandantDB>;
const jetzt = () => new Date().toISOString();

// ---------- Lieferaufträge ----------

/** Beim Festschreiben: Lieferung oder Abholung wird zum Auftrag für die Dispo. */
export async function lieferauftragAnlegen(tx: Db, vorgangId: number, d: VorgangDaten): Promise<void> {
  if (d.lieferung.art === 'mitnahme') return;
  await tx
    .insertInto('lieferauftrag')
    .values({ vorgang_id: vorgangId, art: d.lieferung.art, status: 'offen', datum: d.lieferung.datum, tour_id: null, reihenfolge: null, lat: null, lng: null, geo_status: 'offen', geliefert_am: null, geliefert_von: '' })
    .onConflict((oc) => oc.column('vorgang_id').doNothing())
    .execute();
}

export async function lieferauftragStornieren(tx: Db, vorgangId: number): Promise<void> {
  await tx.updateTable('lieferauftrag').set({ status: 'storniert', tour_id: null, reihenfolge: null }).where('vorgang_id', '=', vorgangId).execute();
}

const adresseVon = (d: VorgangDaten) => `${d.kunde.strasse}, ${d.kunde.plz} ${d.kunde.ort}`.trim();

async function auftraegeLaden(db: Db, where: (q: ReturnType<typeof basisAbfrage>) => ReturnType<typeof basisAbfrage>): Promise<Lieferauftrag[]> {
  const zeilen = await where(basisAbfrage(db)).execute();
  return zeilen.map((z) => {
    const d = JSON.parse(z.daten) as VorgangDaten;
    return {
      vorgangId: z.vorgang_id,
      nummer: z.nummer ?? '',
      art: z.art,
      status: z.status,
      datum: z.datum,
      filiale: { id: z.filiale_id, kuerzel: z.kuerzel },
      kunde: { name: d.kunde.name, strasse: d.kunde.strasse, plz: d.kunde.plz, ort: d.kunde.ort, telefon: d.kunde.telefon },
      lieferung: d.lieferung,
      positionen: d.positionen,
      offenCent: z.storniert ? 0 : Math.max(0, z.brutto_cent - z.bezahlt),
      tourId: z.tour_id,
      reihenfolge: z.reihenfolge,
      lat: z.lat,
      lng: z.lng,
      geoStatus: z.geo_status,
      geliefertAm: z.geliefert_am,
      geliefertVon: z.geliefert_von,
    };
  });
}

function basisAbfrage(db: Db) {
  return db
    .selectFrom('lieferauftrag as l')
    .innerJoin('vorgang as v', 'v.id', 'l.vorgang_id')
    .innerJoin('filiale as f', 'f.id', 'v.filiale_id')
    .select([
      'l.vorgang_id',
      'l.art',
      'l.status',
      'l.datum',
      'l.tour_id',
      'l.reihenfolge',
      'l.lat',
      'l.lng',
      'l.geo_status',
      'l.geliefert_am',
      'l.geliefert_von',
      'v.nummer',
      'v.daten',
      'v.brutto_cent',
      'v.filiale_id',
      'f.kuerzel',
      sql<number>`(SELECT COALESCE(SUM(betrag_cent), 0) FROM zahlung WHERE vorgang_id = v.id)`.as('bezahlt'),
      sql<number>`(SELECT COUNT(*) FROM vorgang s WHERE s.bezug_id = v.id AND s.art = 'storno')`.as('storniert'),
    ])
    .orderBy('l.datum')
    .orderBy('l.reihenfolge')
    .orderBy('l.vorgang_id');
}

/** Offene und geplante Aufträge: bis zum Tag (einschließlich überfällige) sowie ohne Termin */
export async function auftraegeListe(db: Db, bis: string, sichtbar: number[] | null, status: ('offen' | 'geplant' | 'geliefert' | 'storniert')[] = ['offen', 'geplant']): Promise<Lieferauftrag[]> {
  return auftraegeLaden(db, (q) => {
    let a = q.where('l.status', 'in', status).where((eb) => eb.or([eb('l.datum', '<=', bis), eb('l.datum', 'is', null)]));
    if (sichtbar) a = a.where('v.filiale_id', 'in', sichtbar.length ? sichtbar : [-1]);
    return a;
  });
}

// ---------- Geocoding (Nominatim) ----------

// Nominatim erlaubt höchstens eine Anfrage je Sekunde; Anfragen werden nacheinander mit Abstand gestellt.
let geoKette: Promise<unknown> = Promise.resolve();

async function geocodeRoh(adresse: string): Promise<{ lat: number; lng: number } | null> {
  const lauf = geoKette.then(async () => {
    const u = `${config.geocodeUrl}/search?${new URLSearchParams({ format: 'jsonv2', q: adresse, limit: '1', countrycodes: 'de,at,ch,nl,be,lu' })}`;
    const r = await fetch(u, { headers: { 'user-agent': `${config.produktName} (${config.publicUrl})`, 'accept-language': 'de' }, signal: AbortSignal.timeout(15_000) });
    const json = r.ok ? ((await r.json()) as { lat: string; lon: string }[]) : [];
    await new Promise((ok) => setTimeout(ok, 1100));
    return json[0] ? { lat: Number(json[0].lat), lng: Number(json[0].lon) } : null;
  });
  geoKette = lauf.catch(() => undefined);
  return lauf;
}

export async function geocode(db: Db, adresse: string): Promise<{ lat: number; lng: number } | null> {
  const schluessel = adresse.trim().toLowerCase().replace(/\s+/g, ' ');
  if (schluessel.length < 5) return null;
  const c = await db.selectFrom('geo_cache').select(['lat', 'lng']).where('adresse', '=', schluessel).executeTakeFirst();
  if (c) return c.lat === null || c.lng === null ? null : { lat: c.lat, lng: c.lng };
  const treffer = await geocodeRoh(adresse);
  await db
    .insertInto('geo_cache')
    .values({ adresse: schluessel, lat: treffer?.lat ?? null, lng: treffer?.lng ?? null, zeit: jetzt() })
    .onConflict((oc) => oc.column('adresse').doUpdateSet({ lat: treffer?.lat ?? null, lng: treffer?.lng ?? null, zeit: jetzt() }))
    .execute();
  return treffer;
}

/** Koordinaten für Aufträge ohne Geocodierung nachholen (höchstens `max` je Aufruf) */
export async function auftraegeGeocoden(db: Kysely<MandantDB>, vorgangIds: number[], max = 20): Promise<number> {
  const offen = await db
    .selectFrom('lieferauftrag as l')
    .innerJoin('vorgang as v', 'v.id', 'l.vorgang_id')
    .select(['l.vorgang_id', 'v.daten'])
    .where('l.vorgang_id', 'in', vorgangIds.length ? vorgangIds : [-1])
    .where('l.geo_status', '=', 'offen')
    .limit(max)
    .execute();
  let n = 0;
  for (const z of offen) {
    const t = await geocode(db, adresseVon(JSON.parse(z.daten) as VorgangDaten)).catch(() => null);
    await db
      .updateTable('lieferauftrag')
      .set({ lat: t?.lat ?? null, lng: t?.lng ?? null, geo_status: t ? 'ok' : 'fehler' })
      .where('vorgang_id', '=', z.vorgang_id)
      .execute();
    if (t) n++;
  }
  return n;
}

// ---------- Routing (OSRM) ----------

export async function route(punkte: { lat: number; lng: number }[]): Promise<Route> {
  if (punkte.length < 2) return { km: 0, minuten: 0, linie: punkte.map((p) => [p.lat, p.lng]) };
  const koord = punkte.map((p) => `${p.lng},${p.lat}`).join(';');
  const r = await fetch(`${config.routingUrl}/route/v1/driving/${koord}?overview=full&geometries=geojson`, {
    headers: { 'user-agent': `${config.produktName} (${config.publicUrl})` },
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await r.json().catch(() => ({}))) as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
  const best = json.routes?.[0];
  if (!r.ok || json.code !== 'Ok' || !best) throw new HttpFehler(502, `Routenberechnung fehlgeschlagen (${json.code ?? r.status})`);
  return { km: Math.round(best.distance / 100) / 10, minuten: Math.round(best.duration / 60), linie: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
}

async function filialeKoordinaten(db: Db, filialeId: number): Promise<{ lat: number; lng: number }> {
  const f = await db.selectFrom('filiale').select(['strasse', 'plz', 'ort', 'name']).where('id', '=', filialeId).executeTakeFirst();
  if (!f) throw new HttpFehler(404, 'Filiale nicht gefunden');
  const t = await geocode(db, `${f.strasse}, ${f.plz} ${f.ort}`);
  if (!t) throw new HttpFehler(400, `Adresse der Filiale ${f.name} konnte nicht gefunden werden (Verwaltung → Filialen prüfen).`);
  return t;
}

/** Entfernung Filiale → Kunde (Straße) für den Lieferkosten-Vorschlag */
export async function entfernung(db: Db, filialeId: number, adresse: string): Promise<{ km: number; minuten: number }> {
  const start = await filialeKoordinaten(db, filialeId);
  const ziel = await geocode(db, adresse);
  if (!ziel) throw new HttpFehler(400, 'Die Kundenadresse konnte nicht gefunden werden.');
  const r = await route([start, ziel]);
  return { km: r.km, minuten: r.minuten };
}

// ---------- Fahrzeuge ----------

export async function fahrzeugeListe(db: Db): Promise<Fahrzeug[]> {
  const z = await db.selectFrom('fahrzeug').selectAll().orderBy('name').execute();
  return z.map((f) => ({ id: f.id, name: f.name, kennzeichen: f.kennzeichen, trackerId: f.tracker_id, aktiv: f.aktiv === 1 }));
}

export async function fahrzeugSpeichern(db: Db, f: Omit<Fahrzeug, 'id'> & { id?: number }): Promise<number> {
  const werte = { name: f.name.trim(), kennzeichen: f.kennzeichen.trim(), tracker_id: f.trackerId.trim(), aktiv: f.aktiv ? 1 : 0 };
  if (f.id) {
    const r = await db.updateTable('fahrzeug').set(werte).where('id', '=', f.id).executeTakeFirst();
    if (!r.numUpdatedRows) throw new HttpFehler(404, 'Fahrzeug nicht gefunden');
    return f.id;
  }
  return (await db.insertInto('fahrzeug').values(werte).returning('id').executeTakeFirstOrThrow()).id;
}

// ---------- Touren ----------

async function tourenBauen(db: Db, zeilen: { id: number; datum: string; fahrzeug_id: number | null; fahrer_benutzer_id: number | null; status: 'geplant' | 'unterwegs' | 'fertig'; bemerkung: string; strecke_km: number | null; dauer_min: number | null }[]): Promise<Tour[]> {
  if (!zeilen.length) return [];
  const ids = zeilen.map((t) => t.id);
  const stopps = await auftraegeLaden(db, (q) => q.where('l.tour_id', 'in', ids));
  const fahrzeuge = await fahrzeugeListe(db);
  const fahrer = await db.selectFrom('benutzer').select(['id', 'name']).execute();
  return zeilen.map((t) => ({
    id: t.id,
    datum: t.datum,
    fahrzeug: fahrzeuge.find((f) => f.id === t.fahrzeug_id) ?? null,
    fahrer: fahrer.find((b) => b.id === t.fahrer_benutzer_id) ?? null,
    status: t.status,
    bemerkung: t.bemerkung,
    streckeKm: t.strecke_km,
    dauerMin: t.dauer_min,
    stopps: stopps.filter((s) => s.tourId === t.id).sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0)),
  }));
}

export async function tourenAmTag(db: Db, datum: string, fahrerId?: number): Promise<Tour[]> {
  let q = db.selectFrom('tour').selectAll().where('datum', '=', datum).orderBy('id');
  if (fahrerId) q = q.where('fahrer_benutzer_id', '=', fahrerId);
  return tourenBauen(db, await q.execute());
}

export async function tourLesen(db: Db, id: number): Promise<Tour> {
  const z = await db.selectFrom('tour').selectAll().where('id', '=', id).executeTakeFirst();
  if (!z) throw new HttpFehler(404, 'Tour nicht gefunden');
  return (await tourenBauen(db, [z]))[0]!;
}

export async function tourAnlegen(db: Db, t: { datum: string; fahrzeugId: number | null; fahrerId: number | null; bemerkung: string }, person: string): Promise<number> {
  const r = await db
    .insertInto('tour')
    .values({ datum: t.datum, fahrzeug_id: t.fahrzeugId, fahrer_benutzer_id: t.fahrerId, status: 'geplant', bemerkung: t.bemerkung, strecke_km: null, dauer_min: null, erstellt_von: person, erstellt_am: jetzt() })
    .returning('id')
    .executeTakeFirstOrThrow();
  await protokollieren(db, person, 'Tour angelegt', `Tour ${r.id}`, t);
  return r.id;
}

export async function tourSpeichern(
  db: Kysely<MandantDB>,
  id: number,
  t: { fahrzeugId: number | null; fahrerId: number | null; status: 'geplant' | 'unterwegs' | 'fertig'; bemerkung: string; stopps: number[] },
  person: string,
  sichtbar: number[] | null,
): Promise<Tour> {
  return db.transaction().execute(async (tx) => {
    const tour = await tx.selectFrom('tour').select(['id', 'datum']).where('id', '=', id).executeTakeFirst();
    if (!tour) throw new HttpFehler(404, 'Tour nicht gefunden');
    // Stopps, die diese Tour verlassen, werden wieder offen
    await tx.updateTable('lieferauftrag').set({ tour_id: null, reihenfolge: null, status: 'offen' }).where('tour_id', '=', id).where('status', '=', 'geplant').where('vorgang_id', 'not in', t.stopps.length ? t.stopps : [-1]).execute();
    for (const [i, vorgangId] of t.stopps.entries()) {
      const a = await tx.selectFrom('lieferauftrag as l').innerJoin('vorgang as v', 'v.id', 'l.vorgang_id').select(['l.status', 'l.tour_id', 'l.art', 'v.filiale_id']).where('l.vorgang_id', '=', vorgangId).executeTakeFirst();
      if (!a || (sichtbar && !sichtbar.includes(a.filiale_id))) throw new HttpFehler(404, `Auftrag ${vorgangId} nicht gefunden`);
      if (a.art !== 'lieferung') throw new HttpFehler(400, 'Abholungen gehören nicht auf eine Tour');
      if (a.status === 'storniert') throw new HttpFehler(409, `Auftrag ${vorgangId} ist storniert`);
      if (a.tour_id && a.tour_id !== id && a.status === 'geplant') throw new HttpFehler(409, `Auftrag ${vorgangId} ist schon auf Tour ${a.tour_id}`);
      await tx
        .updateTable('lieferauftrag')
        .set({ tour_id: id, reihenfolge: i + 1, status: a.status === 'geliefert' ? 'geliefert' : 'geplant', datum: sql`COALESCE(datum, ${tour.datum})` })
        .where('vorgang_id', '=', vorgangId)
        .execute();
    }
    await tx.updateTable('tour').set({ fahrzeug_id: t.fahrzeugId, fahrer_benutzer_id: t.fahrerId, status: t.status, bemerkung: t.bemerkung, strecke_km: null, dauer_min: null }).where('id', '=', id).execute();
    await protokollieren(tx, person, 'Tour geändert', `Tour ${id}`, { stopps: t.stopps, status: t.status });
    return tourLesen(tx, id);
  });
}

/** Route Filiale → Stopps → Filiale; Strecke und Dauer werden an der Tour gespeichert. */
export async function tourRoute(db: Kysely<MandantDB>, id: number): Promise<Route> {
  const t = await tourLesen(db, id);
  const stopps = t.stopps.filter((s) => s.status !== 'storniert');
  if (!stopps.length) throw new HttpFehler(400, 'Die Tour hat keine Stopps.');
  await auftraegeGeocoden(db, stopps.map((s) => s.vorgangId));
  const frisch = await tourLesen(db, id);
  const ohne = frisch.stopps.filter((s) => s.lat === null || s.lng === null);
  if (ohne.length) throw new HttpFehler(400, `Adresse nicht gefunden: ${ohne.map((s) => `${s.nummer} ${s.kunde.name}`).join(', ')}`);
  const start = await filialeKoordinaten(db, frisch.stopps[0]!.filiale.id);
  const r = await route([start, ...frisch.stopps.map((s) => ({ lat: s.lat!, lng: s.lng! })), start]);
  await db.updateTable('tour').set({ strecke_km: r.km, dauer_min: r.minuten }).where('id', '=', id).execute();
  return r;
}

export async function geliefert(db: Kysely<MandantDB>, vorgangId: number, person: string, sichtbar: number[] | null): Promise<void> {
  const a = await db.selectFrom('lieferauftrag as l').innerJoin('vorgang as v', 'v.id', 'l.vorgang_id').select(['l.status', 'l.tour_id', 'v.filiale_id', 'v.nummer']).where('l.vorgang_id', '=', vorgangId).executeTakeFirst();
  if (!a || (sichtbar && !sichtbar.includes(a.filiale_id))) throw new HttpFehler(404, 'Auftrag nicht gefunden');
  if (a.status === 'storniert') throw new HttpFehler(409, 'Der Auftrag ist storniert.');
  await db.updateTable('lieferauftrag').set({ status: 'geliefert', geliefert_am: jetzt(), geliefert_von: person }).where('vorgang_id', '=', vorgangId).execute();
  await protokollieren(db, person, 'Geliefert', a.nummer ?? String(vorgangId));
  if (a.tour_id) {
    const rest = await db.selectFrom('lieferauftrag').select('vorgang_id').where('tour_id', '=', a.tour_id).where('status', '=', 'geplant').executeTakeFirst();
    await db.updateTable('tour').set({ status: rest ? 'unterwegs' : 'fertig' }).where('id', '=', a.tour_id).execute();
  }
}
