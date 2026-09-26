/**
 * Shared Reports (ADR-0016). `POST /api/shares` says how big and how long,
 * and gets an id and a one-time upload token; `PUT /api/shares/:id`
 * streams the locked bytes into R2; `GET` gives them back until they
 * expire (then 410); `DELETE`, with the Delete Token, removes them at once.
 * The Site never has the key, so it stores only what it cannot read.
 */
import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { shares } from "../db/schema";
import { address, json, now, says, sha256 } from "./http";
import { allow } from "./limits";
import { randomId, same } from "./random";

/** The largest Shared Report, locked (ADR-0016). */
export const SHARE_MAX = 25 * 1024 * 1024;
/** Shared Reports an address may make in an hour. */
export const SHARE_LIMIT = { action: "share", max: 30, seconds: 3600 };
/**
 * All Shared Reports together, at most: R2's free plan holds 10 GB, and
 * Reports need their share. Past it, new ones wait for old ones to expire.
 */
export const SHARES_TOTAL = 4 * 1024 ** 3;
/** An upload not made within this long is removed. */
const UPLOAD_WITHIN = 3600;

const key = (id: string) => `shares/${id}`;

export async function createShare(request: Request, env: Env): Promise<Response> {
  const asked = (await request.json().catch(() => null)) as { bytes?: unknown; hours?: unknown; deleteHash?: unknown } | null;
  const bytes = asked?.bytes;
  const hours = asked?.hours;
  const deleteHash = asked?.deleteHash;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 28) return says(400, "Say how many bytes it is.");
  if (bytes > SHARE_MAX) return says(413, "A Shared Report is at most 25 MB.");
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 12) {
    return says(400, "A Shared Report lasts 1 to 12 hours.");
  }
  if (typeof deleteHash !== "string" || !/^[0-9a-f]{64}$/.test(deleteHash)) return says(400, "It needs its Delete Token's hash.");
  if (!(await allow(env.DB, SHARE_LIMIT, address(request)))) {
    return says(429, "This address has shared many Reports this hour. Try again later.");
  }
  const held = await env.DB.prepare("SELECT coalesce(sum(bytes), 0) AS n FROM shares WHERE expires_at > ?1").bind(now()).first<{ n: number }>();
  if ((held?.n ?? 0) + bytes > SHARES_TOTAL) {
    return says(503, "The Site is holding as many Shared Reports as it can. Try again in an hour or two.");
  }
  const id = randomId(16);
  const uploadToken = randomId(32);
  const expiresAt = now() + hours * 3600;
  await drizzle(env.DB)
    .insert(shares)
    .values({ id, bytes, createdAt: now(), expiresAt, deleteHash, uploadHash: await sha256(uploadToken) });
  return json({ id, uploadToken, expiresAt }, 201);
}

export async function uploadShare(request: Request, env: Env, id: string): Promise<Response> {
  const db = drizzle(env.DB);
  const row = await db.select().from(shares).where(eq(shares.id, id)).get();
  const token = request.headers.get("x-upload-token") ?? "";
  if (!row || row.uploaded || !row.uploadHash || !same(await sha256(token), row.uploadHash)) {
    return says(403, "Not this Shared Report's upload.");
  }
  const length = Number(request.headers.get("content-length") ?? "-1");
  if (length !== row.bytes) return says(400, "It is not the size that was said.");
  await env.REPORTS.put(key(id), request.body, { httpMetadata: { contentType: "application/octet-stream" } });
  await db.update(shares).set({ uploaded: true, uploadHash: null }).where(eq(shares.id, id));
  return json({ ok: true, expiresAt: row.expiresAt });
}

export async function getShare(env: Env, id: string): Promise<Response> {
  const row = await drizzle(env.DB).select().from(shares).where(eq(shares.id, id)).get();
  if (!row || !row.uploaded) return says(404, "There is no Shared Report here: it was deleted, or never made.");
  if (row.expiresAt <= now()) return says(410, "This Shared Report has expired.");
  const object = await env.REPORTS.get(key(id));
  if (!object) return says(404, "There is no Shared Report here: it was deleted, or never made.");
  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
      "x-expires-at": String(row.expiresAt),
    },
  });
}

export async function deleteShare(request: Request, env: Env, id: string): Promise<Response> {
  const db = drizzle(env.DB);
  const row = await db.select().from(shares).where(eq(shares.id, id)).get();
  if (!row) return says(404, "There is no Shared Report here: it was deleted, or never made.");
  const token = request.headers.get("x-delete-token") ?? "";
  if (!same(await sha256(token), row.deleteHash)) return says(403, "That is not this Shared Report's Delete Token.");
  await env.REPORTS.delete(key(id));
  await db.delete(shares).where(eq(shares.id, id));
  return json({ ok: true });
}

/**
 * The Cron Trigger's work: expired Shared Reports, and uploads never made,
 * removed a hundred at a time (the free plan allows 10 ms of CPU and 50
 * subrequests a run; R2 deletes a hundred keys in one).
 */
export async function expire(env: Env): Promise<number> {
  const db = drizzle(env.DB);
  const gone = await db
    .select({ id: shares.id })
    .from(shares)
    .where(lt(shares.expiresAt, now()))
    .limit(100)
    .all();
  const abandoned = await db
    .select({ id: shares.id })
    .from(shares)
    .where(and(eq(shares.uploaded, false), lt(shares.createdAt, now() - UPLOAD_WITHIN)))
    .limit(100)
    .all();
  const ids = [...new Set([...gone, ...abandoned].map((r) => r.id))];
  if (ids.length === 0) return 0;
  await env.REPORTS.delete(ids.map(key));
  await env.DB.prepare(`DELETE FROM shares WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .run();
  return ids.length;
}
