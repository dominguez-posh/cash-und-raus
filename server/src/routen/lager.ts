// Artikel, Lagerorte, Bestand, Lagerbuchungen.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LAGER_ROLLEN } from '../../../shared/lager.ts';
import { LESE_ROLLEN } from '../../../shared/verkauf.ts';
import { artikelListe, artikelSpeichern, bestandListe, buchen, buchungenListe, lagerorteListe, lagerortSpeichern } from '../lager.ts';
import { einstellungenLesen, protokollieren } from '../mandant.ts';
import { HttpFehler, mitRolle } from '../sitzung.ts';

const ArtikelDaten = z.object({
  nummer: z.string().trim().max(40).default(''),
  bezeichnung: z.string().trim().min(1, 'Bezeichnung fehlt').max(200),
  preisCent: z.number().int().min(0).max(100_000_000),
  ust: z.number().min(0).max(100),
  lagerortId: z.number().int().nullable().default(null),
  aktiv: z.boolean().default(true),
});

const LagerortDaten = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  filialeId: z.number().int().nullable().default(null),
  aktiv: z.boolean().default(true),
});

export function lagerRouten(app: FastifyInstance): void {
  // Artikel suchen (Verkauf: Vorschläge im Artikelfeld)
  app.get('/api/artikel', async (req) => {
    const k = mitRolle(req, ...LESE_ROLLEN);
    const { q, alle } = z.object({ q: z.string().max(100).default(''), alle: z.coerce.boolean().default(false) }).parse(req.query);
    return artikelListe(k.db, q, !(alle && k.rollen.includes('admin')), alle ? 2000 : 20);
  });

  app.post('/api/artikel', async (req) => {
    const k = mitRolle(req, 'admin');
    const d = ArtikelDaten.parse(req.body);
    const e = await einstellungenLesen(k.db);
    if (!e.ustSaetze.includes(d.ust)) throw new HttpFehler(400, `USt-Satz ${d.ust} % ist nicht freigegeben`);
    const id = await artikelSpeichern(k.db, d);
    await protokollieren(k.db, k.sitzung.email, 'Artikel angelegt', d.bezeichnung, d);
    return { id };
  });

  app.put<{ Params: { id: string } }>('/api/artikel/:id', async (req) => {
    const k = mitRolle(req, 'admin');
    const d = ArtikelDaten.parse(req.body);
    const e = await einstellungenLesen(k.db);
    if (!e.ustSaetze.includes(d.ust)) throw new HttpFehler(400, `USt-Satz ${d.ust} % ist nicht freigegeben`);
    const id = await artikelSpeichern(k.db, { ...d, id: Number(req.params.id) });
    await protokollieren(k.db, k.sitzung.email, 'Artikel geändert', d.bezeichnung, d);
    return { id };
  });

  app.get('/api/lagerorte', async (req) => lagerorteListe(mitRolle(req, ...LESE_ROLLEN).db));

  app.post('/api/lagerorte', async (req) => {
    const k = mitRolle(req, 'admin');
    const d = LagerortDaten.parse(req.body);
    const id = await lagerortSpeichern(k.db, d);
    await protokollieren(k.db, k.sitzung.email, 'Lagerort angelegt', d.name);
    return { id };
  });

  app.put<{ Params: { id: string } }>('/api/lagerorte/:id', async (req) => {
    const k = mitRolle(req, 'admin');
    const d = LagerortDaten.parse(req.body);
    const id = await lagerortSpeichern(k.db, { ...d, id: Number(req.params.id) });
    await protokollieren(k.db, k.sitzung.email, 'Lagerort geändert', d.name, d);
    return { id };
  });

  app.get('/api/lager/bestand', async (req) => {
    const k = mitRolle(req, ...LESE_ROLLEN);
    const { q } = z.object({ q: z.string().max(100).default('') }).parse(req.query);
    return bestandListe(k.db, q);
  });

  app.get('/api/lager/buchungen', async (req) => {
    const k = mitRolle(req, ...LAGER_ROLLEN);
    const { artikel } = z.object({ artikel: z.coerce.number().int().optional() }).parse(req.query);
    return buchungenListe(k.db, 200, artikel);
  });

  app.post('/api/lager/buchen', async (req) => {
    const k = mitRolle(req, ...LAGER_ROLLEN);
    const d = z
      .object({
        art: z.enum(['wareneingang', 'umlagerung', 'inventur', 'korrektur']),
        artikelId: z.number().int(),
        lagerortId: z.number().int(),
        menge: z.number().min(-100_000).max(100_000),
        zielLagerortId: z.number().int().nullable().optional(),
        text: z.string().trim().max(200).default(''),
      })
      .parse(req.body);
    return buchen(k.db, d, k.sitzung.email);
  });
}
