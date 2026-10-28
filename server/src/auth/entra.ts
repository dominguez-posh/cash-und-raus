// Automatische SAML-Einrichtung in Microsoft Entra ID: Ein Admin des Mandanten meldet sich bei Microsoft an,
// danach legt der Server über Microsoft Graph die Unternehmensanwendung an (SAML, Entity-ID, ACS, Signaturzertifikat),
// liest Domänen und Zertifikat aus und aktiviert die Firmenanmeldung.
// Voraussetzung: eine mandantenfähige App-Registrierung der Plattform (Plattform → Entra) mit den delegierten
// Berechtigungen Application.ReadWrite.All und Domain.Read.All; der anmeldende Admin erteilt die Zustimmung.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { plattformDb } from '../db/index.ts';
import { entschluesseln, verschluesseln } from '../geheim.ts';
import { plattformProtokollieren } from '../mandant.ts';
import { HttpFehler, kontextLaden, plattform } from '../sitzung.ts';
import { metadatenAuswerten, samlKonfigLesen, samlKonfigSpeichern, spDaten, zertifikatNormalisieren } from './saml.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['openid', 'profile', 'https://graph.microsoft.com/Application.ReadWrite.All', 'https://graph.microsoft.com/Domain.Read.All'];
/** Vorlage „Eigene Anwendung“ (Nicht-Katalog) in Entra */
const VORLAGE = '8adf8e6e-67b2-4cf2-a259-e3dc5476c621';

export interface EntraApp {
  clientId: string;
  clientSecretVorhanden: boolean;
  redirectUri: string;
}

export const redirectUri = () => `${config.publicUrl}/entra/callback`;

async function einstellung(schluessel: string): Promise<string | null> {
  const z = await plattformDb().selectFrom('plattform_einstellungen').select('wert').where('schluessel', '=', schluessel).executeTakeFirst();
  return z?.wert ?? null;
}

async function einstellungSetzen(schluessel: string, wert: string): Promise<void> {
  await plattformDb()
    .insertInto('plattform_einstellungen')
    .values({ schluessel, wert })
    .onConflict((oc) => oc.column('schluessel').doUpdateSet({ wert }))
    .execute();
}

export async function entraAppLesen(): Promise<EntraApp> {
  return { clientId: (await einstellung('entra_client_id')) ?? '', clientSecretVorhanden: Boolean(await einstellung('entra_client_secret')), redirectUri: redirectUri() };
}

// Offene Anmeldungen: state → Ziel (nur eine Instanz, 10 Minuten gültig)
const offen = new Map<string, { mandantId: string; sitzungId: string; zurueck: string; bis: number }>();

export function anmeldeUrl(state: string, clientId: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${p}`;
}

async function graph<T>(token: string, methode: 'GET' | 'POST' | 'PATCH', pfad: string, body?: unknown): Promise<T> {
  const r = await fetch(pfad.startsWith('https://') ? pfad : `${GRAPH}${pfad}`, {
    method: methode,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? (JSON.parse(text) as T & { error?: { code?: string; message?: string } }) : (undefined as T);
  if (!r.ok) {
    const f = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new Error(`Graph ${methode} ${pfad}: ${f?.code ?? r.status} ${f?.message ?? ''}`.trim());
  }
  return json;
}

const warten = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Richtet die Unternehmensanwendung ein (oder aktualisiert sie) und liefert die SAML-Konfiguration. */
export async function entraEinrichten(token: string, tenantId: string, mandantId: string, mandantName: string) {
  const sp = spDaten(mandantId);
  const schritte: string[] = [];

  // 1. Vorhandene App mit unserer Entity-ID suchen, sonst aus der Vorlage anlegen
  const suche = await graph<{ value: { id: string; appId: string }[] }>(
    token,
    'GET',
    `/applications?$filter=identifierUris/any(u:u eq '${sp.entityId.replace(/'/g, "''")}')&$select=id,appId`,
  );
  let appObjektId: string;
  let appId: string;
  let spId: string | undefined;
  if (suche.value[0]) {
    appObjektId = suche.value[0].id;
    appId = suche.value[0].appId;
    schritte.push('Vorhandene Unternehmensanwendung gefunden');
  } else {
    const neu = await graph<{ application: { id: string; appId: string }; servicePrincipal: { id: string } }>(token, 'POST', `/applicationTemplates/${VORLAGE}/instantiate`, {
      displayName: `${config.produktName} – ${mandantName}`,
    });
    appObjektId = neu.application.id;
    appId = neu.application.appId;
    spId = neu.servicePrincipal.id;
    schritte.push('Unternehmensanwendung angelegt');
  }

  // 2. App: Entity-ID und Antwort-URL (nach dem Anlegen kurz warten, bis das Objekt lesbar ist)
  for (let versuch = 0; ; versuch++) {
    try {
      await graph(token, 'PATCH', `/applications/${appObjektId}`, { identifierUris: [sp.entityId], web: { redirectUris: [sp.acsUrl] } });
      break;
    } catch (e) {
      if (versuch >= 5 || !/404|Request_ResourceNotFound/.test((e as Error).message)) throw e;
      await warten(2000);
    }
  }

  // 3. Service Principal: SAML-Modus, jeder Benutzer des Tenants darf sich anmelden (Zugang steuert die App selbst)
  if (!spId) {
    const s = await graph<{ value: { id: string }[] }>(token, 'GET', `/servicePrincipals?$filter=appId eq '${appId}'&$select=id`);
    if (!s.value[0]) throw new Error('Service Principal der Anwendung nicht gefunden');
    spId = s.value[0].id;
  }
  for (let versuch = 0; ; versuch++) {
    try {
      await graph(token, 'PATCH', `/servicePrincipals/${spId}`, { preferredSingleSignOnMode: 'saml', appRoleAssignmentRequired: false, loginUrl: `${config.publicUrl}/` });
      break;
    } catch (e) {
      if (versuch >= 5 || !/404|Request_ResourceNotFound/.test((e as Error).message)) throw e;
      await warten(2000);
    }
  }

  // 4. Signaturzertifikat: vorhandenes gültiges verwenden, sonst neues anlegen (3 Jahre)
  const zertifikate = new Set<string>();
  const spDaten2 = await graph<{ keyCredentials: { usage: string; key: string | null; endDateTime: string; customKeyIdentifier: string | null }[]; preferredTokenSigningKeyThumbprint: string | null }>(
    token,
    'GET',
    `/servicePrincipals/${spId}?$select=keyCredentials,preferredTokenSigningKeyThumbprint`,
  );
  const bald = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const gueltig = (spDaten2.keyCredentials ?? []).filter((k) => k.usage === 'Verify' && k.key && k.endDateTime > bald);
  if (gueltig.length) {
    for (const k of gueltig) zertifikate.add(zertifikatNormalisieren(k.key!));
    schritte.push('Vorhandenes Signaturzertifikat übernommen');
  } else {
    const ende = new Date();
    ende.setFullYear(ende.getFullYear() + 3);
    const zert = await graph<{ key: string; thumbprint: string }>(token, 'POST', `/servicePrincipals/${spId}/addTokenSigningCertificate`, {
      displayName: `CN=${config.produktName} SAML`,
      endDateTime: ende.toISOString(),
    });
    zertifikate.add(zertifikatNormalisieren(zert.key));
    await graph(token, 'PATCH', `/servicePrincipals/${spId}`, { preferredTokenSigningKeyThumbprint: zert.thumbprint });
    schritte.push('Signaturzertifikat erstellt (3 Jahre)');
  }

  // 5. Verbundmetadaten (öffentlich) ergänzen: SSO-Adresse, weitere Zertifikate
  let idpEntityId = `https://sts.windows.net/${tenantId}/`;
  let idpSsoUrl = `https://login.microsoftonline.com/${tenantId}/saml2`;
  try {
    const r = await fetch(`https://login.microsoftonline.com/${tenantId}/federationmetadata/2007-06/federationmetadata.xml?appid=${appId}`, { signal: AbortSignal.timeout(15_000) });
    if (r.ok) {
      const m = metadatenAuswerten(await r.text());
      idpEntityId = m.idpEntityId;
      idpSsoUrl = m.idpSsoUrl;
      for (const c of m.idpZertifikate) zertifikate.add(c);
    }
  } catch {
    schritte.push('Verbundmetadaten nicht abrufbar, Standardadressen verwendet');
  }

  // 6. Überprüfte Domänen des Tenants
  const dom = await graph<{ value: { id: string; isVerified: boolean }[] }>(token, 'GET', '/domains?$select=id,isVerified');
  const emailDomaenen = dom.value.filter((d) => d.isVerified).map((d) => d.id.toLowerCase());

  return { konfig: { idpEntityId, idpSsoUrl, idpZertifikate: [...zertifikate], emailDomaenen, aktiv: true }, appId, schritte };
}

/** Zugangsdaten und Tenant aus dem Autorisierungscode */
async function tokenHolen(code: string, clientId: string, clientSecret: string): Promise<{ token: string; tenantId: string; konto: string }> {
  const r = await fetch('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), scope: SCOPES.join(' ') }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await r.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error_description?: string };
  if (!r.ok || !json.access_token || !json.id_token) throw new Error(`Microsoft-Anmeldung: ${json.error_description?.split('\n')[0] ?? r.status}`);
  // tid/preferred_username aus dem ID-Token (es kommt direkt von Microsoft über TLS; der Zugriff läuft ohnehin über das Access-Token)
  const nutzlast = JSON.parse(Buffer.from(json.id_token.split('.')[1]!, 'base64url').toString('utf8')) as { tid?: string; preferred_username?: string };
  if (!nutzlast.tid) throw new Error('Kein Tenant im ID-Token');
  return { token: json.access_token, tenantId: nutzlast.tid, konto: nutzlast.preferred_username ?? '' };
}

/** Plattform-Admin oder Admin des Mandanten */
function darfEinrichten(req: FastifyRequest, mandantId: string) {
  const k = req.kontext;
  if (!k || k.mfaOffen) throw new HttpFehler(401, 'Nicht angemeldet');
  if (k.plattformAdmin) return k;
  if (k.mandant?.id === mandantId && k.rollen.includes('admin')) return k;
  throw new HttpFehler(403, 'Keine Berechtigung');
}

export function entraRouten(app: FastifyInstance): void {
  app.get('/api/plattform/entra', async (req) => {
    plattform(req);
    return entraAppLesen();
  });

  app.put('/api/plattform/entra', async (req) => {
    const k = plattform(req);
    const d = z.object({ clientId: z.string().trim().max(100), clientSecret: z.string().max(500).nullable() }).parse(req.body);
    await einstellungSetzen('entra_client_id', d.clientId);
    if (d.clientSecret?.trim()) await einstellungSetzen('entra_client_secret', verschluesseln(d.clientSecret.trim()));
    await plattformProtokollieren(k.sitzung.email, 'Entra-Setup-App geändert', 'Plattform', { clientId: d.clientId, neuesSecret: Boolean(d.clientSecret?.trim()) });
    return { ok: true };
  });

  /** Liefert die Microsoft-Anmeldeadresse; die Web-App leitet dorthin weiter. */
  app.post('/api/entra/start', async (req) => {
    const d = z.object({ mandant: z.string().min(1).max(40), zurueck: z.enum(['plattform', 'admin']).default('admin') }).parse(req.body);
    const k = darfEinrichten(req, d.mandant);
    const m = await plattformDb().selectFrom('mandant').select('id').where('id', '=', d.mandant).executeTakeFirst();
    if (!m) throw new HttpFehler(404, 'Mandant nicht gefunden');
    const e = await entraAppLesen();
    if (!e.clientId || !e.clientSecretVorhanden) throw new HttpFehler(409, 'Die Entra-Setup-App ist auf der Plattform nicht hinterlegt (Plattform → Entra).');
    for (const [s, o] of offen) if (o.bis < Date.now()) offen.delete(s);
    const state = crypto.randomBytes(24).toString('base64url');
    offen.set(state, { mandantId: d.mandant, sitzungId: k.sitzung.id, zurueck: d.zurueck, bis: Date.now() + 10 * 60_000 });
    return { url: anmeldeUrl(state, e.clientId) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/entra/callback', async (req, reply) => {
    const o = req.query.state ? offen.get(req.query.state) : undefined;
    if (req.query.state) offen.delete(req.query.state);
    const zurueck = (ok: boolean, meldung: string) =>
      reply.redirect(`/#/${o?.zurueck ?? 'admin'}?entra=${ok ? 'ok' : 'fehler'}&meldung=${encodeURIComponent(meldung)}`, 303);
    try {
      if (!o || o.bis < Date.now()) throw new Error('Die Einrichtung ist abgelaufen, bitte erneut starten.');
      const k = await kontextLaden(req);
      if (!k || k.sitzung.id !== o.sitzungId) throw new Error('Sitzung passt nicht zur gestarteten Einrichtung.');
      if (req.query.error) throw new Error(req.query.error_description?.split('\n')[0] ?? req.query.error);
      if (!req.query.code) throw new Error('Kein Autorisierungscode erhalten.');
      const clientId = (await einstellung('entra_client_id')) ?? '';
      const secret = entschluesseln((await einstellung('entra_client_secret')) ?? '');
      const { token, tenantId, konto } = await tokenHolen(req.query.code, clientId, secret);
      const m = await plattformDb().selectFrom('mandant').select('name').where('id', '=', o.mandantId).executeTakeFirstOrThrow();
      const r = await entraEinrichten(token, tenantId, o.mandantId, m.name);
      // Bereits manuell eingetragene Domänen behalten
      const bisher = await samlKonfigLesen(o.mandantId);
      const domaenen = [...new Set([...(bisher?.emailDomaenen ?? []), ...r.konfig.emailDomaenen])];
      await samlKonfigSpeichern(o.mandantId, { ...r.konfig, emailDomaenen: domaenen }, k.sitzung.email);
      await plattformProtokollieren(k.sitzung.email, 'Entra automatisch eingerichtet', o.mandantId, { tenantId, appId: r.appId, konto, schritte: r.schritte });
      return zurueck(true, `${r.schritte.join('. ')}. Domänen: ${domaenen.join(', ')}.`);
    } catch (e) {
      req.log.warn({ fehler: (e as Error).message }, 'Entra-Einrichtung fehlgeschlagen');
      return zurueck(false, (e as Error).message);
    }
  });
}
