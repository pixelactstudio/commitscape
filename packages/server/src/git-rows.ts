import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { GIT_FORMAT, OTHER_TAGS, openBranchesOf, tagFamilyOf, type GitBranchDetail, type GitBranches, type GitBranchInsight, type GitConflict, type GitHolder } from "@commitscape/data";
import type { Db } from "./db/client";
import { indexPeople, indexPersons, pullRequests, repoBlobs, repoBranchDetails, repoBranches, repoGit, repoTags, repositories } from "./db/schema";

export type KeptBlob = { lines: number; binary: boolean };

const CHUNK = 1000;

async function chunked<T>(rows: T[], insert: (part: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/** Replaces a repository's branches, tags and the details of its unmerged branches with what its Build just read. */
export async function writeBranches(db: Db, repoId: string, found: GitBranches, details: Map<number, GitBranchDetail>): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.delete(repoBranches).where(eq(repoBranches.repoId, repoId));
    await t.delete(repoBranchDetails).where(eq(repoBranchDetails.repoId, repoId));
    await t.delete(repoTags).where(eq(repoTags.repoId, repoId));
    await chunked(
      found.branches.map((b, position) => ({ repoId, position, ...b })),
      (part) => t.insert(repoBranches).values(part),
    );
    await chunked(
      [...details].map(([position, d]) => ({ repoId, position, against: d.against, commits: d.commits, commitsTotal: d.commitsTotal, files: d.files, filesTotal: d.filesTotal, added: d.added, removed: d.removed })),
      (part) => t.insert(repoBranchDetails).values(part),
    );
    await chunked(
      found.tags.map((tag, position) => ({ repoId, position, ...tag })),
      (part) => t.insert(repoTags).values(part),
    );
  });
}

export type BranchPerson = { login: string | null; bot: boolean };

const BOT_NAME = /\[bot\]$|^dependabot|^renovate|^github-actions|^greenkeeper|^snyk-bot/i;

/** Whether a branch's tip was made by a bot, by its author's name or login. */
export const isBotAuthor = (name: string, login: string | null): boolean => BOT_NAME.test(name) || (login ?? "").endsWith("[bot]");

/** Who each author name in a repository's live Stored Index is, by the name in lower case: their GitHub login (the one of the person with most commits when names are shared) and whether they are a bot. */
export async function branchPeople(db: Db, repoId: string): Promise<Map<string, BranchPerson>> {
  const [repo] = await db.select({ si: repositories.indexId }).from(repositories).where(eq(repositories.id, repoId));
  if (!repo?.si) return new Map();
  const rows = await db
    .selectDistinctOn([sql`lower(${indexPeople.name})`], { name: sql<string>`lower(${indexPeople.name})`, login: indexPeople.login, bot: indexPeople.bot })
    .from(indexPeople)
    .leftJoin(indexPersons, and(eq(indexPersons.si, indexPeople.si), eq(indexPersons.person, indexPeople.person)))
    .where(eq(indexPeople.si, repo.si))
    .orderBy(sql`lower(${indexPeople.name})`, sql`${indexPeople.login} is null`, sql`${indexPersons.commits} desc nulls last`);
  return new Map(rows.map((r) => [r.name, { login: r.login, bot: r.bot }]));
}

/** Branches with their tips' logins filled in from the Stored Index's people where the email did not name one, and bots marked. */
export function withPeople<B extends { author: string; login: string | null; bot?: boolean }>(branches: B[], people: ReadonlyMap<string, BranchPerson>): B[] {
  return branches.map((b) => {
    const p = people.get(b.author.toLowerCase());
    const login = b.login ?? p?.login ?? null;
    return { ...b, login, bot: (p?.bot ?? false) || isBotAuthor(b.author, login) };
  });
}

/** How many commits touched each file at HEAD in a repository's live Stored Index, by path, Merge Commits left out. */
export async function headChurn(db: Db, repoId: string): Promise<Map<string, number>> {
  const [repo] = await db.select({ si: repositories.indexId }).from(repositories).where(eq(repositories.id, repoId));
  if (!repo?.si) return new Map();
  const result = await db.execute(sql`
    SELECT f.path, count(*)::int AS n
    FROM index_commits c CROSS JOIN LATERAL unnest(c.files) AS u(file)
    JOIN index_files f ON f.si = c.si AND f.file = u.file
    WHERE c.si = ${repo.si} AND f.alive AND (c.flags & 1) = 0
    GROUP BY f.path`);
  const rows = (result as unknown as { rows?: { path: string; n: number }[] }).rows ?? [];
  return new Map(rows.map((r) => [r.path, Number(r.n)]));
}

type BranchRow = typeof repoBranches.$inferSelect;

async function withPulls(db: Db, repoId: string, root: string, rows: BranchRow[]) {
  const owner = (repoId.split("/")[0] ?? "").toLowerCase();
  const pulls = await db
    .select({ head: pullRequests.headRef, number: pullRequests.number, state: pullRequests.state, title: pullRequests.title, mergedAt: pullRequests.mergedAt, updatedAt: pullRequests.updatedAt, headOwner: pullRequests.headOwner, fork: pullRequests.fromFork, draft: pullRequests.draft })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoId, repoId),
        inArray(pullRequests.headRef, rows.map((b) => b.name)),
        sql`(${pullRequests.headOwner} = ${owner} OR (${pullRequests.headOwner} IS NULL AND ${pullRequests.fromFork} IS NOT TRUE))`,
      ),
    );
  const rank = (p: (typeof pulls)[number]) => (p.headOwner === owner ? 2 : 0) + (p.state === "OPEN" ? 1 : 0);
  const pullOf = new Map<string, (typeof pulls)[number]>();
  for (const p of pulls) {
    if (!p.head) continue;
    const had = pullOf.get(p.head);
    if (!had || rank(p) > rank(had) || (rank(p) === rank(had) && p.updatedAt > had.updatedAt)) pullOf.set(p.head, p);
  }
  return rows.map(({ repoId: _repoId, ...b }) => {
    const p = b.name === root ? undefined : pullOf.get(b.name);
    const pull = p ? { number: p.number, state: p.state, title: p.title, mergedAt: p.mergedAt, draft: p.draft } : null;
    const tookIt = pull?.state === "MERGED" && pull.mergedAt !== null && b.at <= pull.mergedAt;
    return { ...b, merged: b.merged || tookIt, squashed: b.squashed || (tookIt && b.ahead > 0), pull };
  });
}

/** A repository's branches and tags as the Branches screen reads them, or null when its Builds have read none. */
export async function readBranches(db: Db, repoId: string): Promise<GitBranches | null> {
  const [git] = await db.select().from(repoGit).where(eq(repoGit.repoId, repoId));
  if (!git) return null;
  const [rows, tags, kept] = await Promise.all([
    db.select().from(repoBranches).where(eq(repoBranches.repoId, repoId)).orderBy(asc(repoBranches.position)),
    db.select().from(repoTags).where(eq(repoTags.repoId, repoId)).orderBy(asc(repoTags.position)),
    db
      .select({ position: repoBranchDetails.position, ticks: sql<number[]>`(SELECT coalesce(jsonb_agg(c->'at' ORDER BY (c->>'at')::bigint), '[]'::jsonb) FROM jsonb_array_elements(${repoBranchDetails.commits}) AS c)` })
      .from(repoBranchDetails)
      .where(eq(repoBranchDetails.repoId, repoId)),
  ]);
  if (rows.length === 0) return null;
  const [branches, since] = await Promise.all([withPulls(db, repoId, git.branch, rows), tagsSince(db, repoId, tags)]);
  const ticksOf = new Map(kept.map((k) => [k.position, k.ticks]));
  return {
    v: GIT_FORMAT,
    builtAt: git.builtAt,
    default: git.branch,
    head: git.head,
    total: git.branchesTotal,
    inferred: git.inferred,
    branches: branches.map(({ position, ...b }) => {
      const ticks = ticksOf.get(position);
      return ticks && ticks.length > 0 ? { ...b, ticks } : b;
    }),
    tags: tags.map((t) => {
      const n = since.get(t.sha);
      return { name: t.name, sha: t.sha, at: t.at, ...(n === undefined ? {} : { since: n }) };
    }),
    tagsTotal: git.tagsTotal,
  };
}

/** How many branches of a repository are open, as the Branches screen counts them: other than the default branch, not merged, and not a bot's. */
export async function readOpenBranches(db: Db, repoId: string): Promise<number> {
  const [git] = await db.select({ branch: repoGit.branch }).from(repoGit).where(eq(repoGit.repoId, repoId));
  if (!git) return 0;
  const rows = await db.select().from(repoBranches).where(eq(repoBranches.repoId, repoId));
  if (rows.length === 0) return 0;
  return openBranchesOf({ branches: await withPulls(db, repoId, git.branch, rows), default: git.branch });
}

async function tagsSince(db: Db, repoId: string, tags: { name: string; sha: string }[]): Promise<Map<string, number>> {
  const [repo] = await db.select({ si: repositories.indexId }).from(repositories).where(eq(repositories.id, repoId));
  const newest = new Map<string, string>();
  for (const t of tags) {
    const { key } = tagFamilyOf(t.name);
    if (key !== OTHER_TAGS && !newest.has(key)) newest.set(key, t.sha);
  }
  if (!repo?.si || newest.size === 0) return new Map();
  const shas = [...new Set(newest.values())];
  const [tagged, landed] = await Promise.all([
    db.execute(sql`SELECT encode(sha, 'hex') AS sha, arrival FROM index_commits WHERE si = ${repo.si} AND (flags & 8) = 8 AND arrival IS NOT NULL AND sha = ANY (SELECT decode(x, 'hex') FROM unnest(${sql.param(shas)}::text[]) AS x)`),
    db.execute(sql`SELECT arrival FROM index_commits WHERE si = ${repo.si} AND (flags & 9) = 8 AND arrival IS NOT NULL ORDER BY arrival`),
  ]);
  const arrivals = rowsOf<{ arrival: number | string }>(landed).map((r) => Number(r.arrival));
  const out = new Map<string, number>();
  for (const r of rowsOf<{ sha: string; arrival: number | string }>(tagged)) {
    const at = Number(r.arrival);
    let lo = 0;
    let hi = arrivals.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((arrivals[mid] ?? 0) <= at) lo = mid + 1;
      else hi = mid;
    }
    out.set(r.sha, arrivals.length - lo);
  }
  return out;
}

const rowsOf = <T>(result: unknown): T[] => (result as { rows?: T[] } | null)?.rows ?? [];

/** The commits and files of one unmerged branch, by its place in the list, or null when they were not read. */
export async function readBranchDetail(db: Db, repoId: string, position: number): Promise<GitBranchDetail | null> {
  const [[d], [b]] = await Promise.all([
    db.select().from(repoBranchDetails).where(and(eq(repoBranchDetails.repoId, repoId), eq(repoBranchDetails.position, position))),
    db.select({ name: repoBranches.name }).from(repoBranches).where(and(eq(repoBranches.repoId, repoId), eq(repoBranches.position, position))),
  ]);
  if (!d || !b) return null;
  return { v: GIT_FORMAT, name: b.name, against: d.against, commits: d.commits, commitsTotal: d.commitsTotal, files: d.files, filesTotal: d.filesTotal, added: d.added, removed: d.removed };
}

const HOLDERS_KEPT = 6;
const CONFLICTS_KEPT = 30;
const MAINTAINER_COMMITS = 3;
const MAINTAINER_DAYS = 90;
const MAINLINE_COMMITS = "(c.flags & 13) = 8";
const DAY = 86_400;

/** Reads who holds the files a branch changes and which the default branch changed after the branch left it; null when its files were not kept. */
export async function readBranchInsight(db: Db, repoId: string, position: number): Promise<GitBranchInsight | null> {
  const [repo] = await db.select({ si: repositories.indexId }).from(repositories).where(eq(repositories.id, repoId));
  const [[d], [b], [git]] = await Promise.all([
    db.select({ files: repoBranchDetails.files }).from(repoBranchDetails).where(and(eq(repoBranchDetails.repoId, repoId), eq(repoBranchDetails.position, position))),
    db.select({ name: repoBranches.name, baseAt: repoBranches.baseAt }).from(repoBranches).where(and(eq(repoBranches.repoId, repoId), eq(repoBranches.position, position))),
    db.select({ builtAt: repoGit.builtAt }).from(repoGit).where(eq(repoGit.repoId, repoId)),
  ]);
  if (!repo?.si || !d || !b || !git) return null;
  const si = repo.si;
  const paths = d.files.map((f) => f.path);
  const named = rowsOf<{ file: number; path: string; alive: boolean }>(
    await db.execute(sql`
      SELECT file, path, alive FROM index_files WHERE si = ${si} AND path = ANY (${sql.param(paths)}::text[])
      UNION
      SELECT file, path, false AS alive FROM index_file_paths WHERE si = ${si} AND path = ANY (${sql.param(paths)}::text[])`),
  );
  const pathOf = new Map<number, string>();
  for (const n of named) if (!pathOf.has(n.file)) pathOf.set(n.file, n.path);
  const files = [...pathOf.keys()];
  const atHead = [...new Set(named.filter((n) => n.alive).map((n) => n.path))];
  const base: GitBranchInsight = { v: GIT_FORMAT, name: b.name, forkedAt: b.baseAt, touched: paths.length, known: files.length, atHead, landed: 0, holders: [], conflicts: [], conflictCommits: 0 };
  if (files.length === 0) return base;
  const list = sql.param(files);
  const recent = git.builtAt - MAINTAINER_DAYS * DAY;
  const [perFile, perPerson, active, landedRows, conflictRows, meetingRows] = await Promise.all([
    db.execute(sql`
      WITH who AS (
        SELECT person, max(coalesce(person_name, name)) AS name, max(login) AS login, bool_or(bot) AS bot
        FROM index_people WHERE si = ${si} AND person IS NOT NULL GROUP BY person)
      SELECT per.file, per.person, per.n, who.name, who.login, who.bot FROM (
        SELECT u.file, p.person, count(*)::int AS n
        FROM index_commits c CROSS JOIN LATERAL unnest(c.files) AS u(file)
        JOIN index_people p ON p.si = c.si AND p.signature = c.signature
        WHERE c.si = ${si} AND ${sql.raw(MAINLINE_COMMITS)} AND u.file = ANY (${list}::int[]) AND p.person IS NOT NULL
        GROUP BY u.file, p.person) per
      JOIN who ON who.person = per.person`),
    db.execute(sql`
      SELECT p.person, count(*)::int AS n, max(c.at) AS last
      FROM index_commits c JOIN index_people p ON p.si = c.si AND p.signature = c.signature
      WHERE c.si = ${si} AND ${sql.raw(MAINLINE_COMMITS)} AND c.files && ${list}::int[] AND p.person IS NOT NULL
      GROUP BY p.person`),
    db.execute(sql`
      SELECT p.person FROM index_commits c JOIN index_people p ON p.si = c.si AND p.signature = c.signature
      WHERE c.si = ${si} AND c.at > ${recent} AND c.at <= ${git.builtAt} AND (c.flags & 1) = 0 AND p.person IS NOT NULL
      GROUP BY p.person HAVING count(*) >= ${MAINTAINER_COMMITS}`),
    b.baseAt > 0
      ? db.execute(sql`SELECT count(*)::int AS n FROM index_commits c WHERE c.si = ${si} AND (c.flags & 9) = 8 AND c.arrival > ${b.baseAt}`)
      : Promise.resolve(null),
    b.baseAt > 0
      ? db.execute(sql`
          SELECT u.file, count(*)::int AS commits, max(c.arrival) AS last, (array_agg(c.signature ORDER BY c.arrival DESC))[1] AS signature
          FROM index_commits c CROSS JOIN LATERAL unnest(c.files) AS u(file)
          WHERE c.si = ${si} AND (c.flags & 9) = 8 AND c.arrival > ${b.baseAt} AND u.file = ANY (${list}::int[])
          GROUP BY u.file ORDER BY commits DESC, last DESC LIMIT ${CONFLICTS_KEPT}`)
      : Promise.resolve(null),
    b.baseAt > 0
      ? db.execute(sql`SELECT count(*)::int AS n FROM index_commits c WHERE c.si = ${si} AND (c.flags & 9) = 8 AND c.arrival > ${b.baseAt} AND c.files && ${list}::int[]`)
      : Promise.resolve(null),
  ]);
  const people = new Map<number, { name: string; login: string | null; bot: boolean }>();
  const top = new Map<number, { person: number; n: number }>();
  for (const r of rowsOf<{ file: number; person: number; n: number; name: string; login: string | null; bot: boolean }>(perFile)) {
    people.set(r.person, { name: r.name, login: r.login, bot: r.bot });
    if (r.bot) continue;
    const had = top.get(r.file);
    if (!had || r.n > had.n) top.set(r.file, { person: r.person, n: r.n });
  }
  const held = new Map<number, number>();
  for (const { person } of top.values()) held.set(person, (held.get(person) ?? 0) + 1);
  const maintainers = new Set(rowsOf<{ person: number }>(active).map((r) => r.person));
  const holders: GitHolder[] = rowsOf<{ person: number; n: number; last: number | string }>(perPerson)
    .flatMap((r) => {
      const who = people.get(r.person);
      return who && !who.bot ? [{ name: who.name, login: who.login, files: held.get(r.person) ?? 0, commits: r.n, last: Number(r.last), maintainer: maintainers.has(r.person) }] : [];
    })
    .sort((x, y) => y.files - x.files || y.commits - x.commits || y.last - x.last)
    .slice(0, HOLDERS_KEPT);
  const rows = rowsOf<{ file: number; commits: number; last: number | string; signature: number }>(conflictRows);
  const signers = rows.length === 0 ? [] : rowsOf<{ signature: number; name: string; login: string | null }>(await db.execute(sql`SELECT signature, coalesce(person_name, name) AS name, login FROM index_people WHERE si = ${si} AND signature = ANY (${sql.param(rows.map((r) => r.signature))}::int[])`));
  const signer = new Map(signers.map((x) => [x.signature, x]));
  const conflicts: GitConflict[] = rows.map((r) => {
    const who = signer.get(r.signature);
    return { path: pathOf.get(r.file) ?? "", commits: r.commits, last: Number(r.last), name: who?.name ?? null, login: who?.login ?? null };
  });
  return { ...base, landed: rowsOf<{ n: number }>(landedRows)[0]?.n ?? 0, holders, conflicts, conflictCommits: rowsOf<{ n: number }>(meetingRows)[0]?.n ?? 0 };
}

/** The blobs of a repository's files whose text is kept, or that were found to be binary, by blob id. */
export async function readBlobs(db: Db, repoId: string): Promise<Map<string, KeptBlob>> {
  const rows = await db.select().from(repoBlobs).where(eq(repoBlobs.repoId, repoId));
  return new Map(rows.map((r) => [r.sha, { lines: r.lines, binary: r.binary }]));
}

/** Replaces the record of a repository's kept blobs. */
export async function writeBlobs(db: Db, repoId: string, blobs: Map<string, KeptBlob>): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.delete(repoBlobs).where(eq(repoBlobs.repoId, repoId));
    await chunked(
      [...blobs].map(([sha, b]) => ({ repoId, sha, lines: b.lines, binary: b.binary })),
      (part) => t.insert(repoBlobs).values(part),
    );
  });
}
