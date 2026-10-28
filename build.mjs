// Build der Web-App (dist/public) und des Server-Bundles (dist/server.mjs).
//   node build.mjs          einmaliger Produktions-Build
//   webBeobachten()         Entwicklung: wird vom Server (npm run dev) aufgerufen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const wurzel = path.dirname(fileURLToPath(import.meta.url));
const ziel = path.join(wurzel, 'dist');
const web = path.join(ziel, 'public');

function statischKopieren() {
  fs.mkdirSync(web, { recursive: true });
  fs.cpSync(path.join(wurzel, 'public'), web, { recursive: true });
  fs.copyFileSync(path.join(wurzel, 'node_modules/leaflet/dist/leaflet.css'), path.join(web, 'leaflet.css'));
}

const webOptionen = (produktion) => ({
  entryPoints: [path.join(wurzel, 'src/main.tsx')],
  bundle: true,
  outfile: path.join(web, 'app.js'),
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: produktion,
  sourcemap: produktion ? false : 'inline',
  define: { 'process.env.NODE_ENV': JSON.stringify(produktion ? 'production' : 'development') },
  logLevel: 'info',
});

export async function webBeobachten() {
  statischKopieren();
  const ctx = await esbuild.context({
    ...webOptionen(false),
    plugins: [{ name: 'statisch', setup: (b) => b.onEnd(() => statischKopieren()) }],
  });
  await ctx.watch();
}

async function alles() {
  fs.rmSync(ziel, { recursive: true, force: true });
  statischKopieren();
  await esbuild.build(webOptionen(true));
  await esbuild.build({
    entryPoints: [path.join(wurzel, 'server/src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    outfile: path.join(ziel, 'server.mjs'),
    packages: 'external',
    logLevel: 'info',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await alles();
}
