// Mandanten-Administration: Firmendaten, Logo, Filialen, Benutzer, Protokoll.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLLEN } from '../../../shared/types.ts';
import { bereichPruefen, clientIp } from '../ip.ts';
import {
  benutzerListe,
  benutzerSpeichern,
  einstellungenLesen,
  einstellungenSpeichern,
  filialenListe,
  filialeSpeichern,
  logoSetzen,
  protokollieren,
  protokollListe,
} from '../mandant.ts';
import { HttpFehler, mitRolle } from '../sitzung.ts';

const text = (max = 200) => z.string().trim().max(max);

const EinstellungenDaten = z.object({
  firmenname: text().min(1, 'Firmenname fehlt'),
  strasse: text(),
  plz: text(10),
  ort: text(),
  telefon: text(50),
  email: text(),
  web: text(),
  steuernummer: text(50),
  ustId: text(20),
  bankName: text(),
  iban: text(40),
  bic: text(15),
  fusstext: text(1000),
  ustSatz: z.number().min(0).max(100),
  ustSaetze: z.array(z.number().min(0).max(100)).min(1).max(5),
  nummernformat: text(40).refine((s) => s.includes('{N}'), 'Das Nummernformat muss {N} enthalten'),
  rabattarten: z
    .array(z.object({ kuerzel: text(10).min(1, 'Rabatt-Kürzel fehlt'), name: text(60).min(1, 'Rabatt-Name fehlt'), prozent: z.number().gt(0).max(100) }))
    .max(20),
  lieferzeiten: z.array(text(40).min(1)).max(20),
  hinweise: z.array(z.object({ zeichen: z.string().trim().regex(/^\*{1,3}$/, 'Kennzeichen: *, ** oder ***'), text: text(500).min(1) })).max(3),
}).refine((e) => e.ustSaetze.includes(e.ustSatz), { message: 'Der Standardsatz muss unter den wählbaren USt-Sätzen sein', path: ['ustSatz'] });

const FilialDaten = z.object({
  kuerzel: z.string().trim().regex(/^[A-Za-z0-9]{1,5}$/, 'Kürzel: 1–5 Buchstaben oder Ziffern'),
  name: text().min(1, 'Name fehlt'),
  strasse: text(),
  plz: text(10),
  ort: text(),
  telefon: text(50),
  fax: text(50),
  email: text(),
  ipBereiche: z.array(z.string().trim()).max(50),
  aktiv: z.boolean(),
});

const BenutzerDaten = z.object({
  email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse'),
  name: text().min(1, 'Name fehlt'),
  rollen: z.array(z.enum(ROLLEN)).min(1, 'Mindestens eine Rolle'),
  alleFilialen: z.boolean(),
  filialIds: z.array(z.number().int()),
  aktiv: z.boolean(),
});

const LOGO_MIME = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export function adminRouten(app: FastifyInstance): void {
  app.get('/api/admin/einstellungen', async (req) => einstellungenLesen(mitRolle(req, 'admin').db));

  app.put('/api/admin/einstellungen', async (req) => {
    const k = mitRolle(req, 'admin');
    const d = EinstellungenDaten.parse(req.body);
    await einstellungenSpeichern(k.db, d);
    await protokollieren(k.db, k.sitzung.email, 'Firmendaten geändert', 'Einstellungen', d);
    return { ok: true };
  });

  app.put('/api/admin/logo', async (req) => {
    const k = mitRolle(req, 'admin');
    const { dataUrl } = z.object({ dataUrl: z.string().max(1_500_000).nullable() }).parse(req.body);
    if (dataUrl === null) {
      await logoSetzen(k.db, null, null);
      await protokollieren(k.db, k.sitzung.email, 'Logo entfernt', 'Einstellungen');
      return { ok: true };
    }
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl);
    if (!m || !LOGO_MIME.includes(m[1]!)) throw new HttpFehler(400, 'Logo: PNG, JPEG, SVG oder WebP');
    const daten = Buffer.from(m[2]!, 'base64');
    if (daten.length > 1_000_000) throw new HttpFehler(400, 'Logo: höchstens 1 MB');
    if (m[1] === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(daten.toString('utf8'))) {
      throw new HttpFehler(400, 'SVG mit Skripten ist nicht erlaubt');
    }
    await logoSetzen(k.db, daten, m[1]!);
    await protokollieren(k.db, k.sitzung.email, 'Logo geändert', 'Einstellungen', { mime: m[1], bytes: daten.length });
    return { ok: true };
  });

  // ---------- Filialen ----------

  app.get('/api/admin/filialen', async (req) => filialenListe(mitRolle(req, 'admin').db));

  app.get('/api/admin/meine-ip', async (req) => {
    mitRolle(req, 'admin');
    return { ip: clientIp(req) };
  });

  async function filialeSichern(req: Parameters<typeof mitRolle>[0], id?: number) {
    const k = mitRolle(req, 'admin');
    const d = FilialDaten.parse(req.body);
    d.kuerzel = d.kuerzel.toUpperCase();
    d.ipBereiche = d.ipBereiche.filter(Boolean);
    for (const b of d.ipBereiche) {
      const problem = bereichPruefen(b);
      if (problem) throw new HttpFehler(400, problem);
    }
    const alle = await filialenListe(k.db);
    if (id && !alle.some((f) => f.id === id)) throw new HttpFehler(404, 'Filiale nicht gefunden');
    if (alle.some((f) => f.id !== id && f.kuerzel.toUpperCase() === d.kuerzel)) throw new HttpFehler(409, `Kürzel ${d.kuerzel} ist bereits vergeben`);
    const neueId = await filialeSpeichern(k.db, { ...d, id });
    await protokollieren(k.db, k.sitzung.email, id ? 'Filiale geändert' : 'Filiale angelegt', d.kuerzel, d);
    return { id: neueId };
  }

  app.post('/api/admin/filialen', async (req) => filialeSichern(req));
  app.put<{ Params: { id: string } }>('/api/admin/filialen/:id', async (req) => filialeSichern(req, Number(req.params.id)));

  // ---------- Benutzer ----------

  app.get('/api/admin/benutzer', async (req) => benutzerListe(mitRolle(req, 'admin').db));

  async function benutzerSichern(req: Parameters<typeof mitRolle>[0], id?: number) {
    const k = mitRolle(req, 'admin');
    const d = BenutzerDaten.parse(req.body);
    const alle = await benutzerListe(k.db);
    if (id && !alle.some((b) => b.id === id)) throw new HttpFehler(404, 'Benutzer nicht gefunden');
    if (alle.some((b) => b.id !== id && b.email.toLowerCase() === d.email)) throw new HttpFehler(409, 'E-Mail-Adresse bereits vorhanden');
    const filialen = await filialenListe(k.db);
    if (d.filialIds.some((f) => !filialen.some((x) => x.id === f))) throw new HttpFehler(400, 'Unbekannte Filiale');
    if (!d.alleFilialen && !d.filialIds.length) throw new HttpFehler(400, 'Mindestens eine Filiale oder „alle Filialen“');
    // Sich selbst nicht aussperren
    if (id && id === k.benutzer?.id && (!d.aktiv || !d.rollen.includes('admin'))) {
      throw new HttpFehler(400, 'Sie können sich nicht selbst deaktivieren oder die Admin-Rolle entziehen.');
    }
    const neueId = await benutzerSpeichern(k.db, { ...d, id });
    await protokollieren(k.db, k.sitzung.email, id ? 'Benutzer geändert' : 'Benutzer angelegt', d.email, d);
    return { id: neueId };
  }

  app.post('/api/admin/benutzer', async (req) => benutzerSichern(req));
  app.put<{ Params: { id: string } }>('/api/admin/benutzer/:id', async (req) => benutzerSichern(req, Number(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/admin/benutzer/:id/entra-loesen', async (req) => {
    const k = mitRolle(req, 'admin');
    const id = Number(req.params.id);
    const r = await k.db.updateTable('benutzer').set({ entra_oid: null }).where('id', '=', id).executeTakeFirst();
    if (!r.numUpdatedRows) throw new HttpFehler(404, 'Benutzer nicht gefunden');
    await protokollieren(k.db, k.sitzung.email, 'Entra-Verknüpfung gelöst', `Benutzer ${id}`);
    return { ok: true };
  });

  app.get('/api/admin/protokoll', async (req) => protokollListe(mitRolle(req, 'admin').db));
}
