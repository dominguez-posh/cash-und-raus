// Anmeldung der Mitarbeiter per SAML2 (je Mandant ein IdP, z. B. eine Entra-Unternehmensanwendung).
// Nur vom Dienst ausgelöste Anmeldungen (InResponseTo wird geprüft); die Assertion muss signiert sein.
import { X509Certificate } from 'node:crypto';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SamlKonfig, SamlSpDaten } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { MANDANT_ID_MUSTER, mandantDb, plattformDb } from '../db/index.ts';
import { clientIp } from '../ip.ts';
import { benutzerListe, plattformProtokollieren, protokollieren } from '../mandant.ts';
import { anmelden, HttpFehler, plattform } from '../sitzung.ts';

const CLAIM = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  upn: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  anzeigename: 'http://schemas.microsoft.com/identity/claims/displayname',
  vorname: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  nachname: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  oid: 'http://schemas.microsoft.com/identity/claims/objectidentifier',
};

export function spDaten(mandantId: string): SamlSpDaten {
  const basis = `${config.publicUrl}/saml/${mandantId}`;
  return { entityId: basis, acsUrl: `${basis}/acs`, metadatenUrl: `${basis}/metadata` };
}

export async function samlKonfigLesen(mandantId: string): Promise<SamlKonfig | null> {
  const z = await plattformDb().selectFrom('mandant_saml').selectAll().where('mandant_id', '=', mandantId).executeTakeFirst();
  if (!z) return null;
  return {
    idpEntityId: z.idp_entity_id,
    idpSsoUrl: z.idp_sso_url,
    idpZertifikate: JSON.parse(z.idp_zertifikate) as string[],
    emailDomaenen: JSON.parse(z.email_domaenen) as string[],
    aktiv: z.aktiv === 1,
  };
}

/** Zertifikat als reines Base64 (ohne PEM-Kopf, ohne Umbrüche). */
export function zertifikatNormalisieren(c: string): string {
  return c.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

/** Liest Entity-ID, SSO-Adresse (HTTP-Redirect) und Signaturzertifikate aus Federation-Metadaten. */
export function metadatenAuswerten(xml: string): Omit<SamlKonfig, 'emailDomaenen' | 'aktiv'> {
  const entity = /<(?:\w+:)?EntityDescriptor\b[^>]*\bentityID="([^"]+)"/.exec(xml)?.[1];
  const idp = /<(?:\w+:)?IDPSSODescriptor\b[\s\S]*?<\/(?:\w+:)?IDPSSODescriptor>/.exec(xml)?.[0];
  if (!entity || !idp) throw new HttpFehler(400, 'Keine IdP-Metadaten (EntityDescriptor/IDPSSODescriptor) gefunden.');
  const sso = [...idp.matchAll(/<(?:\w+:)?SingleSignOnService\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes('HTTP-Redirect'));
  const ssoUrl = sso && /\bLocation="([^"]+)"/.exec(sso)?.[1];
  if (!ssoUrl) throw new HttpFehler(400, 'Keine SSO-Adresse mit HTTP-Redirect-Bindung gefunden.');
  const zertifikate = new Set<string>();
  for (const kd of idp.matchAll(/<(?:\w+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?KeyDescriptor>/g)) {
    if (/use="encryption"/.test(kd[1]!)) continue;
    for (const c of kd[2]!.matchAll(/<(?:\w+:)?X509Certificate>([^<]+)<\/(?:\w+:)?X509Certificate>/g)) zertifikate.add(zertifikatNormalisieren(c[1]!));
  }
  if (!zertifikate.size) throw new HttpFehler(400, 'Kein Signaturzertifikat in den Metadaten gefunden.');
  return { idpEntityId: entity, idpSsoUrl: ssoUrl.replace(/&amp;/g, '&'), idpZertifikate: [...zertifikate] };
}

// Eine SAML-Instanz je Mandant und Konfiguration (sie hält die offenen Anfragen für InResponseTo).
const instanzen = new Map<string, { schluessel: string; saml: SAML }>();

function samlFuer(mandantId: string, k: SamlKonfig): SAML {
  const schluessel = JSON.stringify([k.idpEntityId, k.idpSsoUrl, k.idpZertifikate, config.publicUrl]);
  const vorhanden = instanzen.get(mandantId);
  if (vorhanden?.schluessel === schluessel) return vorhanden.saml;
  const sp = spDaten(mandantId);
  const saml = new SAML({
    issuer: sp.entityId,
    callbackUrl: sp.acsUrl,
    entryPoint: k.idpSsoUrl,
    idpIssuer: k.idpEntityId,
    idpCert: k.idpZertifikate,
    audience: sp.entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: 10 * 60_000,
    acceptedClockSkewMs: 2 * 60_000,
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    signatureAlgorithm: 'sha256',
  });
  instanzen.set(mandantId, { schluessel, saml });
  return saml;
}

async function aktiveKonfig(mandantId: string): Promise<SamlKonfig> {
  if (!MANDANT_ID_MUSTER.test(mandantId)) throw new HttpFehler(404, 'Unbekannt');
  const m = await plattformDb().selectFrom('mandant').select('aktiv').where('id', '=', mandantId).executeTakeFirst();
  const k = await samlKonfigLesen(mandantId);
  if (!m || m.aktiv !== 1 || !k?.aktiv) throw new HttpFehler(404, 'Für diesen Mandanten ist keine Firmenanmeldung aktiv.');
  return k;
}

const fehlerSeite = (msg: string) => `/?fehler=${encodeURIComponent(msg)}`;

export function samlRouten(app: FastifyInstance): void {
  // Login-Seite: Mandant über die Domäne der E-Mail-Adresse finden
  app.post('/api/auth/saml/finden', async (req) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().max(200) }).parse(req.body);
    const domaene = email.includes('@') ? email.split('@').pop()! : email;
    const zeilen = await plattformDb()
      .selectFrom('mandant_saml')
      .innerJoin('mandant', 'mandant.id', 'mandant_saml.mandant_id')
      .select(['mandant_saml.mandant_id', 'mandant_saml.email_domaenen'])
      .where('mandant_saml.aktiv', '=', 1)
      .where('mandant.aktiv', '=', 1)
      .execute();
    const treffer = zeilen.find((z) => (JSON.parse(z.email_domaenen) as string[]).map((d) => d.toLowerCase()).includes(domaene));
    if (!treffer) throw new HttpFehler(404, 'Für diese Adresse ist keine Firmenanmeldung eingerichtet.');
    const hint = email.includes('@') ? `?hint=${encodeURIComponent(email)}` : '';
    return { url: `/saml/${treffer.mandant_id}/login${hint}` };
  });

  app.get<{ Params: { id: string }; Querystring: { hint?: string } }>('/saml/:id/login', async (req, reply) => {
    try {
      const k = await aktiveKonfig(req.params.id);
      const hint = req.query.hint?.slice(0, 200);
      const url = await samlFuer(req.params.id, k).getAuthorizeUrlAsync('', {
        additionalParams: hint ? { login_hint: hint } : {},
      });
      return reply.redirect(url);
    } catch (e) {
      return reply.redirect(fehlerSeite((e as Error).message));
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/saml/:id/acs', async (req, reply) => {
    const mandantId = req.params.id;
    try {
      const k = await aktiveKonfig(mandantId);
      const { profile } = await samlFuer(mandantId, k).validatePostResponseAsync(req.body ?? {});
      if (!profile) throw new Error('Keine Anmeldedaten erhalten.');
      const attr = (n: string) => {
        const v = profile[n] ?? (profile.attributes as Record<string, unknown> | undefined)?.[n];
        return typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : '';
      };
      const kandidaten = [attr(CLAIM.email), profile.nameID ?? '', attr(CLAIM.upn)].map((s) => s.toLowerCase()).filter((s) => s.includes('@'));
      const oid = attr(CLAIM.oid) || null;
      const db = mandantDb(mandantId);
      const benutzer = (await benutzerListe(db)).find((b) => kandidaten.includes(b.email.toLowerCase()));
      if (!benutzer || !benutzer.aktiv) {
        await protokollieren(db, kandidaten[0] ?? 'unbekannt', 'Anmeldung abgelehnt', 'SAML', { grund: benutzer ? 'deaktiviert' : 'nicht angelegt', ip: clientIp(req) });
        throw new Error(`Kein Zugang für ${kandidaten[0] ?? 'dieses Konto'}. Bitte die Administration bitten, Sie anzulegen.`);
      }
      // Das Entra-Konto wird beim ersten Login fest an den Benutzer gebunden (Schutz gegen neu vergebene Adressen).
      const zeile = await db.selectFrom('benutzer').select('entra_oid').where('id', '=', benutzer.id).executeTakeFirstOrThrow();
      if (oid && zeile.entra_oid && zeile.entra_oid !== oid) {
        await protokollieren(db, benutzer.email, 'Anmeldung abgelehnt', 'SAML', { grund: 'anderes Entra-Konto', ip: clientIp(req) });
        throw new Error('Dieses Konto passt nicht zum hinterlegten Benutzer. Die Administration muss die Verknüpfung lösen.');
      }
      if (oid && !zeile.entra_oid) await db.updateTable('benutzer').set({ entra_oid: oid }).where('id', '=', benutzer.id).execute();

      const name = attr(CLAIM.anzeigename) || [attr(CLAIM.vorname), attr(CLAIM.nachname)].filter(Boolean).join(' ') || benutzer.name;
      await anmelden(req, reply, {
        art: 'saml',
        email: benutzer.email,
        name,
        plattformAdmin: false,
        mfaOffen: false,
        mandantId,
        benutzerId: benutzer.id,
      });
      return reply.redirect('/', 303);
    } catch (e) {
      req.log.warn({ mandantId, fehler: (e as Error).message }, 'SAML-Anmeldung fehlgeschlagen');
      return reply.redirect(fehlerSeite((e as Error).message), 303);
    }
  });

  app.get<{ Params: { id: string } }>('/saml/:id/metadata', async (req, reply) => {
    const id = req.params.id;
    if (!MANDANT_ID_MUSTER.test(id) || !(await plattformDb().selectFrom('mandant').select('id').where('id', '=', id).executeTakeFirst())) {
      throw new HttpFehler(404, 'Unbekannt');
    }
    const sp = spDaten(id);
    const xml = new SAML({ issuer: sp.entityId, callbackUrl: sp.acsUrl, idpCert: 'unbenutzt', audience: sp.entityId, identifierFormat: null }).generateServiceProviderMetadata(null);
    return reply.type('application/samlmetadata+xml').send(xml);
  });

  // ---------- Konfiguration (Plattform-Admin) ----------

  app.post('/api/plattform/saml/metadaten', async (req) => {
    plattform(req);
    const d = z.object({ xml: z.string().max(500_000).optional(), url: z.string().url().optional() }).parse(req.body);
    let xml = d.xml;
    if (!xml && d.url) {
      if (!d.url.startsWith('https://')) throw new HttpFehler(400, 'Nur https-Adressen.');
      const r = await fetch(d.url, { signal: AbortSignal.timeout(10_000), redirect: 'follow' });
      if (!r.ok) throw new HttpFehler(400, `Metadaten nicht abrufbar (HTTP ${r.status}).`);
      xml = (await r.text()).slice(0, 500_000);
    }
    if (!xml) throw new HttpFehler(400, 'XML oder Adresse angeben.');
    return metadatenAuswerten(xml);
  });

  app.put<{ Params: { id: string } }>('/api/plattform/mandanten/:id/saml', async (req) => {
    const k = plattform(req);
    const id = req.params.id;
    if (!(await plattformDb().selectFrom('mandant').select('id').where('id', '=', id).executeTakeFirst())) throw new HttpFehler(404, 'Mandant nicht gefunden');
    const d = z
      .object({
        idpEntityId: z.string().trim().min(1).max(500),
        idpSsoUrl: z.string().trim().url().startsWith('https://', 'SSO-Adresse muss mit https:// beginnen'),
        idpZertifikate: z.array(z.string()).min(1, 'Mindestens ein Zertifikat'),
        emailDomaenen: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Ungültige Domäne')),
        aktiv: z.boolean(),
      })
      .parse(req.body);
    const zertifikate = d.idpZertifikate.map(zertifikatNormalisieren).filter(Boolean);
    for (const c of zertifikate) {
      try {
        new X509Certificate(Buffer.from(c, 'base64'));
      } catch {
        throw new HttpFehler(400, 'Ein Zertifikat ist ungültig.');
      }
    }
    // Eine Domäne darf nur zu einem Mandanten gehören.
    const andere = await plattformDb().selectFrom('mandant_saml').select(['mandant_id', 'email_domaenen']).where('mandant_id', '!=', id).execute();
    for (const a of andere) {
      const doppelt = (JSON.parse(a.email_domaenen) as string[]).find((x) => d.emailDomaenen.includes(x.toLowerCase()));
      if (doppelt) throw new HttpFehler(409, `Domäne ${doppelt} ist bereits Mandant ${a.mandant_id} zugeordnet.`);
    }
    const werte = {
      idp_entity_id: d.idpEntityId,
      idp_sso_url: d.idpSsoUrl,
      idp_zertifikate: JSON.stringify(zertifikate),
      email_domaenen: JSON.stringify([...new Set(d.emailDomaenen)]),
      aktiv: d.aktiv ? 1 : 0,
    };
    await plattformDb()
      .insertInto('mandant_saml')
      .values({ mandant_id: id, ...werte })
      .onConflict((oc) => oc.column('mandant_id').doUpdateSet(werte))
      .execute();
    await plattformProtokollieren(k.sitzung.email, 'SAML-Konfiguration gespeichert', id, { idpEntityId: d.idpEntityId, domaenen: d.emailDomaenen, aktiv: d.aktiv });
    return { ok: true };
  });
}
