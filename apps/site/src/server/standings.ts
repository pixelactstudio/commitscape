import "@tanstack/react-start/server-only";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { key, type Person, type StandingRow, type Standings } from "@commitscape/data";
import { readEntry, repoId as idOfRepo, schema } from "@commitscape/server";
import { askCounts, LOST_AFTER } from "./engine";
import { hiddenAmong } from "./people";
import { SiteError } from "./http";
import { canSee, type Deps, type Viewer } from "./repos";

const { pullRequests, pullReviews, repoPeople, repositories, surviving } = schema;

export const COUNTED_FOR = 30;
const NO_STANDINGS = "No Standings here: commitscape has not read this repository, or it is not one you can see.";

export type StandingsViewer = Viewer & { login: () => Promise<string | null> };

/** Everyone's Standings in one repository the Site has built, view by view and never combined; a private one only for people GitHub shows it to, and nobody who chose to hide but the viewer. */
export async function standingsOf(deps: Deps, viewer: StandingsViewer, owner: string, name: string, focus?: string): Promise<Standings> {
  const id = idOfRepo(owner, name);
  if (!id) throw new SiteError(404, NO_STANDINGS);
  const [repo] = await deps.db.select().from(repositories).where(eq(repositories.id, id));
  if (!repo?.reportKey) throw new SiteError(404, NO_STANDINGS);
  if (repo.isPrivate || repo.status !== "ok") {
    const s = await viewer.session();
    const token = s ? await viewer.token() : null;
    if (!s || !token || !(await canSee(deps, s.id, token, repo.owner, repo.name, repo.githubId))) throw new SiteError(404, NO_STANDINGS);
  }
  const me = (await viewer.login().catch(() => null))?.toLowerCase() ?? null;
  const [engine, merged, opened, reviewed, counts] = await Promise.all([
    deps.db
      .select()
      .from(repoPeople)
      .where(and(eq(repoPeople.repoId, id), eq(repoPeople.reportKey, repo.reportKey))),
    deps.db
      .select({ login: pullRequests.author, n: count() })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, id), isNotNull(pullRequests.mergedAt)))
      .groupBy(pullRequests.author),
    deps.db.select({ login: pullRequests.author, n: count() }).from(pullRequests).where(eq(pullRequests.repoId, id)).groupBy(pullRequests.author),
    deps.db.select({ login: pullReviews.reviewer, n: count() }).from(pullReviews).where(eq(pullReviews.repoId, id)).groupBy(pullReviews.reviewer),
    deps.db
      .select()
      .from(surviving)
      .where(and(eq(surviving.repoId, id), eq(surviving.reportKey, repo.reportKey))),
  ]);
  const rows = new Map<string, StandingRow>();
  const blank = (key: string, login: string | null, name: string): StandingRow => ({
    key,
    login,
    name,
    personId: null,
    you: !!login && login.toLowerCase() === me,
    commits: null,
    linesAdded: null,
    linesRemoved: null,
    prsMerged: null,
    prsOpened: null,
    reviews: null,
    surviving: null,
    survivingStatus: null,
    first: null,
    last: null,
  });
  const byLogin = (login: string) => {
    const key = login.toLowerCase();
    let r = rows.get(key);
    if (!r) {
      r = blank(key, login, login);
      rows.set(key, r);
    }
    return r;
  };
  for (const e of engine) {
    const r = e.login ? byLogin(e.login) : blank(`#${e.personId}`, null, e.name);
    if (!e.login) rows.set(r.key, r);
    r.name = e.name;
    if (e.login) r.login = e.login;
    r.personId = r.personId ?? e.personId;
    r.commits = (r.commits ?? 0) + e.commits;
    r.linesAdded = e.linesAdded === null ? r.linesAdded : (r.linesAdded ?? 0) + e.linesAdded;
    r.linesRemoved = e.linesRemoved === null ? r.linesRemoved : (r.linesRemoved ?? 0) + e.linesRemoved;
    r.first = Math.min(r.first ?? Infinity, e.first ?? Infinity);
    r.last = Math.max(r.last ?? -Infinity, e.last ?? -Infinity);
    const c = counts.find((x) => x.personId === e.personId);
    if (c) {
      r.survivingStatus = c.status === "queued" ? "counting" : (c.status as StandingRow["survivingStatus"]);
      if (c.status === "counted") r.surviving = (r.surviving ?? 0) + (c.lines ?? 0);
    }
  }
  const pulls = merged.length > 0 || opened.length > 0 || reviewed.length > 0;
  for (const m of opened) if (m.login && !m.login.endsWith("[bot]")) byLogin(m.login).prsOpened = m.n;
  for (const m of merged) if (m.login && !m.login.endsWith("[bot]")) byLogin(m.login).prsMerged = m.n;
  for (const m of reviewed) if (!m.login.endsWith("[bot]")) byLogin(m.login).reviews = m.n;
  if (pulls) for (const r of rows.values()) if (r.login) {
    r.prsMerged ??= 0;
    r.reviews ??= 0;
  }
  const hidden = await hiddenAmong(deps, [...rows.values()].flatMap((r) => (r.login ? [r.login] : [])));
  for (const [key, r] of rows) if (r.login && hidden.has(r.login.toLowerCase()) && !r.you) rows.delete(key);
  const list = [...rows.values()].map((r) => ({ ...r, first: Number.isFinite(r.first ?? NaN) ? r.first : null, last: Number.isFinite(r.last ?? NaN) ? r.last : null }));

  const top = list
    .filter((r) => r.personId !== null)
    .sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
    .slice(0, COUNTED_FOR);
  const wanted = [...top, ...list.filter((r) => focus && r.login?.toLowerCase() === focus.toLowerCase() && r.personId !== null)].filter((r) => {
    const c = counts.find((x) => x.personId === r.personId);
    return !c || ((c.status === "queued" || c.status === "failed") && c.askedAt < Math.floor(Date.now() / 1000) - LOST_AFTER);
  });
  const ids = [...new Set(wanted.map((r) => r.personId as number))];
  if (await askCounts(deps, viewer.address, id, repo.reportKey, ids)) for (const r of list) if (r.personId !== null && ids.includes(r.personId)) r.survivingStatus = "counting";
  for (const r of list) if (r.personId !== null && r.survivingStatus === null) r.survivingStatus = "not_asked";

  const reportKey = repo.reportKey;
  await Promise.all(
    top.map(async (r) => {
      const p = await readEntry<Person>(deps.storage, reportKey, key("/api/person", { id: r.personId ?? -1, window: "all" })).catch(() => null);
      r.worksOn = worksOn(p);
    }),
  );
  return {
    repo: { owner: repo.owner, name: repo.name, private: repo.isPrivate, builtAt: repo.reportAt ?? 0, pullsReadAt: repo.pullsReadAt ?? null, stars: repo.stars ?? 0 },
    people: list.sort((a, b) => (b.surviving ?? -1) - (a.surviving ?? -1) || (b.prsMerged ?? -1) - (a.prsMerged ?? -1) || (b.commits ?? -1) - (a.commits ?? -1)),
    counted: list.filter((r) => r.survivingStatus === "counted").length,
    hidden: hidden.size,
  };
}

function worksOn(p: Person | null): string | null {
  if (!p) return null;
  const counted = new Map<string, number>();
  for (const w of p.work) {
    const folder = w.path.includes("/") ? w.path.slice(0, w.path.lastIndexOf("/") + 1) : w.path;
    counted.set(folder, (counted.get(folder) ?? 0) + w.commits);
  }
  return [...counted.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
