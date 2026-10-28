// Kasse: Tagesstand, Belege, Tagesabschluss, PDFs.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Rolle } from '../../../shared/types.ts';
import { ABSCHLUSS_ROLLEN, BELEG_ARTEN, KASSE_ROLLEN, MUENZEN, SCHEINE } from '../../../shared/kasse.ts';
import { abschliessen, abschlussLesen, abschluesseListe, belegAnlegen, belegLesen, belegStornieren, kassentag } from '../kasse.ts';
import { einstellungenLesen, filialenListe } from '../mandant.ts';
import { kassePdf } from '../pdf.ts';
import { HttpFehler, mitRolle } from '../sitzung.ts';
import { heuteBerlin } from '../verkauf.ts';

const DATUM = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');

function kontext(req: FastifyRequest, rollen: Rolle[]) {
  const k = mitRolle(req, ...rollen);
  const sichtbar = k.rollen.includes('admin') ? null : k.filialen.map((f) => f.id);
  return { ...k, sichtbar, person: k.sitzung.email };
}

/** Filiale aus der Abfrage oder die gewählte; muss sichtbar sein */
function filialeAus(k: ReturnType<typeof kontext>, gewuenscht?: number): number {
  const id = gewuenscht ?? k.filiale?.id;
  if (!id) throw new HttpFehler(400, 'Bitte zuerst eine Filiale wählen.');
  if (k.sichtbar && !k.sichtbar.includes(id)) throw new HttpFehler(403, 'Diese Filiale ist für Sie nicht freigegeben.');
  return id;
}

async function druck(k: ReturnType<typeof kontext>, filialeId: number) {
  const einstellungen = await einstellungenLesen(k.db);
  const filiale = (await filialenListe(k.db)).find((f) => f.id === filialeId)!;
  const logo = await k.db.selectFrom('einstellungen').select(['logo', 'logo_mime']).where('id', '=', 1).executeTakeFirst();
  return { einstellungen, filiale, logo: logo?.logo && logo.logo_mime ? { daten: logo.logo, mime: logo.logo_mime } : null };
}

export function kasseRouten(app: FastifyInstance): void {
  app.get('/api/kasse/tag', async (req) => {
    const k = kontext(req, KASSE_ROLLEN);
    const q = z.object({ datum: DATUM.default(heuteBerlin()), filiale: z.coerce.number().int().optional() }).parse(req.query);
    return kassentag(k.db, filialeAus(k, q.filiale), q.datum);
  });

  app.post('/api/kasse/belege', async (req) => {
    const k = kontext(req, KASSE_ROLLEN);
    const d = z
      .object({
        filiale: z.number().int().optional(),
        datum: DATUM.default(heuteBerlin()),
        art: z.enum(BELEG_ARTEN),
        grund: z.string().trim().min(1, 'Grund fehlt').max(60),
        text: z.string().trim().max(500).default(''),
        betragCent: z.number().int().positive('Betrag muss größer 0 sein').max(100_000_000),
      })
      .parse(req.body);
    if (d.datum > heuteBerlin()) throw new HttpFehler(400, 'Belege nicht in der Zukunft.');
    return belegAnlegen(k.db, { ...d, filialeId: filialeAus(k, d.filiale), person: k.person });
  });

  app.post<{ Params: { id: string } }>('/api/kasse/belege/:id/storno', async (req) => {
    const k = kontext(req, KASSE_ROLLEN);
    const { grund } = z.object({ grund: z.string().trim().min(3, 'Bitte einen Grund angeben').max(200) }).parse(req.body);
    return belegStornieren(k.db, Number(req.params.id), grund, k.person, k.sichtbar);
  });

  app.get<{ Params: { id: string } }>('/api/kasse/belege/:id/pdf', async (req, reply) => {
    const k = kontext(req, KASSE_ROLLEN);
    const { beleg, filiale } = await belegLesen(k.db, Number(req.params.id), k.sichtbar);
    const pdf = await kassePdf('beleg', { ...(await druck(k, filiale.id)), beleg });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="Beleg-${beleg.nummer}.pdf"`).send(pdf);
  });

  app.post('/api/kasse/abschluss', async (req) => {
    const k = kontext(req, ABSCHLUSS_ROLLEN);
    const erlaubt = new Set<string>([...SCHEINE, ...MUENZEN].map(String));
    const d = z
      .object({
        filiale: z.number().int().optional(),
        datum: DATUM,
        zaehlung: z.record(z.string(), z.number().int().min(0).max(100_000)).refine((zl) => Object.keys(zl).every((w) => erlaubt.has(w)), 'Unbekannte Stückelung'),
        zBonNr: z.string().trim().max(40).default(''),
        zBarCent: z.number().int().min(0).nullable().default(null),
        bemerkung: z.string().trim().max(1000).default(''),
        uebergebenVon: z.string().trim().max(100).default(''),
        uebernommenVon: z.string().trim().max(100).default(''),
      })
      .parse(req.body);
    return abschliessen(k.db, { ...d, filialeId: filialeAus(k, d.filiale), person: k.person });
  });

  app.get('/api/kasse/abschluesse', async (req) => {
    const k = kontext(req, KASSE_ROLLEN);
    const q = z.object({ filiale: z.coerce.number().int().optional() }).parse(req.query);
    return abschluesseListe(k.db, k.sichtbar, q.filiale);
  });

  app.get<{ Params: { id: string } }>('/api/kasse/abschluesse/:id/pdf', async (req, reply) => {
    const k = kontext(req, KASSE_ROLLEN);
    const abschluss = await abschlussLesen(k.db, Number(req.params.id), k.sichtbar);
    const tag = await kassentag(k.db, abschluss.filiale.id, abschluss.datum);
    const pdf = await kassePdf('abschluss', { ...(await druck(k, abschluss.filiale.id)), abschluss, tag });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="Kasse-${abschluss.filiale.kuerzel}-${abschluss.datum}.pdf"`).send(pdf);
  });
}
