// Dispo: Lieferaufträge, Geocoding, Fahrzeuge, Touren, Tourenzettel, Fahrer-Ansicht, Lieferkosten nach Entfernung.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AUFTRAG_STATUS, DISPO_ROLLEN, FAHRER_ROLLEN, lieferkostenVorschlag, TOUR_STATUS } from '../../../shared/dispo.ts';
import type { Rolle } from '../../../shared/types.ts';
import { VERKAUF_ROLLEN } from '../../../shared/verkauf.ts';
import { auftraegeGeocoden, auftraegeListe, entfernung, fahrzeugeListe, fahrzeugSpeichern, geliefert, tourAnlegen, tourenAmTag, tourLesen, tourRoute, tourSpeichern } from '../dispo.ts';
import { einstellungenLesen, filialenListe, protokollieren } from '../mandant.ts';
import { tourPdf } from '../pdf.ts';
import { HttpFehler, mitRolle } from '../sitzung.ts';
import { heuteBerlin } from '../verkauf.ts';

const DATUM = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');

function kontext(req: FastifyRequest, rollen: Rolle[]) {
  const k = mitRolle(req, ...rollen);
  const sichtbar = k.rollen.includes('admin') ? null : k.filialen.map((f) => f.id);
  return { ...k, sichtbar, person: k.sitzung.email };
}

const FahrzeugDaten = z.object({ name: z.string().trim().min(1, 'Name fehlt').max(60), kennzeichen: z.string().trim().max(20).default(''), trackerId: z.string().trim().max(60).default(''), aktiv: z.boolean().default(true) });

export function dispoRouten(app: FastifyInstance): void {
  app.get('/api/dispo/auftraege', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const q = z.object({ bis: DATUM.default(heuteBerlin()), status: z.string().default('offen,geplant') }).parse(req.query);
    const status = q.status.split(',').filter((s): s is (typeof AUFTRAG_STATUS)[number] => (AUFTRAG_STATUS as readonly string[]).includes(s));
    return auftraegeListe(k.db, q.bis, k.sichtbar, status.length ? status : ['offen', 'geplant']);
  });

  app.post('/api/dispo/geocode', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const { vorgangIds } = z.object({ vorgangIds: z.array(z.number().int()).max(50) }).parse(req.body);
    return { gefunden: await auftraegeGeocoden(k.db, vorgangIds) };
  });

  app.get('/api/dispo/fahrzeuge', async (req) => fahrzeugeListe(kontext(req, FAHRER_ROLLEN).db));
  app.post('/api/dispo/fahrzeuge', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const d = FahrzeugDaten.parse(req.body);
    const id = await fahrzeugSpeichern(k.db, d);
    await protokollieren(k.db, k.person, 'Fahrzeug angelegt', d.name);
    return { id };
  });
  app.put<{ Params: { id: string } }>('/api/dispo/fahrzeuge/:id', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const d = FahrzeugDaten.parse(req.body);
    const id = await fahrzeugSpeichern(k.db, { ...d, id: Number(req.params.id) });
    await protokollieren(k.db, k.person, 'Fahrzeug geändert', d.name, d);
    return { id };
  });

  app.get('/api/dispo/fahrer', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const b = await k.db.selectFrom('benutzer').select(['id', 'name', 'rollen']).where('aktiv', '=', 1).orderBy('name').execute();
    return b.filter((x) => (JSON.parse(x.rollen) as string[]).includes('fahrer')).map((x) => ({ id: x.id, name: x.name }));
  });

  app.get('/api/dispo/touren', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const { datum } = z.object({ datum: DATUM.default(heuteBerlin()) }).parse(req.query);
    return tourenAmTag(k.db, datum);
  });

  app.post('/api/dispo/touren', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const d = z.object({ datum: DATUM, fahrzeugId: z.number().int().nullable().default(null), fahrerId: z.number().int().nullable().default(null), bemerkung: z.string().trim().max(500).default('') }).parse(req.body);
    return { id: await tourAnlegen(k.db, d, k.person) };
  });

  app.put<{ Params: { id: string } }>('/api/dispo/touren/:id', async (req) => {
    const k = kontext(req, DISPO_ROLLEN);
    const d = z
      .object({
        fahrzeugId: z.number().int().nullable().default(null),
        fahrerId: z.number().int().nullable().default(null),
        status: z.enum(TOUR_STATUS).default('geplant'),
        bemerkung: z.string().trim().max(500).default(''),
        stopps: z.array(z.number().int()).max(100),
      })
      .parse(req.body);
    return tourSpeichern(k.db, Number(req.params.id), d, k.person, k.sichtbar);
  });

  app.post<{ Params: { id: string } }>('/api/dispo/touren/:id/route', async (req) => {
    const k = kontext(req, FAHRER_ROLLEN);
    return tourRoute(k.db, Number(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/api/dispo/touren/:id/pdf', async (req, reply) => {
    const k = kontext(req, FAHRER_ROLLEN);
    const tour = await tourLesen(k.db, Number(req.params.id));
    const filialeId = tour.stopps[0]?.filiale.id ?? k.filiale?.id ?? k.filialen[0]?.id;
    if (!filialeId) throw new HttpFehler(400, 'Keine Filiale');
    const einstellungen = await einstellungenLesen(k.db);
    const filiale = (await filialenListe(k.db)).find((f) => f.id === filialeId)!;
    const logo = await k.db.selectFrom('einstellungen').select(['logo', 'logo_mime']).where('id', '=', 1).executeTakeFirst();
    const pdf = await tourPdf({ einstellungen, filiale, logo: logo?.logo && logo.logo_mime ? { daten: logo.logo, mime: logo.logo_mime } : null, tour });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="Tour-${tour.datum}-${tour.id}.pdf"`).send(pdf);
  });

  /** Fahrer: eigene Touren des Tages (Dispo/Admin: alle) */
  app.get('/api/dispo/meine', async (req) => {
    const k = kontext(req, FAHRER_ROLLEN);
    const { datum } = z.object({ datum: DATUM.default(heuteBerlin()) }).parse(req.query);
    const nurEigene = !DISPO_ROLLEN.some((r) => k.rollen.includes(r));
    return tourenAmTag(k.db, datum, nurEigene ? (k.benutzer?.id ?? -1) : undefined);
  });

  app.post<{ Params: { id: string } }>('/api/dispo/auftraege/:id/geliefert', async (req) => {
    const k = kontext(req, FAHRER_ROLLEN);
    await geliefert(k.db, Number(req.params.id), k.person, k.sichtbar);
    return { ok: true };
  });

  /** Verkauf: Lieferkosten-Vorschlag nach Entfernung von der Filiale */
  app.post('/api/dispo/entfernung', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const d = z.object({ strasse: z.string().trim().min(1, 'Straße fehlt'), plz: z.string().trim(), ort: z.string().trim().min(1, 'Ort fehlt') }).parse(req.body);
    if (!k.filiale) throw new HttpFehler(400, 'Bitte zuerst eine Filiale wählen.');
    const e = await einstellungenLesen(k.db);
    const r = await entfernung(k.db, k.filiale.id, `${d.strasse}, ${d.plz} ${d.ort}`);
    return { ...r, vorschlagCent: lieferkostenVorschlag(r.km, e.lieferkosten) };
  });
}
