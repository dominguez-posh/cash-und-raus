// Verkauf: Entwürfe, Festschreiben, Zahlungen, Storno, Suche, PDFs.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Rolle } from '../../../shared/types.ts';
import { LESE_ROLLEN, STORNO_ROLLEN, VERKAUF_ROLLEN, type VerkaufVorgaben, ZAHLMITTEL } from '../../../shared/verkauf.ts';
import { einstellungenLesen, protokollieren } from '../mandant.ts';
import { PDF_ARTEN, type PdfArt } from '../pdf.ts';
import { HttpFehler, mitRolle } from '../sitzung.ts';
import {
  entwurfLoeschen,
  entwurfSpeichern,
  festschreiben,
  kundenVorschlaege,
  pdfLesen,
  stornieren,
  VorgangDatenSchema,
  vorgangLesen,
  vorgangSuchen,
  zahlungErfassen,
} from '../verkauf.ts';

/** Admins sehen alle Filialen, sonst nur die freigegebenen. */
function kontext(req: FastifyRequest, rollen: Rolle[]) {
  const k = mitRolle(req, ...rollen);
  const sichtbar = k.rollen.includes('admin') ? null : k.filialen.map((f) => f.id);
  return { ...k, sichtbar, person: k.sitzung.email, name: k.sitzung.name };
}

const idAus = (req: FastifyRequest) => {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpFehler(404, 'Vorgang nicht gefunden');
  return id;
};

export function verkaufRouten(app: FastifyInstance): void {
  app.get('/api/verkauf/vorgaben', async (req): Promise<VerkaufVorgaben> => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const e = await einstellungenLesen(k.db);
    return {
      ustSatz: e.ustSatz,
      ustSaetze: e.ustSaetze,
      rabattarten: e.rabattarten,
      lieferzeiten: e.lieferzeiten,
      hinweise: e.hinweise,
      orte: k.filialen.map((f) => `Filiale ${f.name}`),
    };
  });

  app.get('/api/vorgaenge', async (req) => {
    const k = kontext(req, LESE_ROLLEN);
    const { q, filiale } = z.object({ q: z.string().max(100).default(''), filiale: z.coerce.number().int().optional() }).parse(req.query);
    return vorgangSuchen(k.db, k.sichtbar, q, filiale);
  });

  app.get('/api/kunden', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const { q } = z.object({ q: z.string().max(100).default('') }).parse(req.query);
    return kundenVorschlaege(k.db, k.sichtbar, q);
  });

  app.get<{ Params: { id: string } }>('/api/vorgaenge/:id', async (req) => {
    const k = kontext(req, LESE_ROLLEN);
    return vorgangLesen(k.db, idAus(req), k.sichtbar);
  });

  app.post('/api/vorgaenge', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    if (!k.filiale) throw new HttpFehler(400, 'Bitte zuerst eine Filiale wählen.');
    const d = VorgangDatenSchema.parse(req.body);
    const id = await entwurfSpeichern(k.db, d, { filialeId: k.filiale.id, person: k.person, name: k.name, sichtbar: k.sichtbar });
    await protokollieren(k.db, k.person, 'Entwurf angelegt', `Vorgang ${id}`);
    return { id };
  });

  app.put<{ Params: { id: string } }>('/api/vorgaenge/:id', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const d = VorgangDatenSchema.parse(req.body);
    const id = await entwurfSpeichern(k.db, d, { id: idAus(req), filialeId: 0, person: k.person, name: k.name, sichtbar: k.sichtbar });
    return { id };
  });

  app.delete<{ Params: { id: string } }>('/api/vorgaenge/:id', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const id = idAus(req);
    await entwurfLoeschen(k.db, id, k.sichtbar);
    await protokollieren(k.db, k.person, 'Entwurf gelöscht', `Vorgang ${id}`);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/vorgaenge/:id/festschreiben', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    return festschreiben(k.db, idAus(req), k);
  });

  app.post<{ Params: { id: string } }>('/api/vorgaenge/:id/zahlungen', async (req) => {
    const k = kontext(req, VERKAUF_ROLLEN);
    const d = z
      .object({ betragCent: z.number().int().positive(), mittel: z.enum(ZAHLMITTEL), kassenBon: z.string().trim().max(40).default('') })
      .parse(req.body);
    const zahlungId = await zahlungErfassen(k.db, idAus(req), d, k);
    return { zahlungId };
  });

  app.post<{ Params: { id: string } }>('/api/vorgaenge/:id/storno', async (req) => {
    const k = kontext(req, STORNO_ROLLEN);
    const d = z.object({ grund: z.string().trim().min(3, 'Bitte einen Grund angeben').max(500), mittel: z.enum(ZAHLMITTEL) }).parse(req.body);
    const id = await stornieren(k.db, idAus(req), d, k);
    return { id };
  });

  app.get<{ Params: { id: string; art: string }; Querystring: { zahlung?: string } }>('/api/vorgaenge/:id/pdf/:art', async (req, reply) => {
    const k = kontext(req, LESE_ROLLEN);
    const art = req.params.art as PdfArt;
    if (!PDF_ARTEN.includes(art)) throw new HttpFehler(404, 'Unbekanntes Dokument');
    const { pdf, name } = await pdfLesen(k.db, idAus(req), art, k.sichtbar, req.query.zahlung ? Number(req.query.zahlung) : undefined);
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${name.replace(/[^\w.-]/g, '_')}.pdf"`)
      .send(pdf);
  });
}
