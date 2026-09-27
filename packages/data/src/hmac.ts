/**
 * How the Site and the Builder know each other (ADR-0015): each request is
 * signed with HMAC-SHA256 under a secret they share, over the request's
 * method, path, time and body (or, for an upload, its length: hashing a
 * large Report would cost the Worker more CPU than its budget, so an
 * upload also carries a one-time token issued with its Build). WebCrypto,
 * so the Worker and Node run the same code.
 */

/** The header a signed request carries: `t=<seconds>,v1=<hex>`. */
export const SIGNATURE = "x-commitscape-signature";

/** How old a signature may be, in seconds, either way. */
export const SIGNATURE_AGE = 300;

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function message(method: string, path: string, time: number, content: string): Uint8Array {
  return new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${time}\n${content}`);
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

function unhex(text: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) return null;
  return Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));
}

/**
 * The signature for a request. `content` is its body, or for an upload
 * `length:<bytes>`.
 */
export async function sign(secret: string, method: string, path: string, content: string, time = Math.floor(Date.now() / 1000)): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await key(secret), message(method, path, time, content) as BufferSource);
  return `t=${time},v1=${hex(mac)}`;
}

/** Whether a signature is right and recent. Compared in constant time by WebCrypto. */
export async function verify(
  secret: string,
  header: string | null,
  method: string,
  path: string,
  content: string,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header ?? "");
  if (!m || !secret) return false;
  const time = Number(m[1]);
  if (Math.abs(now - time) > SIGNATURE_AGE) return false;
  const mac = unhex(m[2] ?? "");
  if (!mac) return false;
  return crypto.subtle.verify("HMAC", await key(secret), mac as BufferSource, message(method, path, time, content) as BufferSource);
}
