// Plattform-Administration: Mandanten anlegen, SAML anbinden, Mandanten betreuen.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Mandant } from '../../../shared/types.ts';
import { samlKonfigLesen, spDaten } from '../auth/saml.ts';
import { MANDANT_ID_MUSTER, mandantDb, plattformDb } from '../db/index.ts';
import { mandantAnlegen, plattformProtokollieren, protokollieren } from '../mandant.ts';
import { HttpFehler, plattform, sitzungAendern } from '../sitzung.ts';

async function mandantLesen(id: string): Promise<Mandant | undefined> {
  const m = await plattformDb().selectFrom('mandant').selectAll().where('id', '=', id).executeTakeFirst();
  if (!m) return undefined;
  return { id: m.id, name: m.name, aktiv: m.aktiv === 1, erstelltAm: m.erstellt_am, saml: await samlKonfigLesen(m.id), sp: spDaten(m.id) };
}

export function plattformRouten(app: FastifyInstance): void {
  app.get('/api/plattform/mandanten', async (req) => {
    plattform(req);
    const ids = await plattformDb().selectFrom('mandant').select('id').orderBy('name').execute();
    return Promise.all(ids.map(async ({ id }) => (await mandantLesen(id))!));
  });

  app.post('/api/plattform/mandanten', async (req) => {
    const k = plattform(req);
    const d = z
      .object({
        id: z.string().trim().toLowerCase().regex(MANDANT_ID_MUSTER, 'Kennung: 2–40 Zeichen, Kleinbuchstaben, Ziffern, Bindestrich'),
        name: z.string().trim().min(1).max(200),
        admin: z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(200) }).nullable(),
      })
      .parse(req.body);
    if (await mandantLesen(d.id)) throw new HttpFehler(409, 'Kennung bereits vergeben');
    await mandantAnlegen({ ...d, person: k.sitzung.email });
    return mandantLesen(d.id);
  });

  app.put<{ Params: { id: string } }>('/api/plattform/mandanten/:id', async (req) => {
    const k = plattform(req);
    const d = z.object({ name: z.string().trim().min(1).max(200), aktiv: z.boolean() }).parse(req.body);
    const r = await plattformDb().updateTable('mandant').set({ name: d.name, aktiv: d.aktiv ? 1 : 0 }).where('id', '=', req.params.id).executeTakeFirst();
    if (!r.numUpdatedRows) throw new HttpFehler(404, 'Mandant nicht gefunden');
    await plattformProtokollieren(k.sitzung.email, 'Mandant geändert', req.params.id, d);
    return { ok: true };
  });

  // Plattform-Admin arbeitet im Mandanten mit Admin-Rechten (Betreuung); wird dort protokolliert.
  app.post<{ Params: { id: string } }>('/api/plattform/mandanten/:id/betreten', async (req) => {
    const k = plattform(req);
    const m = await mandantLesen(req.params.id);
    if (!m) throw new HttpFehler(404, 'Mandant nicht gefunden');
    await sitzungAendern(k.sitzung.id, { mandant_id: m.id, benutzer_id: null, filiale_id: null, filiale_per_ip: 0 });
    await protokollieren(mandantDb(m.id), k.sitzung.email, 'Betreuung begonnen', 'Plattform-Admin');
    await plattformProtokollieren(k.sitzung.email, 'Mandant betreten', m.id);
    return { ok: true };
  });

  app.post('/api/plattform/verlassen', async (req) => {
    const k = plattform(req);
    await sitzungAendern(k.sitzung.id, { mandant_id: null, benutzer_id: null, filiale_id: null, filiale_per_ip: 0 });
    return { ok: true };
  });

  app.get('/api/plattform/protokoll', async (req) => {
    plattform(req);
    return plattformDb().selectFrom('plattform_protokoll').selectAll().orderBy('id', 'desc').limit(200).execute();
  });
}
