// E-Mail-Versand über Microsoft Graph: Client-Credentials-Token, sendMail im Namen des Absender-Postfachs.
// Nötig: App-Registrierung im Entra-Tenant des Mandanten mit Anwendungsberechtigung Mail.Send (Admin-Zustimmung);
// empfohlen eine Application Access Policy in Exchange Online, die die App auf das Absender-Postfach beschränkt.
import type { Kysely } from 'kysely';
import type { GraphKonfig } from '../../shared/types.ts';
import type { MandantDB } from './db/schema.ts';
import { entschluesseln, verschluesseln } from './geheim.ts';
import { HttpFehler } from './sitzung.ts';

export interface Anhang {
  name: string;
  mime: string;
  daten: Buffer;
}

export async function graphKonfigLesen(db: Kysely<MandantDB>): Promise<GraphKonfig | null> {
  const z = await db.selectFrom('graph_konfig').selectAll().where('id', '=', 1).executeTakeFirst();
  if (!z) return null;
  return { tenantId: z.tenant_id, clientId: z.client_id, clientSecretVorhanden: z.client_secret_enc !== '', absender: z.absender, aktiv: z.aktiv === 1, letzterTest: z.letzter_test };
}

export async function graphKonfigSpeichern(
  db: Kysely<MandantDB>,
  k: { tenantId: string; clientId: string; clientSecret: string | null; absender: string; aktiv: boolean },
): Promise<void> {
  const vorhanden = await db.selectFrom('graph_konfig').select('client_secret_enc').where('id', '=', 1).executeTakeFirst();
  const enc = k.clientSecret ? verschluesseln(k.clientSecret) : (vorhanden?.client_secret_enc ?? '');
  if (k.aktiv && !enc) throw new HttpFehler(400, 'Zum Aktivieren fehlt das Client-Secret.');
  const werte = { tenant_id: k.tenantId, client_id: k.clientId, client_secret_enc: enc, absender: k.absender, aktiv: k.aktiv ? 1 : 0 };
  await db
    .insertInto('graph_konfig')
    .values({ id: 1, ...werte, letzter_test: null })
    .onConflict((oc) => oc.column('id').doUpdateSet(werte))
    .execute();
}

// Token je Mandant zwischenspeichern (Graph-Tokens gelten etwa eine Stunde).
const tokens = new Map<string, { token: string; bis: number }>();

async function token(schluessel: string, tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const t = tokens.get(schluessel);
  if (t && t.bis > Date.now() + 60_000) return t.token;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const json = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !json.access_token) throw new HttpFehler(502, `Anmeldung bei Microsoft fehlgeschlagen: ${json.error_description?.split('\n')[0] ?? r.status}`);
  tokens.set(schluessel, { token: json.access_token, bis: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

export async function emailSenden(
  db: Kysely<MandantDB>,
  mandantId: string,
  mail: { an: string[]; betreff: string; text: string; anhaenge: Anhang[]; antwortAn?: string },
): Promise<void> {
  const z = await db.selectFrom('graph_konfig').selectAll().where('id', '=', 1).executeTakeFirst();
  if (!z || z.aktiv !== 1) throw new HttpFehler(409, 'E-Mail-Versand ist nicht eingerichtet (Verwaltung → E-Mail).');
  const t = await token(mandantId, z.tenant_id, z.client_id, entschluesseln(z.client_secret_enc));
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(z.absender)}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: mail.betreff,
        body: { contentType: 'Text', content: mail.text },
        toRecipients: mail.an.map((a) => ({ emailAddress: { address: a } })),
        replyTo: mail.antwortAn ? [{ emailAddress: { address: mail.antwortAn } }] : undefined,
        attachments: mail.anhaenge.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.mime, contentBytes: a.daten.toString('base64') })),
      },
      saveToSentItems: true,
    }),
  });
  if (!r.ok) {
    const fehler = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    if (r.status === 401) tokens.delete(mandantId);
    throw new HttpFehler(502, `Graph sendMail: ${fehler.error?.message ?? r.status}`);
  }
}
