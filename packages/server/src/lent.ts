import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "./db/client";
import { lentTokens } from "./db/schema";
import { now } from "./time";

const LENT_FOR = 6 * 3600;

const keyOf = (secret: string) => createHash("sha256").update(`commitscape lent token:${secret}`).digest();

/** Encrypts a token with the Site and Builder's shared secret (AES-256-GCM). */
export function sealToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/** The token `sealToken` sealed, or null when it was sealed with another secret or changed. */
export function openToken(secret: string, sealed: string): string | null {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Lends the GitHub token of the person who asked for a public repository's Build to the Builder, sealed, for a few hours. */
export async function lendToken(db: Db, secret: string, repoId: string, userId: string, token: string | null): Promise<void> {
  if (!token) return;
  const row = { repoId, userId, token: sealToken(secret, token), until: now() + LENT_FOR };
  await db.insert(lentTokens).values(row).onConflictDoUpdate({ target: lentTokens.repoId, set: { userId, token: row.token, until: row.until } });
}

/** The token lent for a repository's work, while it lasts. */
export async function lentToken(db: Db, secret: string | undefined, repoId: string): Promise<string | null> {
  if (!secret) return null;
  const [row] = await db
    .select({ token: lentTokens.token })
    .from(lentTokens)
    .where(and(eq(lentTokens.repoId, repoId), gt(lentTokens.until, now())));
  return row ? openToken(secret, row.token) : null;
}

/** Deletes lent tokens past their time. */
export async function pruneLent(db: Db): Promise<number> {
  return (await db.delete(lentTokens).where(lte(lentTokens.until, now())).returning({ repoId: lentTokens.repoId })).length;
}
