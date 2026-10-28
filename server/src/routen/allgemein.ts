import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthInfo } from '../../../shared/types.ts';
import { einrichtungOffen } from '../auth/lokal.ts';
import { config } from '../config.ts';
import { logoLesen, protokollieren } from '../mandant.ts';
import { abmelden, HttpFehler, ichAus, imMandant, mitSitzung, sitzungAendern } from '../sitzung.ts';

export function allgemeineRouten(app: FastifyInstance): void {
  app.get('/api/auth/info', async (): Promise<AuthInfo> => ({ produktName: config.produktName, einrichtung: await einrichtungOffen() }));

  app.post('/api/auth/abmelden', async (req, reply) => {
    await abmelden(req, reply);
    return { ok: true };
  });

  app.get('/api/ich', async (req) => ichAus(mitSitzung(req)));

  app.post('/api/ich/filiale', async (req) => {
    const k = imMandant(req);
    const { filialeId } = z.object({ filialeId: z.number().int() }).parse(req.body);
    const f = k.filialen.find((x) => x.id === filialeId);
    if (!f) throw new HttpFehler(403, 'Diese Filiale ist für Sie nicht freigegeben.');
    await sitzungAendern(k.sitzung.id, { filiale_id: f.id, filiale_per_ip: 0 });
    await protokollieren(k.db, k.sitzung.email, 'Filiale gewählt', f.kuerzel);
    return { ok: true };
  });

  app.get('/api/mandant/logo', async (req, reply) => {
    const k = imMandant(req);
    const logo = await logoLesen(k.db);
    if (!logo) throw new HttpFehler(404, 'Kein Logo');
    return reply.type(logo.mime).header('cache-control', 'private, max-age=300').send(logo.logo);
  });
}
