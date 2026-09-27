import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
