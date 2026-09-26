/**
 * Stored Reports (ADR-0014, ADR-0015). A Report is gzipped JSON in R2; the
 * Worker passes it through without reading it.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { repositories } from "../db/schema";
import { canSee } from "./access";
import { session } from "./auth";
import { FACTS_FOR, known } from "./lookup";
import { now, says } from "./http";

/** GitHub's rules for owner and repository names, loosely. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export function repoId(owner: string, name: string): string | null {
  if (!NAME.test(owner) || !NAME.test(name) || owner.startsWith(".") || name === "." || name === "..") return null;
  return `${owner}/${name}`.toLowerCase();
}

/**
 * The Report itself, gzipped, straight from R2. A Connected Repository's
 * only for a signed-in person GitHub says can see it now (ADR-0017), and
 * to anyone else it is as if there were none.
 */
export async function report(request: Request, env: Env, ctx: ExecutionContext, owner: string, name: string): Promise<Response> {
  const id = repoId(owner, name);
  if (!id) return says(400, "That is not a GitHub repository's name.");
  const db = drizzle(env.DB);
  let row = await db.select().from(repositories).where(eq(repositories.id, id)).get();
  // A public repository's facts an hour old are asked again first, so one
  // made private, or a name given to another repository, stops showing
  // the Report built before.
  if (row && !row.installationId && (row.factsAt ?? 0) < now() - FACTS_FOR) row = (await known(env, owner, name)) ?? row;
  if (!row?.reportKey) return says(404, "No Report of this repository yet.");
  if (row.isPrivate || row.installationId) {
    const s = await session(request, env);
    if (row.isPrivate && (!s || !(await canSee(env, s, owner, name, row.githubId)))) return says(404, "No Report of this repository yet.");
  } else if (row.status !== "ok") {
    return says(404, "No Report of this repository yet.");
  }
  const object = await env.REPORTS.get(row.reportKey);
  if (!object) return says(404, "No Report of this repository yet.");
  // Retention counts from the last view; writing it at most hourly keeps
  // D1's daily writes for what matters.
  if ((row.viewedAt ?? 0) < now() - 3600) {
    ctx.waitUntil(db.update(repositories).set({ viewedAt: now() }).where(eq(repositories.id, id)).run());
  }
  return new Response(object.body, {
    headers: {
      "content-type": "application/gzip",
      // A private Report is never kept by a shared cache.
      "cache-control": row.isPrivate ? "private, no-store" : "public, max-age=300",
      etag: object.httpEtag,
    },
  });
}
