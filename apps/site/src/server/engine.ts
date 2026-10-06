import "@tanstack/react-start/server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { EngineRepo, EngineView } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { allow } from "./limits";
import { canSee, type Deps, type Viewer } from "./repos";
import { isHidden } from "./people";

const { repoPeople, repositories, surviving } = schema;

export const COUNT_LIMIT = { action: "surviving", max: 60, seconds: 3600 };
export const LOST_AFTER = 30 * 60;
const ASKED_AT_ONCE = 12;
const ASKED_AGAIN = ["queued", "failed", "over_budget"];

/** Whether a person's Surviving Lines in a repository should be asked for: never asked, lost or unfinished half an hour on, or left uncounted by a Report read without lines once the repository has been read with them. */
export function wantsCount(count: { status: string; askedAt: number } | undefined, reportLines: boolean | null, at = now()): boolean {
  if (!count) return true;
  if (count.status === "not_counted") return reportLines !== false;
  return ASKED_AGAIN.includes(count.status) && count.askedAt < at - LOST_AFTER;
}

/** Asks the Builder to count some people's Surviving Lines in one repository, within the address's limit; false when it could not ask. */
export async function askCounts(deps: Deps, address: string, repoId: string, reportKey: string, personIds: number[]): Promise<boolean> {
  if (personIds.length === 0) return false;
  const queue = await deps.queue().catch(() => null);
  if (!queue?.count || !(await allow(deps.db, COUNT_LIMIT, address))) return false;
  for (const personId of personIds) {
    await deps.db
      .insert(surviving)
      .values({ repoId, reportKey, personId, status: "queued", askedAt: now() })
      .onConflictDoUpdate({ target: [surviving.repoId, surviving.reportKey, surviving.personId], set: { status: "queued", askedAt: now() } });
  }
  await queue.count({ repoId, reportKey, personIds });
  return true;
}

/** What the engine knows of a person in the repositories the Site has built: their Lines Changed, and their Surviving Lines once counted, asking for those not yet counted. */
export async function engineOf(deps: Deps, viewer: Viewer & { login: () => Promise<string | null> }, login: string): Promise<EngineView> {
  const rows = await deps.db
    .select({ person: repoPeople, repo: repositories })
    .from(repoPeople)
    .innerJoin(repositories, and(eq(repositories.id, repoPeople.repoId), eq(repositories.reportKey, repoPeople.reportKey)))
    .where(sql`lower(${repoPeople.login}) = ${login.toLowerCase()}`);
  const self = (await viewer.login().catch(() => null))?.toLowerCase() === login.toLowerCase();
  if (!self && (await isHidden(deps, login))) return { repos: [], surviving: null, added: null, counting: 0 };
  const visible: typeof rows = [];
  for (const r of rows) {
    if (!r.repo.isPrivate && r.repo.status === "ok") visible.push(r);
    else if (self) {
      const s = await viewer.session();
      const token = s ? await viewer.token() : null;
      if (s && token && (await canSee(deps, s.id, token, r.repo.owner, r.repo.name, r.repo.githubId))) visible.push(r);
    }
  }
  if (visible.length === 0) return { repos: [], surviving: null, added: null, counting: 0 };
  const newestOf = new Map<string, (typeof rows)[number]["repo"]>();
  const keyOf = (repo: (typeof rows)[number]["repo"]) => {
    const { owner, name } = currentName(repo);
    return `${owner}/${name}`.toLowerCase();
  };
  for (const v of visible) {
    const kept = newestOf.get(keyOf(v.repo));
    if (!kept || (v.repo.reportAt ?? 0) > (kept.reportAt ?? 0)) newestOf.set(keyOf(v.repo), v.repo);
  }
  const named = visible.filter((v) => newestOf.get(keyOf(v.repo))?.id === v.repo.id).map((v) => ({ ...v, ...currentName(v.repo) }));
  const counts = await deps.db
    .select()
    .from(surviving)
    .where(
      and(
        inArray(surviving.repoId, named.map((v) => v.repo.id)),
        inArray(surviving.personId, named.map((v) => v.person.personId)),
      ),
    );
  const countOf = (v: (typeof named)[number]) => counts.find((c) => c.repoId === v.repo.id && c.reportKey === v.person.reportKey && c.personId === v.person.personId);
  const wanted = named.filter((v) => wantsCount(countOf(v), v.repo.reportLines));
  const asked = new Set<string>();
  for (const v of wanted.slice(0, ASKED_AT_ONCE)) if (await askCounts(deps, viewer.address, v.repo.id, v.person.reportKey, [v.person.personId])) asked.add(v.repo.id);
  const repos: EngineRepo[] = named.map((v) => {
      const c = countOf(v);
      const status: EngineRepo["surviving"]["status"] = asked.has(v.repo.id) || c?.status === "queued" ? "counting" : c ? (c.status as EngineRepo["surviving"]["status"]) : "counting";
      return {
        owner: v.owner,
        name: v.name,
        private: v.repo.isPrivate,
        builtAt: v.repo.reportAt ?? 0,
        commits: v.person.commits,
        linesAdded: v.person.linesAdded,
        linesRemoved: v.person.linesRemoved,
        first: v.person.first,
        last: v.person.last,
        surviving: { status, lines: status === "counted" ? (c?.lines ?? null) : null, added: status === "counted" ? (c?.added ?? null) : null },
      };
    });
  const groups = new Map<string, EngineRepo[]>();
  for (const r of repos) groups.set(`${r.owner}/${r.name}`.toLowerCase(), [...(groups.get(`${r.owner}/${r.name}`.toLowerCase()) ?? []), r]);
  const merged = [...groups.values()].map(mergeRepo).sort((a, b) => (b.surviving.lines ?? -1) - (a.surviving.lines ?? -1) || b.commits - a.commits);
  return totalsOf(merged);
}

/** A repository's name as GitHub last gave it, which differs from its row's when it was renamed or moved since. */
export function currentName(repo: { owner: string; name: string; facts: string | null }): { owner: string; name: string } {
  const full = repo.facts ? (JSON.parse(repo.facts) as { fullName?: unknown }).fullName : null;
  const [owner, name, more] = typeof full === "string" ? full.split("/") : [];
  return owner && name && more === undefined ? { owner, name } : { owner: repo.owner, name: repo.name };
}

const STATUS_ORDER: EngineRepo["surviving"]["status"][] = ["counting", "stale", "over_budget", "failed", "not_counted", "counted"];

/** One repository's row from the rows of every identity the person has in it: their numbers added up, counted only when every identity is. */
export function mergeRepo(rows: EngineRepo[]): EngineRepo {
  const [first, ...rest] = rows;
  if (!first || rest.length === 0) return first as EngineRepo;
  const sum = (f: (r: EngineRepo) => number | null) => (rows.every((r) => f(r) !== null) ? rows.reduce((n, r) => n + (f(r) ?? 0), 0) : null);
  const status = STATUS_ORDER.find((s) => rows.some((r) => r.surviving.status === s)) ?? "counting";
  const min = (f: (r: EngineRepo) => number | null) => rows.reduce<number | null>((m, r) => (f(r) === null ? m : m === null ? f(r) : Math.min(m, f(r) ?? m)), null);
  const max = (f: (r: EngineRepo) => number | null) => rows.reduce<number | null>((m, r) => (f(r) === null ? m : m === null ? f(r) : Math.max(m, f(r) ?? m)), null);
  return {
    ...first,
    builtAt: Math.max(...rows.map((r) => r.builtAt)),
    commits: rows.reduce((n, r) => n + r.commits, 0),
    linesAdded: sum((r) => r.linesAdded),
    linesRemoved: sum((r) => r.linesRemoved),
    first: min((r) => r.first),
    last: max((r) => r.last),
    surviving: status === "counted" ? { status, lines: sum((r) => r.surviving.lines), added: sum((r) => r.surviving.added) } : { status, lines: null, added: null },
  };
}

function totalsOf(repos: EngineRepo[]): EngineView {
  const counted = repos.filter((r) => r.surviving.status === "counted" && r.surviving.lines !== null);
  return {
    repos,
    surviving: counted.length > 0 ? counted.reduce((n, r) => n + (r.surviving.lines ?? 0), 0) : null,
    added: counted.length > 0 && counted.every((r) => r.surviving.added !== null) ? counted.reduce((n, r) => n + (r.surviving.added ?? 0), 0) : null,
    counting: repos.filter((r) => r.surviving.status === "counting").length,
  };
}

/** A person's Surviving Lines and lines added over every public repository where they are counted, from the stored counts alone. */
export async function survivingTotal(db: Deps["db"], login: string): Promise<{ surviving: number; added: number | null; repositories: number; oldest: number | null; ids: string[] } | null> {
  const counted = await db
    .select({ id: surviving.repoId, lines: surviving.lines, added: surviving.added, oldest: surviving.oldest })
    .from(surviving)
    .innerJoin(repoPeople, and(eq(repoPeople.repoId, surviving.repoId), eq(repoPeople.reportKey, surviving.reportKey), eq(repoPeople.personId, surviving.personId)))
    .innerJoin(repositories, and(eq(repositories.id, surviving.repoId), eq(repositories.reportKey, surviving.reportKey)))
    .where(and(sql`lower(${repoPeople.login}) = ${login.toLowerCase()}`, eq(surviving.status, "counted"), eq(repositories.isPrivate, false)));
  if (counted.length === 0) return null;
  const sum = (f: (c: (typeof counted)[number]) => number | null) => counted.reduce((n, c) => n + (f(c) ?? 0), 0);
  const oldest = counted.flatMap((c) => (c.oldest !== null && (c.lines ?? 0) > 0 ? [c.oldest] : []));
  return { surviving: sum((c) => c.lines), added: counted.every((c) => c.added !== null) ? sum((c) => c.added) : null, repositories: counted.length, oldest: oldest.length > 0 ? Math.min(...oldest) : null, ids: [...new Set(counted.map((c) => c.id))] };
}
