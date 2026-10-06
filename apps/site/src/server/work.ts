import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { isLogin, type Work, type WorkItem } from "@commitscape/data";
import { now, randomId, schema, type Db } from "@commitscape/server";
import { graphql, type GraphQL } from "./graphql";
import { SiteError } from "./http";
import { isHidden } from "./people";
import type { ProfileDeps, ProfileViewer } from "./profiles";

const { proofs, profiles } = schema;

export const PAGES = 10;
const DAY = 86_400_000;
const KEPT_FOR = 10 * 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTER = /^[A-Za-z0-9-]{1,39}(\/[A-Za-z0-9_.-]{1,100})?$/;

export type WorkAsk = { from: string; to: string; filter?: string | null };

type Pr = { number: number; title: string; url: string; mergedAt: string; additions: number; deletions: number; repository: { nameWithOwner: string; isPrivate: boolean } };
type Search = { search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (Pr | Record<string, never>)[] } };
type Commit = { sha: string; html_url: string; commit: { message: string; author: { date: string } | null }; repository: { full_name: string; private: boolean } };

const PRS = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title url mergedAt additions deletions repository { nameWithOwner isPrivate } } }
  }
}`;

/** The period and filter asked for, checked: dates as YYYY-MM-DD, at most a year apart, and an organisation or owner/repository. */
export function checkAsk(ask: WorkAsk): Required<WorkAsk> {
  if (!DATE.test(ask.from) || !DATE.test(ask.to)) throw new SiteError(400, "Dates are written YYYY-MM-DD.");
  const span = (Date.parse(ask.to) - Date.parse(ask.from)) / DAY;
  if (!(span >= 0)) throw new SiteError(400, "The period ends before it starts.");
  if (span > 366) throw new SiteError(400, "A Proof of Work covers a year at most.");
  const filter = ask.filter?.trim() || null;
  if (filter && !FILTER.test(filter)) throw new SiteError(400, "Filter by an organisation, like acme, or a repository, like acme/rocket.");
  return { from: ask.from, to: ask.to, filter };
}

/** The commits that repeat a merged pull request listed beside them: a squash merge, by the "(#123)" GitHub puts at the end of its subject, or GitHub's own "Merge pull request #123". */
export function repeats(prs: WorkItem[], commit: WorkItem): boolean {
  const n = /\(#(\d+)\)$/.exec(commit.title)?.[1] ?? /^Merge pull request #(\d+) /.exec(commit.title)?.[1];
  return !!n && prs.some((p) => p.repo === commit.repo && p.number === Number(n));
}

async function searchPrRange(gh: GraphQL, q: string, first?: Search): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const items: WorkItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < PAGES; page++) {
    const data: Search = page === 0 && first ? first : await graphql<Search>(gh, PRS, { q, after });
    for (const n of data.search.nodes) {
      if (!("number" in n)) continue;
      items.push({ kind: "pr", repo: n.repository.nameWithOwner, private: n.repository.isPrivate, title: n.title, url: n.url, at: n.mergedAt, number: n.number, sha: null, additions: n.additions, deletions: n.deletions });
    }
    if (!data.search.pageInfo.hasNextPage) return { items, truncated: false };
    after = data.search.pageInfo.endCursor;
  }
  return { items, truncated: true };
}

/** The months a period covers, each clipped to the period, as YYYY-MM-DD pairs. */
export function monthsOf(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  for (;;) {
    const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    out.push([start < from ? from : start, end > to ? to : end]);
    if (end >= to) return out;
    m++;
  }
}

async function searchPrs(gh: GraphQL, q: (from: string, to: string) => string, from: string, to: string): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const first = await graphql<Search>(gh, PRS, { q: q(from, to), after: null });
  const months = monthsOf(from, to);
  if (!first.search.pageInfo.hasNextPage || months.length < 2) return searchPrRange(gh, q(from, to), first);
  const parts = await Promise.all(months.map(([a, b]) => searchPrRange(gh, q(a, b))));
  const seen = new Set<string>();
  const items = parts.flatMap((p) => p.items).filter((i) => !seen.has(i.url) && seen.add(i.url));
  return { items: items.sort((x, y) => (x.at < y.at ? 1 : -1)), truncated: parts.some((p) => p.truncated) };
}

async function commitPage(gh: GraphQL, q: string, page: number): Promise<{ total: number; items: WorkItem[] } | null> {
  if (gh.count) gh.count.requests++;
  const answer = await (gh.fetcher ?? fetch)(`${gh.api.replace(/\/$/, "")}/search/commits?q=${encodeURIComponent(q)}&sort=author-date&order=desc&per_page=100&page=${page}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "commitscape", "x-github-api-version": "2022-11-28", ...(gh.token ? { authorization: `Bearer ${gh.token}` } : {}) },
  });
  if (answer.status === 403 || answer.status === 429) throw new SiteError(503, "GitHub's search limit is reached for now. Try again in a minute.");
  if (answer.status === 422) return null;
  if (!answer.ok) throw new SiteError(502, `GitHub answered ${answer.status}.`);
  const body = (await answer.json()) as { total_count: number; items: Commit[] };
  return {
    total: body.total_count,
    items: body.items.map((c) => ({ kind: "commit", repo: c.repository.full_name, private: c.repository.private, title: c.commit.message.split("\n")[0]?.slice(0, 200) ?? "", url: c.html_url, at: c.commit.author?.date ?? "", number: null, sha: c.sha, additions: null, deletions: null })),
  };
}

async function searchCommits(gh: GraphQL, q: string): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const first = await commitPage(gh, q, 1);
  if (!first) return { items: [], truncated: false };
  if (first.items.length < 100 || first.total <= 100) return { items: first.items, truncated: false };
  const pages = Math.min(PAGES, Math.ceil(first.total / 100));
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => commitPage(gh, q, i + 2)));
  const seen = new Set<string>();
  const items = [first, ...rest].flatMap((p) => p?.items ?? []).filter((c) => !seen.has(`${c.repo}@${c.sha}`) && seen.add(`${c.repo}@${c.sha}`));
  return { items, truncated: first.total > PAGES * 100 };
}

const kept = new Map<string, { at: number; work: Work }>();
const reading = new Map<string, Promise<Work>>();

/** Everything a person shipped in a period: merged pull requests and commits, their private work only for themselves. */
export async function workOf(deps: ProfileDeps, viewer: ProfileViewer, login: string, asked: WorkAsk): Promise<Work> {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  const ask = checkAsk(asked);
  const mine = (await viewer.login().catch(() => null))?.toLowerCase() === login.toLowerCase();
  if (!mine && (await isHidden(deps, login))) throw new SiteError(404, "This person has chosen to stay out, so their Proof of Work is hidden.");
  const scope = mine ? "self" : "public";
  const key = `${login.toLowerCase()}:${scope}:${ask.from}:${ask.to}:${ask.filter ?? ""}`;
  const hit = kept.get(key);
  if (hit && hit.at > Date.now() - KEPT_FOR) return hit.work;
  const already = reading.get(key);
  if (already) return already;
  const read = readWork(deps, viewer, login, ask, scope).finally(() => reading.delete(key));
  reading.set(key, read);
  const work = await read;
  kept.set(key, { at: Date.now(), work });
  if (kept.size > 500) kept.delete(kept.keys().next().value as string);
  return work;
}

async function readWork(deps: ProfileDeps, viewer: ProfileViewer, login: string, ask: Required<WorkAsk>, scope: "self" | "public"): Promise<Work> {
  const token = (await viewer.token().catch(() => null)) ?? deps.github.token ?? null;
  const gh: GraphQL = { api: deps.github.api, token, fetcher: deps.github.fetcher, count: { requests: 0 } };
  const narrow = ask.filter ? (ask.filter.includes("/") ? ` repo:${ask.filter}` : ` org:${ask.filter}`) : "";
  const [prs, commits] = await Promise.all([
    searchPrs(gh, (a, b) => `author:${login} is:pr is:merged merged:${a}..${b}${narrow}`, ask.from, ask.to),
    searchCommits(gh, `author:${login} author-date:${ask.from}..${ask.to}${narrow}`),
  ]);
  const shown = (i: WorkItem) => scope === "self" || !i.private;
  const items = [...prs.items.filter(shown), ...commits.items.filter(shown).filter((c) => !repeats(prs.items, c))];
  const [row] = await deps.db.select({ identity: profiles.identity }).from(profiles).where(eq(profiles.login, login.toLowerCase()));
  const name = row ? ((JSON.parse(row.identity) as { name: string | null }).name ?? null) : null;
  return { login, name, ...ask, items, scope, shared: null, truncated: prs.truncated || commits.truncated, at: Math.floor(Date.now() / 1000) };
}

/** Keeps a person's Proof of Work as a link: their public items, and only the private repositories they chose. */
export async function shareWork(db: Db, userId: string, work: Work, privateRepos: string[]): Promise<string> {
  if (work.scope !== "self") throw new SiteError(403, "Only the person themselves can share their Proof of Work.");
  const chosen = new Set(privateRepos.map((r) => r.toLowerCase()));
  const items = work.items.filter((i) => !i.private || chosen.has(i.repo.toLowerCase()));
  const id = randomId();
  await db.insert(proofs).values({ id, login: work.login.toLowerCase(), userId, data: JSON.stringify({ ...work, items, scope: "public", shared: id }), createdAt: now() });
  return id;
}

/** A shared Proof of Work, as it was kept. */
export async function sharedWork(db: Db, id: string): Promise<Work> {
  const [row] = await db.select().from(proofs).where(eq(proofs.id, id));
  if (!row) throw new SiteError(404, "There is no shared Proof of Work here: it was deleted, or never made.");
  return JSON.parse(row.data) as Work;
}

/** Deletes a shared Proof of Work, by the person who shared it. */
export async function unshareWork(db: Db, userId: string, id: string): Promise<void> {
  const [row] = await db.select().from(proofs).where(eq(proofs.id, id));
  if (!row || row.userId !== userId) throw new SiteError(404, "There is no shared Proof of Work of yours here.");
  await db.delete(proofs).where(eq(proofs.id, id));
}
