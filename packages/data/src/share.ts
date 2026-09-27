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

export function keyOf(fragment: string): Uint8Array | null {
  const key = unbase64url(fragment.replace(/^#/, ""));
  return key && key.length === 32 ? key : null;
}

/** Decrypts a Shared Report; throws when the key is wrong or a byte changed. */
export async function unlock(key: Uint8Array, locked: Uint8Array): Promise<Uint8Array> {
  if (locked.length < 12 + 16) throw new Error("too short to be a Shared Report");
  const k = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: locked.subarray(0, 12) as BufferSource }, k, locked.subarray(12) as BufferSource);
  return new Uint8Array(plain);
}

export async function deleteToken(key: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("commitscape delete") },
    k,
    256,
  );
  return base64url(new Uint8Array(bits));
}
