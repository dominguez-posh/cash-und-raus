// Zugriff auf die Server-API. Änderungen tragen den Kopf x-cr-anfrage (CSRF-Schutz).

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function anfrage<T>(methode: string, pfad: string, daten?: unknown): Promise<T> {
  const r = await fetch(pfad, {
    method: methode,
    credentials: 'same-origin',
    headers: { ...(daten !== undefined ? { 'content-type': 'application/json' } : {}), ...(methode !== 'GET' ? { 'x-cr-anfrage': '1' } : {}) },
    body: daten !== undefined ? JSON.stringify(daten) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiFehler(r.status, json?.fehler ?? `Fehler ${r.status}`);
  return json as T;
}

export const api = {
  get: <T>(pfad: string) => anfrage<T>('GET', pfad),
  post: <T>(pfad: string, daten: unknown = {}) => anfrage<T>('POST', pfad, daten),
  put: <T>(pfad: string, daten: unknown) => anfrage<T>('PUT', pfad, daten),
  del: <T>(pfad: string) => anfrage<T>('DELETE', pfad),
};

export const fehlerText = (e: unknown) => (e instanceof Error ? e.message : String(e));
