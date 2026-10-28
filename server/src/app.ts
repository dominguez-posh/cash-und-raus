import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { lokaleRouten } from './auth/lokal.ts';
import { samlRouten } from './auth/saml.ts';
import { config } from './config.ts';
import { adminRouten } from './routen/admin.ts';
import { allgemeineRouten } from './routen/allgemein.ts';
import { kasseRouten } from './routen/kasse.ts';
import { plattformRouten } from './routen/plattform.ts';
import { verkaufRouten } from './routen/verkauf.ts';
import { HttpFehler, kontextLaden } from './sitzung.ts';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export async function appBauen(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 2_000_000, trustProxy: false });

  await app.register(cookie);
  await app.register(formbody); // SAML-ACS (application/x-www-form-urlencoded)

  app.decorateRequest('kontext', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    if (config.hinterTlsProxy) reply.header('strict-transport-security', 'max-age=31536000');

    // CSRF: Änderungen über die API nur mit eigenem Kopf (erzwingt CORS-Preflight bei fremden Seiten).
    if (req.url.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-cr-anfrage'] !== '1') {
      throw new HttpFehler(403, 'Anfrage ohne Kennung abgelehnt');
    }
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
      req.kontext = await kontextLaden(req);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpFehler) return reply.status(err.status).send({ fehler: err.message });
    if (err instanceof ZodError) {
      const erstes = err.issues[0];
      return reply.status(400).send({ fehler: erstes ? `${erstes.path.join('.') || 'Eingabe'}: ${erstes.message}` : 'Ungültige Eingabe' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ fehler: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ fehler: 'Interner Fehler' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  allgemeineRouten(app);
  lokaleRouten(app);
  samlRouten(app);
  adminRouten(app);
  plattformRouten(app);
  verkaufRouten(app);
  kasseRouten(app);

  if (fs.existsSync(config.webVerzeichnis)) {
    await app.register(fastifyStatic, { root: config.webVerzeichnis, index: false, wildcard: false });
    const index = path.join(config.webVerzeichnis, 'index.html');
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/saml/')) {
        return reply.status(404).send({ fehler: 'Nicht gefunden' });
      }
      // Single-Page-App: alle übrigen Pfade liefern index.html
      return reply.type('text/html').header('cache-control', 'no-cache').send(fs.readFileSync(index));
    });
  }

  return app;
}
