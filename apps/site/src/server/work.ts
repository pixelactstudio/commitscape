import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { inFilter, isLogin, type Work, type WorkGate, type WorkItem } from "@commitscape/data";
import { now, randomId, schema, type Db } from "@commitscape/server";
import { graphql, type GraphQL } from "./graphql";
import { SiteError } from "./http";
import { isHidden } from "./people";
import type { ProfileDeps, ProfileViewer } from "./profiles";

const { proofs, profiles } = schema;

const DAY = 86_400_000;
const KEPT_FOR = 10 * 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTER = /^[A-Za-z0-9-]{1,39}(\/[A-Za-z0-9_.-]{1,100})?$/;
const SEARCH_CAP = 1000;
const REPOSITORY_CAP = 100;
const BATCH = 10;
const BUSY_BATCH = 2;
const LATE = 31;
const WINDOW = 200;
const AT_ONCE = 4;
export const SITE_BUDGET = 40;

export type WorkAsk = { from: string; to: string; filter?: string | null };

type Pr = { number: number; title: string; url: string; mergedAt: string; additions: number; deletions: number; repository: { nameWithOwner: string; isPrivate: boolean } };
type Search = { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (Pr | Record<string, never>)[] };
type Contribution = { repository: { nameWithOwner: string; isPrivate: boolean }; contributions: { totalCount: number } };
type Contributions = { user: { id: string; contributionsCollection: { commitContributionsByRepository: Contribution[] } } | null };
type Commit = { oid: string; messageHeadline: string; authoredDate: string; url: string; additions: number; deletions: number };
type History = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Commit[] };
type Repository = { defaultBranchRef: { target: { history?: History } | null } | null } | null;
type Place = { repo: string; private: boolean; commits: number };
type Run = <T>(task: () => Promise<T>) => Promise<T>;

const PR_FIELDS = `issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number title url mergedAt additions deletions repository { nameWithOwner isPrivate } } }`;
const CONTRIBUTIONS = `user(login: $login) { id contributionsCollection(from: $from, to: $to) { commitContributionsByRepository(maxRepositories: ${REPOSITORY_CAP}) { repository { nameWithOwner isPrivate } contributions { totalCount } } } }`;
const FIRST = `query($login: String!, $from: DateTime!, $to: DateTime!, $q: String!) { ${CONTRIBUTIONS} search(query: $q, type: ISSUE, first: 100) { ${PR_FIELDS} } }`;
const REPOSITORIES = `query($login: String!, $from: DateTime!, $to: DateTime!) { ${CONTRIBUTIONS} }`;
const PRS = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) { ${PR_FIELDS} } }`;
const PRIVATE = `query($after: String) { viewer { login repositories(first: 100, after: $after, privacy: PRIVATE, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: PUSHED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { nameWithOwner pushedAt } } } }`;

type Private = { viewer: { login: string; repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { nameWithOwner: string; pushedAt: string | null }[] } } };

/** The period and filter asked for, checked: dates as YYYY-MM-DD, at most a year apart, and an organisation or owner/repository. */
export function checkAsk(ask: WorkAsk): Required<WorkAsk> {
  if (!DATE.test(ask.from) || !DATE.test(ask.to)) throw new SiteError(400, "Dates are written YYYY-MM-DD.");
  const span = (Date.parse(ask.to) - Date.parse(ask.from)) / DAY;
  if (!(span >= 0)) throw new SiteError(400, "The period ends before it starts.");
  if (span > 365) throw new SiteError(400, "A Proof of Work covers a year at most.");
  const filter = ask.filter?.trim() || null;
  if (filter && !FILTER.test(filter)) throw new SiteError(400, "Filter by an organisation, like acme, or a repository, like acme/rocket.");
  return { from: ask.from, to: ask.to, filter };
}

/** The commits that repeat a merged pull request listed beside them: a squash merge, by the "(#123)" GitHub puts at the end of its subject, or GitHub's own "Merge pull request #123". */
export function repeats(prs: WorkItem[], commit: WorkItem): boolean {
  const n = /\(#(\d+)\)$/.exec(commit.title)?.[1] ?? /^Merge pull request #(\d+) /.exec(commit.title)?.[1];
  return !!n && prs.some((p) => p.repo === commit.repo && p.number === Number(n));
}

const shift = (day: string, by: number) => new Date(Date.parse(day) + by * DAY).toISOString().slice(0, 10);
const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const middle = (from: string, to: string) => shift(from, Math.floor((daysIn(from, to) - 1) / 2));
const range = (from: string, to: string) => ({ from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` });

function limit(count: number): Run {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= count) await new Promise<void>((go) => waiting.push(go));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const prItem = (n: Pr): WorkItem => ({ kind: "pr", repo: n.repository.nameWithOwner, private: n.repository.isPrivate, title: n.title, url: n.url, at: n.mergedAt, number: n.number, sha: null, additions: n.additions, deletions: n.deletions });

async function prsIn(gh: GraphQL, run: Run, q: (from: string, to: string) => string, from: string, to: string, head?: Search): Promise<{ items: WorkItem[]; capped: string[] }> {
  const first = head ?? (await run(() => graphql<{ search: Search }>(gh, PRS, { q: q(from, to), after: null }))).search;
  if (first.issueCount > SEARCH_CAP && from < to) {
    const mid = middle(from, to);
    const [a, b] = await Promise.all([prsIn(gh, run, q, from, mid), prsIn(gh, run, q, shift(mid, 1), to)]);
    return { items: [...a.items, ...b.items], capped: [...a.capped, ...b.capped] };
  }
  const items: WorkItem[] = [];
  let page = first;
  for (let read = 1; ; read++) {
    for (const n of page.nodes) if ("number" in n) items.push(prItem(n as Pr));
    if (!page.pageInfo.hasNextPage || read * 100 >= SEARCH_CAP) break;
    const after = page.pageInfo.endCursor;
    page = (await run(() => graphql<{ search: Search }>(gh, PRS, { q: q(from, to), after }))).search;
  }
  return { items, capped: first.issueCount > SEARCH_CAP ? [from] : [] };
}

async function placesIn(gh: GraphQL, run: Run, login: string, from: string, to: string, gate: (known: Place[]) => void, known?: Contributions): Promise<{ id: string | null; places: Map<string, Place>; capped: string[] }> {
  const answer = known ?? (await run(() => graphql<Contributions>(gh, REPOSITORIES, { login, ...range(from, to) })));
  if (!answer.user) return { id: null, places: new Map(), capped: [] };
  const list = answer.user.contributionsCollection.commitContributionsByRepository;
  const places = new Map(list.map((c) => [c.repository.nameWithOwner, { repo: c.repository.nameWithOwner, private: c.repository.isPrivate, commits: c.contributions.totalCount }]));
  if ((list.length >= REPOSITORY_CAP || daysIn(from, to) > 365) && from < to) {
    gate([...places.values()]);
    const mid = middle(from, to);
    const [a, b] = await Promise.all([placesIn(gh, run, login, from, mid, gate), placesIn(gh, run, login, shift(mid, 1), to, gate)]);
    for (const [repo, p] of b.places) {
      const had = a.places.get(repo);
      if (had) had.commits += p.commits;
      else a.places.set(repo, p);
    }
    return { id: answer.user.id, places: a.places, capped: [...a.capped, ...b.capped] };
  }
  return { id: answer.user.id, places, capped: list.length >= REPOSITORY_CAP ? [from] : [] };
}

/** The private repositories pushed to since the period began, when the token is the person's own: GitHub leaves them out of the contributions it lists, even to their owner. */
async function privatePlaces(gh: GraphQL, run: Run, login: string, from: string): Promise<Place[]> {
  const out: Place[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const answer: Private = await run(() => graphql<Private>(gh, PRIVATE, { after }, 0));
    if (answer.viewer.login.toLowerCase() !== login.toLowerCase()) return [];
    const { nodes, pageInfo } = answer.viewer.repositories;
    for (const r of nodes) if (r.pushedAt && r.pushedAt.slice(0, 10) >= from) out.push({ repo: r.nameWithOwner, private: true, commits: 1 });
    if (!pageInfo.hasNextPage || nodes.some((r) => !r.pushedAt || r.pushedAt.slice(0, 10) < from)) return out;
    after = pageInfo.endCursor;
  }
  return out;
}

/** The stretches of days a repository's commits are read in, each about WINDOW commits, so a busy repository is read in parallel. */
export function windowsOf(place: Place, from: string, to: string): { since: string; until: string; commits: number }[] {
  const days = daysIn(from, to);
  const count = Math.min(days, Math.max(1, Math.ceil(place.commits / WINDOW)));
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * days) / count);
    const end = Math.floor(((i + 1) * days) / count) - 1;
    return { since: shift(from, start), until: shift(from, end), commits: Math.ceil(place.commits / count) };
  });
}

const batchesOf = <T extends { busy: boolean }>(list: T[]): T[][] => {
  const chunk = (items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  return [...chunk(list.filter((c) => !c.busy), BATCH), ...chunk(list.filter((c) => c.busy), BUSY_BATCH)];
};

/** How many requests reading every commit takes: each round asks for the next page of up to ten quiet repositories, or two stretches of a busy one, at once. */
export function commitRequests(places: Place[], from: string, to: string): number {
  let pages = places.flatMap((p) => {
    const windows = windowsOf(p, from, to);
    return windows.map((w) => ({ busy: windows.length > 1, left: Math.max(1, Math.ceil(w.commits / 100)) }));
  });
  let requests = 0;
  while (pages.length > 0) {
    requests += batchesOf(pages).length;
    pages = pages.map((p) => ({ ...p, left: p.left - 1 })).filter((p) => p.left > 0);
  }
  return requests;
}

/** How many requests reading every merged pull request takes beyond the first page: the pages, and the halves a range over 1,000 is split into. */
export function prRequests(prs: number): number {
  if (prs <= SEARCH_CAP) return Math.max(0, Math.ceil(prs / 100) - 1);
  const parts = 2 ** Math.ceil(Math.log2(prs / SEARCH_CAP));
  return parts - 2 + parts * Math.ceil(prs / parts / 100);
}

type Cursor = { place: Place; since: string; until: string; after: string | null; busy: boolean };

async function historyOf(gh: GraphQL, id: string, batch: Cursor[]): Promise<(History | null)[]> {
  const declared = batch.map((_, i) => `$o${i}: String!, $n${i}: String!, $s${i}: GitTimestamp!, $u${i}: GitTimestamp!, $a${i}: String`).join(", ");
  const fields = batch
    .map((_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { defaultBranchRef { target { ... on Commit { history(author: { id: $id }, since: $s${i}, until: $u${i}, first: 100, after: $a${i}) { pageInfo { hasNextPage endCursor } nodes { oid messageHeadline authoredDate url additions deletions } } } } } }`)
    .join(" ");
  const variables: Record<string, unknown> = { id };
  batch.forEach((c, i) => {
    const [owner, name] = c.place.repo.split("/");
    Object.assign(variables, { [`o${i}`]: owner, [`n${i}`]: name, [`s${i}`]: `${c.since}T00:00:00Z`, [`u${i}`]: `${c.until}T23:59:59Z`, [`a${i}`]: c.after });
  });
  const data = await graphql<Record<string, Repository>>(gh, `query($id: ID!, ${declared}) { ${fields} }`, variables);
  return batch.map((_, i) => data[`r${i}`]?.defaultBranchRef?.target?.history ?? null);
}

async function steady(gh: GraphQL, run: Run, id: string, batch: Cursor[]): Promise<(History | null)[]> {
  try {
    return await run(() => historyOf(gh, id, batch));
  } catch (e) {
    if (!(e instanceof SiteError) || e.status !== 502) throw e;
    if (batch.length === 1) return run(() => historyOf(gh, id, batch));
    const half = Math.ceil(batch.length / 2);
    return (await Promise.all([steady(gh, run, id, batch.slice(0, half)), steady(gh, run, id, batch.slice(half))])).flat();
  }
}

async function commitsIn(gh: GraphQL, run: Run, id: string, places: Place[], from: string, to: string): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  let pending: Cursor[] = places.flatMap((place) => windowsOf(place, from, to).map((w, i, all) => ({ place, since: w.since, until: i === all.length - 1 ? shift(w.until, LATE) : w.until, after: null, busy: all.length > 1 })));
  while (pending.length > 0) {
    const batches = batchesOf(pending);
    const histories = (await Promise.all(batches.map((batch) => steady(gh, run, id, batch)))).flat();
    const next: Cursor[] = [];
    batches.flat().forEach((cursor, i) => {
      const history = histories[i];
      if (!history) return;
      for (const c of history.nodes) {
        const day = c.authoredDate.slice(0, 10);
        if (day < from || day > to) continue;
        items.push({ kind: "commit", repo: cursor.place.repo, private: cursor.place.private, title: c.messageHeadline.slice(0, 200), url: c.url, at: c.authoredDate, number: null, sha: c.oid, additions: c.additions, deletions: c.deletions });
      }
      if (history.pageInfo.hasNextPage) next.push({ ...cursor, after: history.pageInfo.endCursor });
    });
    pending = next;
  }
  const seen = new Set<string>();
  return items.filter((c) => !seen.has(`${c.repo}@${c.sha}`) && seen.add(`${c.repo}@${c.sha}`));
}

export class WorkGateError extends SiteError {
  readonly gate: WorkGate;
  constructor(gate: WorkGate) {
    super(401, `Reading this period takes ${gate.atLeast ? "at least" : "about"} ${gate.requests} GitHub requests, more than the Site's shared allowance gives one read. Sign in with GitHub to read it with your own.`, { code: gate.gate, gate });
    this.gate = gate;
  }
}

const kept = new Map<string, { at: number; work: Work }>();
const gates = new Map<string, { at: number; gate: WorkGate }>();
const reading = new Map<string, Promise<Work>>();

function keep<T>(store: Map<string, { at: number } & T>, key: string, value: T) {
  store.set(key, { at: Date.now(), ...value });
  if (store.size > 500) store.delete(store.keys().next().value as string);
}

/** Everything a person shipped in a period: merged pull requests and commits, their private work only for themselves. Without the visitor's own GitHub token, a read costing more than SITE_BUDGET requests is refused with a WorkGateError. */
export async function workOf(deps: ProfileDeps, viewer: ProfileViewer, login: string, asked: WorkAsk): Promise<Work> {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  const ask = checkAsk(asked);
  const who = await viewer.login().catch(() => null);
  const mine = who?.toLowerCase() === login.toLowerCase();
  if (!mine && (await isHidden(deps, login))) throw new SiteError(404, "This person has chosen to stay out, so their Proof of Work is hidden.");
  const scope = mine ? "self" : "public";
  const own = await viewer.token().catch(() => null);
  const key = `${login.toLowerCase()}:${scope}:${ask.from}:${ask.to}:${ask.filter ?? ""}`;
  const fresh = Date.now() - KEPT_FOR;
  const hit = kept.get(key);
  if (hit && hit.at > fresh) return hit.work;
  const whole = ask.filter ? kept.get(`${login.toLowerCase()}:${scope}:${ask.from}:${ask.to}:`) : undefined;
  if (whole && whole.at > fresh) return { ...whole.work, filter: ask.filter, items: whole.work.items.filter((i) => inFilter(i, ask.filter)) };
  const refused = own ? undefined : gates.get(key);
  if (refused && refused.at > fresh) throw new WorkGateError({ ...refused.gate, signedIn: who !== null });
  const already = reading.get(key);
  if (already) return already;
  const read = readWork(deps, own, who !== null, login, ask, scope).finally(() => reading.delete(key));
  reading.set(key, read);
  try {
    const work = await read;
    keep(kept, key, { work });
    return work;
  } catch (e) {
    if (e instanceof WorkGateError) keep(gates, key, { gate: e.gate });
    throw e;
  }
}

async function readWork(deps: ProfileDeps, own: string | null, signedIn: boolean, login: string, ask: Required<WorkAsk>, scope: "self" | "public"): Promise<Work> {
  const gh: GraphQL = { api: deps.github.api, token: own ?? deps.github.token ?? null, fetcher: deps.github.fetcher, count: { requests: 0 }, cache: own ? undefined : { db: deps.db, scope: "public" } };
  const run = limit(AT_ONCE);
  const narrow = ask.filter ? (ask.filter.includes("/") ? ` repo:${ask.filter}` : ` org:${ask.filter}`) : "";
  const q = (a: string, b: string) => `author:${login} is:pr is:merged merged:${a}..${b}${narrow}`;
  const shown = (i: { private: boolean }) => scope === "self" || !i.private;
  const first = await run(() => graphql<Contributions & { search: Search }>(gh, FIRST, { login, ...range(ask.from, ask.to), q: q(ask.from, ask.to) }));
  const gateOf = (places: Place[], more = 0, atLeast = false): WorkGate => ({
    gate: "sign_in_for_work",
    login,
    from: ask.from,
    to: ask.to,
    filter: ask.filter,
    prs: first.search.issueCount,
    commits: places.reduce((n, p) => n + p.commits, 0),
    requests: (gh.count?.requests ?? 0) + more + commitRequests(places, ask.from, ask.to) + prRequests(first.search.issueCount),
    budget: SITE_BUDGET,
    atLeast,
    signedIn,
    repositories: places.map(({ repo, private: p, commits }) => ({ repo, private: p, commits })),
  });
  const wanted = (places: Iterable<Place>) => [...places].filter((p) => shown(p) && inFilter({ repo: p.repo }, ask.filter) && p.commits > 0);
  const seen = new Map<string, Place>();
  const found = await placesIn(
    gh,
    run,
    login,
    ask.from,
    ask.to,
    (known) => {
      for (const p of known) if ((seen.get(p.repo)?.commits ?? -1) < p.commits) seen.set(p.repo, p);
      const gate = gateOf(wanted(seen.values()), 2, true);
      if (!own && gate.requests > SITE_BUDGET) throw new WorkGateError(gate);
    },
    first,
  );
  if (scope === "self") for (const p of await privatePlaces(gh, run, login, ask.from).catch(() => [])) if (!found.places.has(p.repo)) found.places.set(p.repo, p);
  const places = wanted(found.places.values()).sort((a, b) => b.commits - a.commits);
  if (!own && gateOf(places).requests > SITE_BUDGET) throw new WorkGateError(gateOf(places));
  const [prs, commits] = await Promise.all([prsIn(gh, run, q, ask.from, ask.to, first.search), found.id ? commitsIn(gh, run, found.id, places, ask.from, ask.to) : Promise.resolve([])]);
  const items = [...prs.items.filter(shown).sort((x, y) => (x.at < y.at ? 1 : -1)), ...commits.filter((c) => !repeats(prs.items, c))];
  const [row] = await deps.db.select({ identity: profiles.identity }).from(profiles).where(eq(profiles.login, login.toLowerCase()));
  const name = row ? ((JSON.parse(row.identity) as { name: string | null }).name ?? null) : null;
  return { login, name, ...ask, items, scope, shared: null, capped: { prDays: prs.capped, repositoryDays: found.capped }, at: Math.floor(Date.now() / 1000) };
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
  const work = JSON.parse(row.data) as Work;
  return { ...work, capped: work.capped ?? { prDays: [], repositoryDays: [] } };
}

/** Deletes a shared Proof of Work, by the person who shared it. */
export async function unshareWork(db: Db, userId: string, id: string): Promise<void> {
  const [row] = await db.select().from(proofs).where(eq(proofs.id, id));
  if (!row || row.userId !== userId) throw new SiteError(404, "There is no shared Proof of Work of yours here.");
  await db.delete(proofs).where(eq(proofs.id, id));
}
