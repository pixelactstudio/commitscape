/**
 * `GET /api/repos/:owner/:name`: what the Site knows of a repository on
 * GitHub (ADR-0015, ADR-0017). A public one: GitHub's facts (asked for when
 * missing or an hour old), its Report, its last Build, and whether a Build
 * may start. One GitHub does not show publicly: the same, only for a
 * signed-in person GitHub says can see it, and only built once the App may
 * read it. It starts nothing itself: the page asks for a Build with
 * `POST /api/builds`, which is rate limited.
 */
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Lookup } from "@commitscape/data";
import { builds, repositories } from "../db/schema";
import { canSee } from "./access";
import { installationOf } from "./app";
import { session, type Session } from "./auth";
import { askGitHub } from "./github";
import { address, json, now, says } from "./http";
import { allow } from "./limits";
import { repoId } from "./reports";

/**
 * Lookups an address may make in an hour that ask GitHub (a repository not
 * known, or known over an hour ago): each costs the Site four of its GitHub
 * requests.
 */
export const LOOKUP_LIMIT = { action: "lookup", max: 300, seconds: 3600 };
/** A name GitHub had no repository for is forgotten after this long. */
const NOT_FOUND_FOR = 7 * 24 * 3600;

/** An address past `LOOKUP_LIMIT`. */
export class TooManyLookups extends Error {}

/** GitHub's facts are kept this long, in seconds. */
export const FACTS_FOR = 3600;
/** A Report older than this is rebuilt when someone asks (ADR-0015). */
export const REPORT_FOR = 24 * 3600;
/** A Build not heard of for this long is taken as lost. */
export const BUILD_LOST_AFTER = 30 * 60;
/** After a failed Build, the next waits this long. */
export const RETRY_AFTER = 3600;

export type Row = typeof repositories.$inferSelect;

/** The repository's row, with its public facts refreshed when they are old. A Connected Repository's are refreshed as its people view it. */
export async function known(env: Env, owner: string, name: string, who?: string): Promise<Row | null> {
  const id = repoId(owner, name);
  if (!id) return null;
  const db = drizzle(env.DB);
  const row = await db.select().from(repositories).where(eq(repositories.id, id)).get();
  if (row && (row.installationId || (row.factsAt && row.factsAt > now() - FACTS_FOR))) return row;
  // Asking GitHub is limited per address; past it, what is known stands.
  if (who && !(await allow(env.DB, LOOKUP_LIMIT, who))) {
    if (row) return row;
    throw new TooManyLookups();
  }
  const asked = await askGitHub(env, owner, name).catch(() => null);
  // GitHub unreachable: what was known stands.
  if (!asked) return row ?? null;
  // The name now belongs to another repository: the old one's Report is not this one's.
  const another = !!row?.githubId && !!asked.githubId && row.githubId !== asked.githubId;
  if (another && row) await forgetReport(env, row);
  const fields = {
    githubId: asked.githubId ?? row?.githubId ?? null,
    ...(another ? { reportKey: null, reportAt: null, reportBytes: null, reportLines: null, cardKey: null, pageKey: null } : {}),
    status: asked.status,
    isPrivate: asked.status === "private",
    facts: asked.status === "ok" ? JSON.stringify(asked.facts) : null,
    factsAt: now(),
    sizeKb: asked.status === "ok" ? asked.facts.sizeKb : null,
    // As it was asked for: GitHub may know it by a newer name (facebook/react
    // is react/react now), which `facts.fullName` says, and still answers to
    // the old one. The page's address stays the one people use.
    owner: row?.owner ?? owner,
    name: row?.name ?? name,
  };
  return await db
    .insert(repositories)
    .values({ id, ...fields })
    .onConflictDoUpdate({ target: repositories.id, set: fields })
    .returning()
    .get();
}

/** Deletes a repository's stored Report, card and page, keeping its row. */
async function forgetReport(env: Env, row: Row): Promise<void> {
  const keys = [row.reportKey, row.cardKey, row.pageKey].filter((k): k is string => !!k);
  if (keys.length > 0) await env.REPORTS.delete(keys);
}

/**
 * A repository GitHub does not show publicly, for a signed-in person: whether
 * they may see it, and whether the App may read it. Its facts are asked with
 * their token, and the row records the installation.
 */
export async function connected(
  env: Env,
  s: Session,
  owner: string,
  name: string,
  row: Row,
): Promise<{ access: Lookup["access"]; row: Row }> {
  if (!(await canSee(env, s, owner, name, row.githubId))) return { access: "denied", row };
  const installation = row.installationId ?? (await installationOf(env, owner, name));
  if (!installation) return { access: "not_connected", row };
  if (row.installationId && row.factsAt && row.factsAt > now() - FACTS_FOR) return { access: "allowed", row };
  const asked = await askGitHub(env, owner, name, s.token).catch(() => null);
  const facts = asked?.status === "ok" ? asked.facts : null;
  const updated = await drizzle(env.DB)
    .update(repositories)
    .set({
      status: "private",
      isPrivate: true,
      facts: facts ? JSON.stringify(facts) : row.facts,
      factsAt: now(),
      sizeKb: facts?.sizeKb ?? row.sizeKb,
      githubId: row.githubId ?? (asked?.status === "ok" ? asked.githubId : null),
      installationId: installation,
      connectedBy: row.connectedBy ?? s.userId,
    })
    .where(eq(repositories.id, row.id))
    .returning()
    .get();
  return { access: "allowed", row: updated };
}

/** The last Build of a repository. */
export async function lastBuild(env: Env, id: string) {
  return drizzle(env.DB).select().from(builds).where(eq(builds.repoId, id)).orderBy(desc(builds.requestedAt)).limit(1).get();
}

/** Whether a Build is under way, or failed too recently to try again. */
export function busy(build: Pick<typeof builds.$inferSelect, "state" | "reason" | "requestedAt" | "finishedAt"> | undefined, at = now()): boolean {
  if (!build) return false;
  if (build.state === "queued" || build.state === "running") return build.requestedAt > at - BUILD_LOST_AFTER;
  if (build.state === "failed") return build.reason !== "paused" && (build.finishedAt ?? build.requestedAt) > at - RETRY_AFTER;
  return false;
}

export function lookupOf(row: Row, build: Awaited<ReturnType<typeof lastBuild>>, seen: Lookup["access"] = "public", at = now()): Lookup {
  const visible = row.status === "ok" || seen === "allowed";
  const stale = !!row.reportAt && row.reportAt < at - REPORT_FOR;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    // Nothing of a repository GitHub keeps private is said to anyone it is not shown to.
    status: visible ? (row.status as Lookup["status"]) : seen === "not_connected" ? "private" : "not_found",
    facts: visible && row.facts ? JSON.parse(row.facts) : null,
    report: visible && row.reportKey ? { at: row.reportAt ?? 0, bytes: row.reportBytes ?? 0, lines: row.reportLines ?? true } : null,
    build:
      visible && build
        ? {
            id: build.id,
            state: build.state as NonNullable<Lookup["build"]>["state"],
            step: (build.step as NonNullable<Lookup["build"]>["step"]) ?? null,
            reason: (build.reason as NonNullable<Lookup["build"]>["reason"]) ?? null,
            requestedAt: build.requestedAt,
          }
        : null,
    stale,
    canBuild: visible && (!row.reportKey || stale) && !busy(build, at),
    access: seen,
  };
}

/** What a request may know of a repository, and the row it is about. */
export async function resolve(request: Request, env: Env, owner: string, name: string): Promise<{ row: Row; access: Lookup["access"] } | null> {
  const row = await known(env, owner, name, address(request));
  if (!row) return null;
  if (row.status === "ok" && !row.installationId) return { row, access: "public" };
  const s = await session(request, env);
  if (!s) return { row, access: "signed_out" };
  return connected(env, s, owner, name, row);
}

export async function lookup(request: Request, env: Env, owner: string, name: string): Promise<Response> {
  if (!repoId(owner, name)) return says(400, "That is not a GitHub repository's name.");
  const found = await resolve(request, env, owner, name).catch((e: unknown) => {
    if (e instanceof TooManyLookups) return "limited" as const;
    throw e;
  });
  if (found === "limited") return says(429, "This address has looked up many repositories this hour. Try again later.");
  if (!found) return says(503, "GitHub could not be asked just now. Try again in a moment.");
  return json(lookupOf(found.row, await lastBuild(env, found.row.id), found.access));
}

/** The Cron Trigger's part: names GitHub had no repository for, a week on. */
export async function forgetMissing(env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM repositories WHERE status = 'not_found' AND report_key IS NULL AND installation_id IS NULL AND seed = 0 AND facts_at < ?1",
  )
    .bind(now() - NOT_FOUND_FOR)
    .run();
}
