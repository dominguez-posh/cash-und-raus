import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appBauen } from './app.ts';
import { startAdminAnlegen } from './auth/lokal.ts';
import { config } from './config.ts';
import { alleSchliessen, plattformDb } from './db/index.ts';

// In der Entwicklung baut der Server die Web-App selbst und beobachtet Änderungen.
if (!config.produktion) {
  const build = await import(pathToFileURL(path.resolve('build.mjs')).href);
  await build.webBeobachten();
}

const app = await appBauen();
plattformDb(); // legt die Plattform-DB an bzw. migriert sie
await startAdminAnlegen((msg) => app.log.info(msg));

await app.listen({ port: config.port, host: config.host });
app.log.info(`Cash & Raus läuft auf ${config.publicUrl} (Daten: ${config.datenVerzeichnis})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await alleSchliessen();
    process.exit(0);
  });
}
