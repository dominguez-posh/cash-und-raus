// Browser-Seite von WebAuthn: Optionen des Servers (base64url) in ArrayBuffer umwandeln und zurück.

const zuPuffer = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
};
const zuText = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Schluessel {
  id: string;
  type: string;
  transports?: string[];
}

export const passkeyMoeglich = () => typeof window.PublicKeyCredential === 'function';

export async function passkeyErstellen(o: {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  excludeCredentials: Schluessel[];
}) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: zuPuffer(o.challenge),
      rp: o.rp,
      user: { ...o.user, id: zuPuffer(o.user.id) },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
        { type: 'public-key', alg: -8 },
      ],
      excludeCredentials: o.excludeCredentials.map((c) => ({ id: zuPuffer(c.id), type: 'public-key', transports: c.transports as AuthenticatorTransport[] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      attestation: 'none',
      timeout: 120_000,
      extensions: { credProps: true },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Abgebrochen');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: zuText(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: zuText(r.clientDataJSON), attestationObject: zuText(r.attestationObject), transports: r.getTransports?.() ?? [] },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export async function passkeyPruefen(o: { challenge: string; rpId: string; allowCredentials: Schluessel[] }) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: zuPuffer(o.challenge),
      rpId: o.rpId,
      allowCredentials: o.allowCredentials.map((c) => ({ id: zuPuffer(c.id), type: 'public-key', transports: c.transports as AuthenticatorTransport[] })),
      userVerification: 'preferred',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Abgebrochen');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: zuText(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: zuText(r.clientDataJSON),
      authenticatorData: zuText(r.authenticatorData),
      signature: zuText(r.signature),
      userHandle: r.userHandle ? zuText(r.userHandle) : null,
    },
  };
}
