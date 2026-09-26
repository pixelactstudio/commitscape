/**
 * A Shared Report, opened in the browser (ADR-0016): the key is the link's
 * fragment, which browsers never send; the upload is the nonce then the
 * AES-256-GCM ciphertext and tag; the Delete Token is HKDF-SHA256 of the
 * key with info "commitscape delete". The same as `commitscape share`
 * (crates/commitscape/src/share.rs), checked against one vector in both.
 */

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function unbase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*=*$/.test(text)) return null;
  try {
    const plain = atob(text.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(plain, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The key in a link's fragment, when it is one. */
export function keyOf(fragment: string): Uint8Array | null {
  const key = unbase64url(fragment.replace(/^#/, ""));
  return key && key.length === 32 ? key : null;
}

/** Unlocks what `commitscape share` uploaded; throws when a byte was changed or the key is wrong. */
export async function unlock(key: Uint8Array, locked: Uint8Array): Promise<Uint8Array> {
  if (locked.length < 12 + 16) throw new Error("too short to be a Shared Report");
  const k = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: locked.subarray(0, 12) as BufferSource }, k, locked.subarray(12) as BufferSource);
  return new Uint8Array(plain);
}

/** The Delete Token the key gives, as base64url. */
export async function deleteToken(key: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("commitscape delete") },
    k,
    256,
  );
  return base64url(new Uint8Array(bits));
}
