import "@tanstack/react-start/server-only";
import { and, desc, eq } from "drizzle-orm";
import { FAILURE_WORDS, key as keyOf, limited, NOT_IN_REPORT, topOf, withoutTop, type Lookup } from "@commitscape/data";
import {
  busy,
  cachedGet,
  currentAt,
  installationOf,
  now,
  PRIORITY,
  queueBuild,
  readEntry,
  readIndex,
  reportIndexOf,
  REPORT_FOR,
  repoId,
  repoNamed,
  schema,
  settleRepository,
  sha256,
  waitingBuilds,
  type Db,
  type GitHubApp,
  type Queue,
  type ReportIndex,
  type Storage,
} from "@commitscape/server";
import { lendToken } from "@commitscape/server";
import { apiOf, askGitHub, GITHUB_TTL, type GitHubConfig } from "./github";
import { SiteError } from "./http";
import { allow, RANGE_LIMIT } from "./limits";
import { askedKey, isKept, isRange, keptEntry, keptText, packedOf, withPack, wholeDays } from "./answers";
import { answerTimed } from "./telemetry";
import type { EngineService } from "./engine-service";
import { jsonOf, type Packed } from "./packed";

const { access, builds, repoNames, repoPeople, repositories } = schema;

export type Deps = { db: Db; storage: Storage; github: GitHubConfig; app: GitHubApp | null; queue: () => Promise<Queue>; engine: EngineService; tokenSecret?: string };

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

/** The row a name leads to, following a repository that moved to another name. */
export async function rowOf(db: Db, id: string): Promise<Row | undefined> {
  const row = await repoNamed(db, id);
  if (!row) return undefined;
  const { movedAt: _, ...kept } = row;
  return kept;
}

function nameOf(fullName: string | undefined): { owner: string; name: string } | null {
  const [owner = "", name = "", more] = (fullName ?? "").split("/");
  return more === undefined && repoId(owner, name) ? { owner, name } : null;
}

async function settled(deps: Deps, row: Row): Promise<Row> {
  if (!row.githubId) return row;
  const twins = await deps.db.select().from(repositories).where(eq(repositories.githubId, row.githubId));
  const informed = twins.filter((t) => t.facts).sort((a, b) => (b.factsAt ?? 0) - (a.factsAt ?? 0))[0];
  const current = nameOf(informed?.facts ? (JSON.parse(informed.facts) as { fullName?: string }).fullName : undefined);
  if (twins.length <= 1 && (!current || repoId(current.owner, current.name) === row.id)) return row;
  return settleRepository(deps.db, deps.storage, { githubId: row.githubId, ...(current ?? { owner: row.owner, name: row.name }) });
}

/** A repository's row under its current name, with GitHub's facts asked again when an hour old (with the visitor's token if any); an old name of a renamed or moved repository leads to its row. */
export async function known(deps: Deps, owner: string, name: string, address?: string, token?: () => Promise<string | null>): Promise<Row | null> {
  const id = idOf(owner, name);
  const [own] = await deps.db.select().from(repositories).where(eq(repositories.id, id));
  const moved = own ? undefined : await repoNamed(deps.db, id);
  if (moved && (moved.movedAt ?? 0) > now() - FACTS_FOR) return known(deps, moved.owner, moved.name, address, token);
  const row: Row | undefined = own ?? moved;
  if (own && (own.installationId || (own.factsAt && own.factsAt > now() - FACTS_FOR))) return settled(deps, own);
  if (address && !(await allow(deps.db, LOOKUP_LIMIT, address))) {
    if (row) return row;
    throw new SiteError(429, "This address has looked up many repositories this hour. Try again later.");
  }
  const lent = await token?.().catch(() => null);
  const asked = await askGitHub(deps, owner, name, { token: lent }).catch(() => null);
  if (!asked) return row ?? null;
  if (asked.status === "ok" && asked.githubId) {
    const current = nameOf(asked.facts.fullName) ?? { owner, name };
    const facts = { status: "ok", isPrivate: false, facts: JSON.stringify(asked.facts), factsAt: now(), sizeKb: asked.facts.sizeKb };
    return settleRepository(deps.db, deps.storage, { githubId: asked.githubId, ...current, asked: id, set: facts });
  }
  if (moved) await deps.db.delete(repoNames).where(eq(repoNames.id, id));
  const fields = {
    status: asked.status,
    isPrivate: asked.status === "private",
    facts: asked.status === "ok" ? JSON.stringify(asked.facts) : null,
    factsAt: now(),
    sizeKb: asked.status === "ok" ? asked.facts.sizeKb : null,
    owner: own?.owner ?? owner,
    name: own?.name ?? name,
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
  const answer = await cachedGet<{ id?: unknown }>(deps.db, { url: `${apiOf(deps.github)}/repos/${owner}/${name}`, token, scope: `session:${sessionId}`, ttl: GITHUB_TTL.access, fetcher: deps.github.fetcher });
  let allowed = answer.status >= 200 && answer.status < 300;
  if (allowed && githubId) allowed = answer.body?.id === githubId;
  const until = now() + ACCESS_FOR;
  await deps.db
    .insert(access)
    .values({ sessionId, repoId: id, allowed, until })
    .onConflictDoUpdate({ target: [access.sessionId, access.repoId], set: { allowed, until } });
  return allowed;
}

async function connected(deps: Deps, viewer: Viewer, row: Row): Promise<{ access: Lookup["access"]; row: Row }> {
  const { owner, name } = row;
  const s = await viewer.session();
  const token = s ? await viewer.token() : null;
  if (!s || !token) return { access: "signed_out", row };
  if (!(await canSee(deps, s.id, token, owner, name, row.githubId))) return { access: "denied", row };
  const installation = row.installationId ?? (await installationOf(deps.app, owner, name));
  if (!installation) return { access: "not_connected", row };
  if (row.installationId && row.factsAt && row.factsAt > now() - FACTS_FOR) return { access: "allowed", row };
  const asked = await askGitHub(deps, owner, name, { token, scope: `user:${s.userId}` }).catch(() => null);
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
  const stale = (!!row.reportAt && currentAt(row) < at - REPORT_FOR) || (!!row.reportKey && row.reportLines === false);
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

const STORED_FOR = 3600;
const STORED_KEPT = 10_000;
const stored = new Map<string, number>();

/** The row with a Report the storage still holds: a Report written before the Builder kept its meta on the row is looked for in storage, and when its objects are gone (deleted, or never copied to a new bucket) its pointer is cleared, so the repository reads as never built and its next Build starts. */
export async function withStoredReport(deps: Pick<Deps, "db" | "storage">, row: Row): Promise<Row> {
  const key = row.reportKey;
  if (!key || row.reportMeta) return row;
  if ((stored.get(key) ?? 0) > now() - STORED_FOR) return row;
  if (await readIndex(deps.storage, key)) {
    if (stored.size >= STORED_KEPT) stored.clear();
    stored.set(key, now());
    return row;
  }
  const gone = { reportKey: null, reportAt: null, reportBytes: null, reportLines: null };
  const [cleared] = await deps.db
    .update(repositories)
    .set(gone)
    .where(and(eq(repositories.id, row.id), eq(repositories.reportKey, key)))
    .returning();
  return cleared ?? { ...row, ...gone };
}

/** A repository's row and what the viewer may know of it. */
export async function resolve(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<{ row: Row; access: Lookup["access"] }> {
  const found = await known(deps, owner, name, viewer.address, viewer.token);
  if (!found) throw new SiteError(503, "GitHub could not be asked just now. Try again in a moment.");
  const row = await withStoredReport(deps, found);
  if (row.status === "ok" && !row.installationId) return { row, access: "public" };
  return connected(deps, viewer, row);
}

/** What the Site knows of a repository: GitHub's facts, its Report and its last Build. */
export async function lookup(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Lookup> {
  const { row, access: seen } = await resolve(deps, viewer, owner, name);
  return lookupOf(row, await lastBuild(deps.db, row.id), seen);
}

/** Starts a Build when the Report is missing, a day old or read without lines, within the rate limits. */
export async function requestBuild(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Lookup> {
  const { row, access: seen } = await resolve(deps, viewer, owner, name);
  const state = lookupOf(row, await lastBuild(deps.db, row.id), seen);
  if (seen === "not_connected") throw new SiteError(403, FAILURE_WORDS.private);
  if (state.status === "not_found") throw new SiteError(404, FAILURE_WORDS.not_found);
  if (!state.canBuild) return state;
  const s = await viewer.session();
  if (!s) throw new SiteError(401, "Sign in to read this repository.");
  if (!viewer.sameOrigin) throw new SiteError(403, "Not from this Site.");
  if (!(await allow(deps.db, BUILD_LIMIT, viewer.address))) throw new SiteError(429, "This address has asked for many Builds this hour. Try again later.");
  if ((await waitingBuilds(deps.db)) >= WAITING_MAX) throw new SiteError(503, "The Builder has many repositories to read just now. Try again in a few minutes.");
  const queue = await deps.queue().catch(() => null);
  if (queue) {
    await queueBuild(deps.db, queue, row.id, PRIORITY.person, { userId: s.userId });
    if (deps.tokenSecret && !row.isPrivate) await lendToken(deps.db, deps.tokenSecret, row.id, s.userId, await viewer.token().catch(() => null));
  }
  else await deps.db.insert(builds).values({ id: crypto.randomUUID(), repoId: row.id, state: "failed", reason: "paused", requestedAt: now(), finishedAt: now() });
  return lookupOf(row, await lastBuild(deps.db, row.id), seen);
}

const refreshing = new Map<string, Promise<Row | null>>();
const viewed = new Map<string, number>();
const VIEWED_EVERY = 3600;
const VIEWED_KEPT = 10_000;

function refreshed(deps: Deps, viewer: Viewer, id: string, owner: string, name: string): Promise<Row | null> {
  let asked = refreshing.get(id);
  if (!asked) {
    asked = known(deps, owner, name, undefined, viewer.token).finally(() => refreshing.delete(id));
    refreshing.set(id, asked);
  }
  return asked;
}

async function sawView(deps: Deps, row: Row): Promise<void> {
  const at = now();
  if ((row.viewedAt ?? 0) >= at - VIEWED_EVERY || (viewed.get(row.id) ?? 0) >= at - VIEWED_EVERY) return;
  if (viewed.size >= VIEWED_KEPT) viewed.clear();
  viewed.set(row.id, at);
  await deps.db.update(repositories).set({ viewedAt: at }).where(eq(repositories.id, row.id));
}

/** The row of a Report the viewer may read, or a 404 when there is none or they may not; GitHub's facts are asked again once an hour by one request while the others wait for it. */
export async function readable(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<Row & { reportKey: string }> {
  const id = idOf(owner, name);
  let row = await rowOf(deps.db, id);
  if (row && !row.installationId && (row.factsAt ?? 0) < now() - FACTS_FOR) row = (await refreshed(deps, viewer, id, owner, name)) ?? row;
  if (!row?.reportKey) throw new SiteError(404, NO_REPORT);
  if (row.isPrivate || row.installationId) {
    const s = await viewer.session();
    const token = s ? await viewer.token() : null;
    if (row.isPrivate && (!s || !token || !(await canSee(deps, s.id, token, row.owner, row.name, row.githubId)))) throw new SiteError(404, NO_REPORT);
  } else if (row.status !== "ok") {
    throw new SiteError(404, NO_REPORT);
  }
  await sawView(deps, row);
  return row as Row & { reportKey: string };
}

export type ReportHead = { at: number; index: ReportIndex; private: boolean; logins: [number, string][]; ranges: boolean };

/** A readable Report's meta and stats (from the repository's row, or the R2 index of a Report not built since), when it was built, and the GitHub login of each of its people the Builder found. */
export async function reportHead(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<ReportHead> {
  const row = await readable(deps, viewer, owner, name);
  const [index, people] = await Promise.all([
    reportIndexOf(deps.storage, row),
    deps.db
      .select({ id: repoPeople.personId, login: repoPeople.login })
      .from(repoPeople)
      .where(and(eq(repoPeople.repoId, row.id), eq(repoPeople.reportKey, row.reportKey))),
  ]);
  if (!index) throw new SiteError(404, NO_REPORT);
  return { at: row.reportAt ?? 0, index, private: row.isPrivate, ranges: row.indexId !== null, logins: people.flatMap((p) => (p.login ? [[p.id, p.login] as [number, string]] : [])) };
}

const NOT_WHOLE_DAYS = "A range of dates goes from the start of one day to the end of another.";
const MANY_RANGES = "This address has asked for many date ranges this hour. Try one of the Report's Windows, or again later.";

const YEAR = 31_536_000;

export type SentAnswer = { packed: Packed | null; etag: string; cacheControl: string };

function questionOf(key: string): ReturnType<typeof askedKey> {
  const asked = askedKey(key);
  if (!asked.path.startsWith("/api/")) throw new SiteError(400, "That is not a question a Report answers.");
  if (isRange(asked.params) && !wholeDays(asked.params)) throw new SiteError(400, NOT_WHOLE_DAYS);
  return asked;
}

const admitting = (deps: Deps, viewer: Viewer) => async () => {
  if (!(await allow(deps.db, RANGE_LIMIT, viewer.address))) throw new SiteError(429, MANY_RANGES);
};

const fromReport = (deps: Deps, reportKey: string, asked: ReturnType<typeof askedKey>) => async () => {
  const found = await readEntry(deps.storage, reportKey, keyOf(asked.path, withoutTop(asked.params)));
  return found === null ? null : limited(asked.path, topOf(asked.params), found);
};

/** One answer of a pack as JSON packed to send, asked of the engine service once per pack and question; a range of dates not asked before counts against the address's limit. Null when there is no such answer. */
function packedAnswer(deps: Deps, viewer: Viewer, pack: string, asked: ReturnType<typeof askedKey>): Promise<Packed | null> {
  const kept = `${pack}#${asked.key}`;
  return keptText(
    kept,
    async () => {
      if (isRange(asked.params) && !isKept(kept)) await admitting(deps, viewer)();
      return deps.engine.answerText(pack, asked.path, asked.params);
    },
    5,
    "answer",
  );
}

/** One answer of a Report the viewer may read: from the engine service, which answers from its Stored Index's pack, else read from the stored Report of a repository not built since; a range of dates only as whole days and within the address's limit. */
export async function reportEntry(deps: Deps, viewer: Viewer, owner: string, name: string, key: string): Promise<unknown> {
  const started = performance.now();
  const row = await readable(deps, viewer, owner, name);
  const asked = questionOf(key);
  const found = await withPack(deps.db, row.indexId, (pack) => packedAnswer(deps, viewer, pack, asked), row.reportAt);
  if (found) {
    if (found.value === null) return null;
    const value = await jsonOf(found.value);
    answerTimed(asked.path, "engine", performance.now() - started);
    return value;
  }
  const kept = await keptEntry(`${row.reportKey}#${asked.key}`, fromReport(deps, row.reportKey, asked));
  if (kept) answerTimed(asked.path, "report", performance.now() - started);
  return kept?.value ?? null;
}

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

/** One answer of a Report the viewer may read as JSON packed to send, with its ETag and how long a browser may keep it: for good when `at` names the Report it is of. No body when `seen` is its ETag already. */
export async function reportAnswer(deps: Deps, viewer: Viewer, owner: string, name: string, key: string, at: number | null, seen?: string | null): Promise<SentAnswer> {
  const started = performance.now();
  const row = await readable(deps, viewer, owner, name);
  const asked = questionOf(key);
  const pinned = at !== null && at === row.reportAt;
  const cacheControl = row.isPrivate ? "private, max-age=60" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=60";
  const tagOf = (version: string) => `"${sha256(`${version}\n${asked.key}`).slice(0, 32)}"`;
  const found = await withPack(deps.db, row.indexId, async (pack) => {
    const etag = tagOf(pack);
    if (matches(seen, etag)) return { packed: null, etag };
    const made = await packedAnswer(deps, viewer, pack, asked);
    if (!made) throw new SiteError(404, NOT_IN_REPORT);
    return { packed: made, etag };
  }, row.reportAt);
  if (found) {
    answerTimed(asked.path, found.value.packed ? "engine" : "unchanged", performance.now() - started);
    return { ...found.value, cacheControl };
  }
  const etag = tagOf(row.reportKey);
  if (matches(seen, etag)) return { packed: null, etag, cacheControl };
  const kept = await keptEntry(`${row.reportKey}#${asked.key}`, fromReport(deps, row.reportKey, asked), true);
  if (!kept) throw new SiteError(404, NOT_IN_REPORT);
  const sent = { packed: await packedOf(kept), etag, cacheControl };
  answerTimed(asked.path, "report", performance.now() - started);
  return sent;
}
