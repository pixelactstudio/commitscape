import "@tanstack/react-start/server-only";
import { and, desc, eq } from "drizzle-orm";
import { FAILURE_WORDS, type Lookup } from "@commitscape/data";
import {
  busy,
  commitsKey,
  installationOf,
  now,
  PRIORITY,
  queueBuild,
  readCard,
  readEntry,
  readIndex,
  REPORT_FOR,
  repoId,
  schema,
  waitingBuilds,
  type Db,
  type GitHubApp,
  type Queue,
  type ReportIndex,
  type Storage,
} from "@commitscape/server";
import { askGitHub, asUser, type GitHubConfig } from "./github";
import { SiteError } from "./http";
import { allow } from "./limits";

const { access, builds, repositories } = schema;

export type Deps = { db: Db; storage: Storage; github: GitHubConfig; app: GitHubApp | null; queue: () => Promise<Queue> };

export type Viewer = {
  address: string;
  sameOrigin: boolean;
  session: () => Promise<{ id: string; userId: string } | null>;
  token: () => Promise<string | null>;
};

export type Row = typeof repositories.$inferSelect;

export const LOOKUP_LIMIT = { action: "lookup", max: 300, seconds: 3600 };
export const BUILD_LIMIT = { action: "build", max: 20, seconds: 3600 };
export const WAITING_MAX = 30;
export const FACTS_FOR = 3600;
export const ACCESS_FOR = 300;

const NOT_A_NAME = "That is not a GitHub repository's name.";
const NO_REPORT = "No Report of this repository yet.";

function idOf(owner: string, name: string): string {
  const id = repoId(owner, name);
  if (!id || owner.startsWith("-")) throw new SiteError(400, NOT_A_NAME);
  return id;
}

async function rowOf(db: Db, id: string): Promise<Row | undefined> {
  const [row] = await db.select().from(repositories).where(eq(repositories.id, id));
  return row;
}

/** A repository's row, with GitHub's facts asked again when they are an hour old. */
export async function known(deps: Deps, owner: string, name: string, address?: string): Promise<Row | null> {
  const id = idOf(owner, name);
  const row = await rowOf(deps.db, id);
  if (row && (row.installationId || (row.factsAt && row.factsAt > now() - FACTS_FOR))) return row;
  if (address && !(await allow(deps.db, LOOKUP_LIMIT, address))) {
    if (row) return row;
    throw new SiteError(429, "This address has looked up many repositories this hour. Try again later.");
  }
  const asked = await askGitHub(deps.github, owner, name).catch(() => null);
  if (!asked) return row ?? null;
  const another = !!row?.githubId && !!asked.githubId && row.githubId !== asked.githubId;
  if (another && row?.reportKey) await deps.storage.deletePrefix(`${row.reportKey}/`);
  const fields = {
    githubId: asked.githubId ?? row?.githubId ?? null,
    ...(another ? { reportKey: null, reportAt: null, reportBytes: null, reportLines: null, cardKey: null } : {}),
    status: asked.status,
    isPrivate: asked.status === "private",
    facts: asked.status === "ok" ? JSON.stringify(asked.facts) : null,
    factsAt: now(),
    sizeKb: asked.status === "ok" ? asked.facts.sizeKb : null,
    owner: row?.owner ?? owner,
    name: row?.name ?? name,
  };
  const [saved] = await deps.db.insert(repositories).values({ id, ...fields }).onConflictDoUpdate({ target: repositories.id, set: fields }).returning();
  return saved ?? null;
}

/** Whether GitHub shows the signed-in person this repository, remembered for five minutes. */
export async function canSee(deps: Deps, sessionId: string, token: string, owner: string, name: string, githubId?: number | null): Promise<boolean> {
  const id = `${owner}/${name}`.toLowerCase();
  const [kept] = await deps.db
    .select()
    .from(access)
    .where(and(eq(access.sessionId, sessionId), eq(access.repoId, id)));
  if (kept && kept.until > now()) return kept.allowed;
  const answer = await asUser(deps.github, token, `/repos/${owner}/${name}`);
  let allowed = answer.ok;
  if (allowed && githubId) allowed = ((await answer.json().catch(() => null)) as { id?: unknown } | null)?.id === githubId;
  const until = now() + ACCESS_FOR;
  await deps.db
    .insert(access)
    .values({ sessionId, repoId: id, allowed, until })
    .onConflictDoUpdate({ target: [access.sessionId, access.repoId], set: { allowed, until } });
  return allowed;
}

async function connected(deps: Deps, viewer: Viewer, owner: string, name: string, row: Row): Promise<{ access: Lookup["access"]; row: Row }> {
  const s = await viewer.session();
  const token = s ? await viewer.token() : null;
  if (!s || !token) return { access: "signed_out", row };
  if (!(await canSee(deps, s.id, token, owner, name, row.githubId))) return { access: "denied", row };
  const installation = row.installationId ?? (await installationOf(deps.app, owner, name));
  if (!installation) return { access: "not_connected", row };
  if (row.installationId && row.factsAt && row.factsAt > now() - FACTS_FOR) return { access: "allowed", row };
  const asked = await askGitHub(deps.github, owner, name, token).catch(() => null);
  const facts = asked?.status === "ok" ? asked.facts : null;
  const [updated] = await deps.db
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
    .returning();
  return { access: "allowed", row: updated ?? row };
}

export async function lastBuild(db: Db, id: string) {
  const [build] = await db.select().from(builds).where(eq(builds.repoId, id)).orderBy(desc(builds.requestedAt)).limit(1);
  return build;
}

export function lookupOf(row: Row, build: Awaited<ReturnType<typeof lastBuild>>, seen: Lookup["access"] = "public", at = now()): Lookup {
  const visible = row.status === "ok" || seen === "allowed";
  const stale = !!row.reportAt && row.reportAt < at - REPORT_FOR;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    status: visible ? (row.status as Lookup["status"]) : seen === "not_connected" ? "private" : "not_found",
    facts: visible && row.facts ? (JSON.parse(row.facts) as Lookup["facts"]) : null,
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

/** A repository's row and what the viewer may know of it. */
export async function resolve(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<{ row: Row; access: Lookup["access"] }> {
  const row = await known(deps, owner, name, viewer.address);
  if (!row) throw new SiteError(503, "GitHub could not be asked just now. Try again in a moment.");
  if (row.status === "ok" && !row.installationId) return { row, access: "public" };
  return connected(deps, viewer, owner, name, row);
}

/** What the Site knows of a repository: GitHub's facts, its Report and its last Build. */
export async function lookup(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Lookup> {
  const { row, access: seen } = await resolve(deps, viewer, owner, name);
  return lookupOf(row, await lastBuild(deps.db, row.id), seen);
}

/** Starts a Build when the Report is missing or a day old, within the rate limits. */
export async function requestBuild(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Lookup> {
  const { row, access: seen } = await resolve(deps, viewer, owner, name);
  const state = lookupOf(row, await lastBuild(deps.db, row.id), seen);
  if (seen === "not_connected") throw new SiteError(403, FAILURE_WORDS.private);
  if (state.status === "not_found") throw new SiteError(404, FAILURE_WORDS.not_found);
  if (!state.canBuild) return state;
  if (!viewer.sameOrigin) throw new SiteError(403, "Not from this Site.");
  if (!(await allow(deps.db, BUILD_LIMIT, viewer.address))) throw new SiteError(429, "This address has asked for many Builds this hour. Try again later.");
  if ((await waitingBuilds(deps.db)) >= WAITING_MAX) throw new SiteError(503, "The Builder has many repositories to read just now. Try again in a few minutes.");
  const queue = await deps.queue().catch(() => null);
  if (queue) await queueBuild(deps.db, queue, row.id, PRIORITY.person);
  else await deps.db.insert(builds).values({ id: crypto.randomUUID(), repoId: row.id, state: "failed", reason: "paused", requestedAt: now(), finishedAt: now() });
  return lookupOf(row, await lastBuild(deps.db, row.id), seen);
}

async function readable(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Row & { reportKey: string }> {
  const id = idOf(owner, name);
  let row = await rowOf(deps.db, id);
  if (row && !row.installationId && (row.factsAt ?? 0) < now() - FACTS_FOR) row = (await known(deps, owner, name)) ?? row;
  if (!row?.reportKey) throw new SiteError(404, NO_REPORT);
  if (row.isPrivate || row.installationId) {
    const s = await viewer.session();
    const token = s ? await viewer.token() : null;
    if (row.isPrivate && (!s || !token || !(await canSee(deps, s.id, token, owner, name, row.githubId)))) throw new SiteError(404, NO_REPORT);
  } else if (row.status !== "ok") {
    throw new SiteError(404, NO_REPORT);
  }
  if ((row.viewedAt ?? 0) < now() - 3600) await deps.db.update(repositories).set({ viewedAt: now() }).where(eq(repositories.id, id));
  return row as Row & { reportKey: string };
}

export type ReportHead = { at: number; index: ReportIndex; private: boolean };

/** A readable Report's index and when it was built. */
export async function reportHead(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<ReportHead> {
  const row = await readable(deps, viewer, owner, name);
  const index = await readIndex(deps.storage, row.reportKey);
  if (!index) throw new SiteError(404, NO_REPORT);
  return { at: row.reportAt ?? 0, index, private: row.isPrivate };
}

/** One answer of a Report the viewer may read. */
export async function reportEntry(deps: Deps, viewer: Viewer, owner: string, name: string, key: string): Promise<unknown> {
  const row = await readable(deps, viewer, owner, name);
  return readEntry(deps.storage, row.reportKey, key);
}

/** A readable Report's Commit List, gzipped as stored. */
export async function reportCommits(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<{ body: Uint8Array; private: boolean }> {
  const row = await readable(deps, viewer, owner, name);
  const object = await deps.storage.get(commitsKey(row.reportKey));
  if (!object) throw new SiteError(404, NO_REPORT);
  return { body: object.body, private: row.isPrivate };
}

/** A readable Report's card for a Window. */
export async function reportCard(deps: Deps, viewer: Viewer, owner: string, name: string, window: string): Promise<string> {
  const row = await readable(deps, viewer, owner, name);
  const svg = await readCard(deps.storage, row.reportKey, window);
  if (!svg) throw new SiteError(404, "No card for that Window.");
  return svg;
}

/** A public repository's card image, for social previews. */
export async function publicCard(deps: Deps, owner: string, name: string): Promise<{ body: Uint8Array; type: string } | null> {
  const row = await rowOf(deps.db, idOf(owner, name));
  if (!row?.cardKey || row.status !== "ok" || row.isPrivate) return null;
  const object = await deps.storage.get(row.cardKey);
  return object ? { body: object.body, type: object.type ?? "image/png" } : null;
}
