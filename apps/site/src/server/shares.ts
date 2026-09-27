import "@tanstack/react-start/server-only";
import { eq, gt, sum } from "drizzle-orm";
import { now, randomId, same, schema, sha256, shareKey, type Db, type Storage } from "@commitscape/server";
import { SiteError } from "./http";
import { allow } from "./limits";

const { shares } = schema;

export const SHARE_MAX = 25 * 1024 * 1024;
export const SHARE_LIMIT = { action: "share", max: 30, seconds: 3600 };
export const SHARES_TOTAL = 4 * 1024 ** 3;

const GONE = "There is no Shared Report here: it was deleted, or never made.";

export type ShareAsk = { bytes?: unknown; hours?: unknown; deleteHash?: unknown };

/** Registers a Shared Report and returns its id and one-time upload token. */
export async function createShare(db: Db, address: string, asked: ShareAsk | null) {
  const { bytes, hours, deleteHash } = asked ?? {};
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 28) throw new SiteError(400, "Say how many bytes it is.");
  if (bytes > SHARE_MAX) throw new SiteError(413, "A Shared Report is at most 25 MB.");
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 12) throw new SiteError(400, "A Shared Report lasts 1 to 12 hours.");
  if (typeof deleteHash !== "string" || !/^[0-9a-f]{64}$/.test(deleteHash)) throw new SiteError(400, "It needs its Delete Token's hash.");
  if (!(await allow(db, SHARE_LIMIT, address))) throw new SiteError(429, "This address has shared many Reports this hour. Try again later.");
  const [held] = await db.select({ n: sum(shares.bytes) }).from(shares).where(gt(shares.expiresAt, now()));
  if (Number(held?.n ?? 0) + bytes > SHARES_TOTAL) throw new SiteError(503, "The Site is holding as many Shared Reports as it can. Try again in an hour or two.");
  const id = randomId(16);
  const uploadToken = randomId(32);
  const expiresAt = now() + hours * 3600;
  await db.insert(shares).values({ id, bytes, createdAt: now(), expiresAt, deleteHash, uploadHash: sha256(uploadToken) });
  return { id, uploadToken, expiresAt };
}

/** Stores a Shared Report's locked bytes once, given its upload token. */
export async function uploadShare(db: Db, storage: Storage, id: string, token: string, body: Uint8Array) {
  const [row] = await db.select().from(shares).where(eq(shares.id, id));
  if (!row || row.uploaded || !row.uploadHash || !same(sha256(token), row.uploadHash)) throw new SiteError(403, "Not this Shared Report's upload.");
  if (body.length !== row.bytes) throw new SiteError(400, "It is not the size that was said.");
  await storage.put(shareKey(id), body, { type: "application/octet-stream" });
  await db.update(shares).set({ uploaded: true, uploadHash: null }).where(eq(shares.id, id));
  return { ok: true, expiresAt: row.expiresAt };
}

/** A Shared Report's locked bytes until it expires. */
export async function getShare(db: Db, storage: Storage, id: string) {
  const [row] = await db.select().from(shares).where(eq(shares.id, id));
  if (!row || !row.uploaded) throw new SiteError(404, GONE);
  if (row.expiresAt <= now()) throw new SiteError(410, "This Shared Report has expired.");
  const object = await storage.get(shareKey(id));
  if (!object) throw new SiteError(404, GONE);
  return { body: object.body, expiresAt: row.expiresAt };
}

/** Deletes a Shared Report given its Delete Token. */
export async function deleteShare(db: Db, storage: Storage, id: string, token: string) {
  const [row] = await db.select().from(shares).where(eq(shares.id, id));
  if (!row) throw new SiteError(404, GONE);
  if (!same(sha256(token), row.deleteHash)) throw new SiteError(403, "That is not this Shared Report's Delete Token.");
  await storage.delete([shareKey(id)]);
  await db.delete(shares).where(eq(shares.id, id));
  return { ok: true };
}
