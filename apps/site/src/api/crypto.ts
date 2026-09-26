/**
 * The Site's own cryptography, all WebCrypto (ADR-0017): GitHub user tokens
 * locked at rest with SESSION_KEY, the GitHub App's RS256 JWT, and GitHub's
 * webhook signatures.
 */
import { base64url, unbase64url } from "@commitscape/data";

const encoder = new TextEncoder();

/** A 256-bit AES key from SESSION_KEY, whatever its form. */
async function sessionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("SESSION_KEY must be set, 32 characters or more");
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Locks a secret for D1: base64url of the nonce, then ciphertext and tag. */
export async function seal(secret: string, plain: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await sessionKey(secret), encoder.encode(plain)));
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed, 12);
  return base64url(out);
}

export async function unseal(secret: string, sealed: string): Promise<string | null> {
  const bytes = unbase64url(sealed);
  if (!bytes || bytes.length < 28) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) as BufferSource },
      await sessionKey(secret),
      bytes.subarray(12) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

function der(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** DER length bytes. */
function length(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub gives an App's private key as PKCS#1 ("BEGIN RSA PRIVATE KEY");
 * WebCrypto reads PKCS#8. Wraps the one in the other. A key already in
 * PKCS#8, or the PEM base64-encoded whole (for a one-line secret), works too.
 */
export function pkcs8(key: string): Uint8Array {
  const pem = key.includes("-----BEGIN") ? key : atob(key.trim());
  const inner = der(pem);
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return inner;
  // PrivateKeyInfo: version 0, rsaEncryption with NULL parameters, and the key as an OCTET STRING.
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...length(inner.length)];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octets];
  const out = new Uint8Array([0x30, ...length(body.length + inner.length), ...body, ...inner]);
  return out;
}

/** The GitHub App's JWT (RS256), good for nine minutes, to ask for installation tokens. */
export async function appJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(privateKey) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const part = (v: unknown) => base64url(encoder.encode(JSON.stringify(v)));
  const head = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(head)));
  return `${head}.${base64url(signature)}`;
}

/** Whether a webhook's `X-Hub-Signature-256` is GitHub's, under the webhook secret. */
export async function githubSigned(secret: string, header: string | null, body: string): Promise<boolean> {
  const m = /^sha256=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || !secret) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const mac = Uint8Array.from((m[1] ?? "").match(/../g) ?? [], (b) => parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, mac, encoder.encode(body));
}
