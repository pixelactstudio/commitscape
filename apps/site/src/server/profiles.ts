import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import type { Identity, Partner, Profile, ProfileLookup, ProfileMonth, ProfilePr, ProfileRepo, ProfileYear } from "@commitscape/data";
import { isLogin } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";
import { graphql, type GraphQL } from "./graphql";
import { SiteError } from "./http";

const { people, profiles, user } = schema;

export const PROFILE_FOR = 24 * 3600;
export const PRS_READ = 3000;
export const CLOCK_RETRY = 10 * 60;
const PAGES_A_RANGE = 10;
const AT_ONCE = 10;
const YEARS_A_REQUEST = 2;
const DAY = 86_400;

export type ProfileDeps = { db: Db; github: { api: string; token?: string; fetcher?: typeof fetch } };
export type ProfileViewer = { login: () => Promise<string | null>; token: () => Promise<string | null> };

type Owner = {
  __typename: "User" | "Organization";
  login: string;
  databaseId: number;
  name: string | null;
  avatarUrl: string;
  bio?: string | null;
  description?: string | null;
  company?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  twitterUsername?: string | null;
  createdAt: string;
  followers?: { totalCount: number };
  contributionsCollection?: { contributionYears: number[] };
  merged?: { totalCount: number };
  open?: { totalCount: number };
  closed?: { totalCount: number };
};

type Repo = { nameWithOwner: string; isPrivate: boolean; stargazerCount: number; primaryLanguage: { name: string; color: string | null } | null };
type Who = { __typename?: string; login: string; avatarUrl: string } | null;
type YearRaw = {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  totalIssueContributions: number;
  restrictedContributionsCount: number;
  contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
  commitContributionsByRepository: { repository: Repo; contributions: { totalCount: number }; latest: { nodes: { occurredAt: string }[] }; earliest: { nodes: { occurredAt: string }[] } }[];
  pullRequestReviewContributionsByRepository: { repository: Repo; contributions: { totalCount: number; nodes: { pullRequest: { author: Who } }[] } }[];
  pullRequestContributionsByRepository?: { repository: Repo; contributions: { totalCount: number } }[];
};
type PrRaw = {
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  repository: Repo;
  reviews?: { nodes: { author: Who }[] };
};

const OWNER = `
  repositoryOwner(login: $login) {
    __typename login avatarUrl
    ... on User {
      databaseId name bio company location websiteUrl twitterUsername createdAt
      followers { totalCount }
      contributionsCollection { contributionYears }
      merged: pullRequests(states: MERGED) { totalCount }
      open: pullRequests(states: OPEN) { totalCount }
      closed: pullRequests(states: CLOSED) { totalCount }
    }
    ... on Organization { databaseId name description location websiteUrl twitterUsername createdAt }
  }`;

const REPO = "nameWithOwner isPrivate stargazerCount primaryLanguage { name color }";

function yearFields(year: number): string {
  const range = `from: "${year}-01-01T00:00:00Z", to: "${year}-12-31T23:59:59Z"`;
  return `y${year}: contributionsCollection(${range}) {
    totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions restrictedContributionsCount
    contributionCalendar { weeks { contributionDays { date contributionCount } } }
    commitContributionsByRepository(maxRepositories: 100) {
      repository { ${REPO} }
      contributions { totalCount }
      latest: contributions(first: 1, orderBy: { field: OCCURRED_AT, direction: DESC }) { nodes { occurredAt } }
      earliest: contributions(first: 1, orderBy: { field: OCCURRED_AT, direction: ASC }) { nodes { occurredAt } }
    }
    pullRequestReviewContributionsByRepository(maxRepositories: 100) {
      repository { ${REPO} }
      contributions(first: 50) { totalCount nodes { pullRequest { author { __typename login avatarUrl } } } }
    }
    pullRequestContributionsByRepository(maxRepositories: 100) { repository { ${REPO} } contributions { totalCount } }
  }`;
}

const PRS = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title state createdAt mergedAt additions deletions
        repository { ${REPO} }
      }
    }
  }
}`;

const REVIEWERS = `query($login: String!) {
  user(login: $login) {
    pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { reviews(first: 6) { nodes { author { __typename login avatarUrl } } } }
    }
  }
}`;

function identityOf(o: Owner): Identity {
  return {
    login: o.login,
    githubId: o.databaseId,
    name: o.name || null,
    avatar: o.avatarUrl,
    bio: o.bio ?? o.description ?? null,
    company: o.company ?? null,
    location: o.location ?? null,
    website: o.websiteUrl || null,
    twitter: o.twitterUsername ?? null,
    followers: o.followers?.totalCount ?? 0,
    createdAt: o.createdAt,
    kind: o.__typename === "Organization" ? "organization" : "user",
  };
}

const isBot = (w: Who) => !w || w.__typename === "Bot" || w.login.endsWith("[bot]");
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 1000 / DAY);

function withOutcomes(month: (key: string) => ProfileMonth, prs: Pick<PrRaw, "state" | "createdAt">[]) {
  for (const pr of prs) {
    const m = month(pr.createdAt.slice(0, 7));
    m.prs ??= { merged: 0, open: 0, closed: 0 };
    m.prs[pr.state === "MERGED" ? "merged" : pr.state === "OPEN" ? "open" : "closed"]++;
  }
}

/** A stored Profile brought up to what the Site now draws: the pull requests opened each month, by how they ended, worked out from its pull requests when it was saved before those were counted. */
export function upgraded(p: Profile): Profile {
  if (!p.read.complete || p.prs.length === 0 || p.months.some((m) => m.prs)) return p;
  const months = new Map(p.months.map((m) => [m.month, { ...m }]));
  const month = (key: string) => {
    let m = months.get(key);
    if (!m) {
      m = { month: key, contributions: 0, prsMerged: 0 };
      months.set(key, m);
    }
    return m;
  };
  withOutcomes(month, p.prs);
  return { ...p, months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)) };
}

/** Turns GitHub's answers about a person into their Profile; private work stays in the totals only, unless it is for the person themselves. */
export function assemble(owner: Owner, years: Record<string, YearRaw>, prs: PrRaw[] | null, reviewers: Who[][], scope: Profile["scope"], at: number, requests: number, clock: Profile["clock"] = null): Profile {
  const identity = identityOf(owner);
  const me = identity.login.toLowerCase();
  const shown = (r: Repo) => scope === "self" || !r.isPrivate;
  const repos = new Map<string, ProfileRepo>();
  const repo = (r: Repo): ProfileRepo => {
    const key = r.nameWithOwner.toLowerCase();
    let found = repos.get(key);
    if (!found) {
      const [o = "", n = ""] = r.nameWithOwner.split("/");
      found = { owner: o, name: n, private: r.isPrivate, stars: r.stargazerCount, language: r.primaryLanguage?.name ?? null, colour: r.primaryLanguage?.color ?? null, commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, linesAdded: 0, linesRemoved: 0, first: null, last: null };
      repos.set(key, found);
    }
    return found;
  };
  const touch = (r: ProfileRepo, iso: string | null | undefined) => {
    if (!iso) return;
    if (!r.first || iso < r.first) r.first = iso;
    if (!r.last || iso > r.last) r.last = iso;
  };
  const partners = new Map<string, Partner>();
  const partner = (w: Who) => {
    if (!w || isBot(w) || w.login.toLowerCase() === me) return null;
    const key = w.login.toLowerCase();
    let p = partners.get(key);
    if (!p) {
      p = { login: w.login, avatar: w.avatarUrl, reviewedTheirs: 0, reviewedYours: 0 };
      partners.set(key, p);
    }
    return p;
  };

  const yearList: ProfileYear[] = [];
  const daily = new Map<number, number>();
  for (const [k, y] of Object.entries(years)) {
    const year = Number(k.slice(1));
    const languages = new Map<string, { name: string; colour: string | null; commits: number }>();
    for (const c of y.commitContributionsByRepository) {
      const lang = c.repository.primaryLanguage;
      if (lang) {
        const l = languages.get(lang.name) ?? { name: lang.name, colour: lang.color, commits: 0 };
        l.commits += c.contributions.totalCount;
        languages.set(lang.name, l);
      }
      if (!shown(c.repository)) continue;
      const r = repo(c.repository);
      r.commits += c.contributions.totalCount;
      touch(r, c.latest.nodes[0]?.occurredAt);
      touch(r, c.earliest.nodes[0]?.occurredAt);
    }
    if (!prs)
      for (const c of y.pullRequestContributionsByRepository ?? []) {
        if (!shown(c.repository)) continue;
        repo(c.repository).prsOpened += c.contributions.totalCount;
      }
    for (const c of y.pullRequestReviewContributionsByRepository) {
      for (const n of c.contributions.nodes) {
        const p = partner(n.pullRequest.author);
        if (p) p.reviewedTheirs++;
      }
      if (!shown(c.repository)) continue;
      repo(c.repository).reviews += c.contributions.totalCount;
    }
    for (const w of y.contributionCalendar.weeks) for (const d of w.contributionDays) daily.set(dayOf(d.date), d.contributionCount);
    yearList.push({
      year,
      commits: y.totalCommitContributions,
      prs: y.totalPullRequestContributions,
      reviews: y.totalPullRequestReviewContributions,
      issues: y.totalIssueContributions,
      hidden: y.restrictedContributionsCount,
      languages: [...languages.values()].sort((a, b) => b.commits - a.commits).slice(0, 8),
      top: y.commitContributionsByRepository
        .filter((c) => shown(c.repository))
        .map((c) => ({ repo: c.repository.nameWithOwner, commits: c.contributions.totalCount, private: c.repository.isPrivate }))
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 5),
    });
  }
  yearList.sort((a, b) => a.year - b.year);

  const keptPrs: ProfilePr[] = [];
  const merges: number[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const list of reviewers)
    for (const w of list) {
      const p = partner(w);
      if (p) p.reviewedYours++;
    }
  for (const pr of prs ?? []) {
    if (pr.state === "MERGED" && pr.mergedAt) {
      merges.push((Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000);
      linesAdded += pr.additions;
      linesRemoved += pr.deletions;
    }
    if (!shown(pr.repository)) {
      keptPrs.push({ repo: "", number: 0, title: "", state: pr.state, createdAt: pr.createdAt, mergedAt: pr.mergedAt, additions: pr.additions, deletions: pr.deletions, private: true, stars: pr.repository.stargazerCount });
      continue;
    }
    const r = repo(pr.repository);
    r.prsOpened++;
    touch(r, pr.createdAt);
    if (pr.state === "MERGED") {
      r.prsMerged++;
      r.linesAdded += pr.additions;
      r.linesRemoved += pr.deletions;
    }
    keptPrs.push({ repo: pr.repository.nameWithOwner, number: pr.number, title: pr.title, state: pr.state, createdAt: pr.createdAt, mergedAt: pr.mergedAt, additions: pr.additions, deletions: pr.deletions, private: pr.repository.isPrivate, stars: pr.repository.stargazerCount });
  }
  merges.sort((a, b) => a - b);

  const today = Math.floor(at / DAY);
  const days = [...daily.keys()];
  const firstDay = days.length > 0 ? Math.min(...days) : today;
  const calendar = Array.from({ length: Math.max(0, today - firstDay + 1) }, (_, i) => daily.get(firstDay + i) ?? 0);
  let longest = 0;
  let run = 0;
  for (const n of calendar) {
    run = n > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = calendar.length - 1; i >= 0; i--) {
    if ((calendar[i] ?? 0) > 0) current++;
    else if (i === calendar.length - 1) continue;
    else break;
  }
  const months = new Map<string, ProfileMonth>();
  const month = (key: string) => {
    let m = months.get(key);
    if (!m) {
      m = { month: key, contributions: 0, prsMerged: 0 };
      months.set(key, m);
    }
    return m;
  };
  calendar.forEach((n, i) => {
    if (n > 0) month(new Date((firstDay + i) * DAY * 1000).toISOString().slice(0, 7)).contributions += n;
  });
  for (const pr of prs ?? []) if (pr.mergedAt) month(pr.mergedAt.slice(0, 7)).prsMerged++;
  if (prs) withOutcomes(month, prs);

  const sum = (f: (y: ProfileYear) => number) => yearList.reduce((n, y) => n + f(y), 0);
  return {
    identity,
    fetchedAt: at,
    scope,
    totals: {
      prsOpened: (owner.merged?.totalCount ?? 0) + (owner.open?.totalCount ?? 0) + (owner.closed?.totalCount ?? 0),
      prsMerged: owner.merged?.totalCount ?? 0,
      prsClosed: owner.closed?.totalCount ?? 0,
      prsOpen: owner.open?.totalCount ?? 0,
      reviews: sum((y) => y.reviews),
      commits: sum((y) => y.commits),
      issues: sum((y) => y.issues),
      hidden: sum((y) => y.hidden),
      linesAdded: prs ? linesAdded : null,
      linesRemoved: prs ? linesRemoved : null,
      hoursToMerge: merges.length > 0 ? (merges[Math.floor((merges.length - 1) / 2)]! + merges[Math.ceil((merges.length - 1) / 2)]!) / 2 : null,
      activeDays: calendar.filter((n) => n > 0).length,
      longestStreak: longest,
      currentStreak: current,
      contributions: calendar.reduce((a, b) => a + b, 0),
    },
    years: yearList,
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    calendar: { firstDay, days: calendar },
    repositories: [...repos.values()].sort((a, b) => b.prsMerged * 3 + b.commits + b.reviews - (a.prsMerged * 3 + a.commits + a.reviews)),
    partners: [...partners.values()].sort((a, b) => b.reviewedTheirs + b.reviewedYours - (a.reviewedTheirs + a.reviewedYours)).slice(0, 12),
    prs: keptPrs,
    read: { prs: prs?.length ?? 0, prsTotal: (owner.merged?.totalCount ?? 0) + (owner.open?.totalCount ?? 0) + (owner.closed?.totalCount ?? 0), requests, complete: prs !== null, ...(prs !== null ? { clockAt: at } : {}) },
    clock,
  };
}

async function fetchOwner(gh: GraphQL, login: string): Promise<Owner | null> {
  const data = await graphql<{ repositoryOwner: Owner | null }>(gh, `query($login: String!) { ${OWNER} }`, { login });
  return data.repositoryOwner;
}

type Raw = { owner: Owner; years: Record<string, YearRaw> };

async function fetchYears(gh: GraphQL, owner: Owner): Promise<Raw> {
  const years = [...(owner.contributionsCollection?.contributionYears ?? [])].sort((a, b) => b - a);
  const batches: number[][] = [];
  for (let i = 0; i < years.length; i += YEARS_A_REQUEST) batches.push(years.slice(i, i + YEARS_A_REQUEST));
  const answers = await Promise.all(
    batches.map((b) => graphql<{ user: Record<string, YearRaw> | null }>(gh, `query($login: String!) { user(login: $login) { ${b.map(yearFields).join("\n")} } }`, { login: owner.login })),
  );
  const merged: Record<string, YearRaw> = {};
  for (const a of answers) Object.assign(merged, a.user ?? {});
  return { owner, years: merged };
}

/** The hour of day on each commit's own clock, from an ISO date with its offset. */
export function localHour(iso: string): number | null {
  const m = /T(\d{2}):\d{2}/.exec(iso);
  return m ? Number(m[1]) : null;
}

/** The weekday (Monday 0) and hour on each commit's own clock, from an ISO date with its offset. */
export function localSlot(iso: string): { weekday: number; hour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}/.exec(iso);
  if (!m) return null;
  const weekday = (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() + 6) % 7;
  return { weekday, hour: Number(m[4]) };
}

/** When a person's newest 100 commits were made, by hour and by weekday and hour; null when GitHub did not answer, never mistaken for "no commits". */
export async function fetchClock(gh: GraphQL, login: string): Promise<Profile["clock"]> {
  if (gh.count) gh.count.requests++;
  const answer = await (gh.fetcher ?? fetch)(`${gh.api.replace(/\/$/, "")}/search/commits?q=${encodeURIComponent(`author:${login}`)}&sort=author-date&order=desc&per_page=100`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "commitscape", "x-github-api-version": "2022-11-28", ...(gh.token ? { authorization: `Bearer ${gh.token}` } : {}) },
  }).catch(() => null);
  if (!answer?.ok) return null;
  const body = (await answer.json().catch(() => null)) as { items?: { commit: { author: { date: string } | null } }[] } | null;
  if (!body || !Array.isArray(body.items)) return null;
  const hours = Array(24).fill(0) as number[];
  const week = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  let sampled = 0;
  for (const c of body.items) {
    const slot = c.commit.author ? localSlot(c.commit.author.date) : null;
    if (!slot) continue;
    hours[slot.hour] = (hours[slot.hour] ?? 0) + 1;
    const row = week[slot.weekday];
    if (row) row[slot.hour] = (row[slot.hour] ?? 0) + 1;
    sampled++;
  }
  return { hours, sampled, week };
}

async function fetchPrs(gh: GraphQL, raw: Raw): Promise<{ prs: PrRaw[]; reviewers: Who[][]; clock: Profile["clock"] }> {
  const years = Object.keys(raw.years).map((k) => Number(k.slice(1)));
  const [prs, recent, clock] = await Promise.all([
    searchPrs(gh, raw.owner.login, years),
    graphql<{ user: { pullRequests: { nodes: { reviews: { nodes: { author: Who }[] } }[] } } | null }>(gh, REVIEWERS, { login: raw.owner.login }),
    fetchClock(gh, raw.owner.login),
  ]);
  return { prs: prs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), reviewers: (recent.user?.pullRequests.nodes ?? []).map((n) => n.reviews.nodes.map((r) => r.author)), clock };
}

type Search = { search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (PrRaw | Record<string, never>)[] } };

const isoDay = (d: number) => new Date(d * DAY * 1000).toISOString().slice(0, 10);

/** A person's pull requests by searching date ranges, newest year first: a range holding more than 100 is split in two and both halves asked at once, up to PRS_READ. */
export async function searchPrs(gh: GraphQL, login: string, years: number[]): Promise<PrRaw[]> {
  const found: PrRaw[] = [];
  const limit = gate(AT_ONCE);
  const ask = (from: number, to: number, after: string | null) => limit(() => graphql<Search>(gh, PRS, { q: `author:${login} is:pr created:${isoDay(from)}..${isoDay(to)}`, after }));
  const range = async (from: number, to: number): Promise<void> => {
    if (found.length >= PRS_READ) return;
    const first = await ask(from, to, null);
    if (first.search.issueCount > 100 && to > from) {
      const mid = Math.floor((from + to) / 2);
      await Promise.all([range(mid + 1, to), range(from, mid)]);
      return;
    }
    let page: Search = first;
    for (let n = 0; n < PAGES_A_RANGE; n++) {
      found.push(...page.search.nodes.filter((x): x is PrRaw => "number" in x));
      if (!page.search.pageInfo.hasNextPage) break;
      page = await ask(from, to, page.search.pageInfo.endCursor);
    }
  };
  const days = (y: number) => [Date.UTC(y, 0, 1) / 1000 / DAY, Date.UTC(y, 11, 31) / 1000 / DAY] as const;
  await Promise.all([...years].sort((a, b) => b - a).map((y) => range(...days(y))));
  return found;
}

function gate(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(run: () => Promise<T>): Promise<T> => {
    if (running >= size) await new Promise<void>((go) => waiting.push(go));
    running++;
    try {
      return await run();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

async function stored(db: Db, login: string, scope: Profile["scope"]) {
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.login, login.toLowerCase()), eq(profiles.scope, scope)));
  return row;
}

function nameOf(login: string): string {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  return login;
}

async function scopeOf(viewer: ProfileViewer, login: string): Promise<Profile["scope"]> {
  const mine = await viewer.login().catch(() => null);
  return mine && mine.toLowerCase() === login.toLowerCase() ? "self" : "public";
}

function gh(deps: ProfileDeps, token: string | null, count: { requests: number }): GraphQL {
  return { api: deps.github.api, token: token ?? deps.github.token ?? null, fetcher: deps.github.fetcher, count };
}

async function choices(db: Db, login: string): Promise<{ hidden: boolean; namePrivate: boolean }> {
  const [row] = await db.select().from(people).where(eq(people.login, login.toLowerCase()));
  return { hidden: row?.hidden ?? false, namePrivate: row?.namePrivate ?? false };
}

/** Who a GitHub login is, from the stored copy when it is a day old or less, else from GitHub; a hidden person is only "hidden", except to themselves. */
export async function lookupProfile(deps: ProfileDeps, viewer: ProfileViewer, login: string): Promise<ProfileLookup & { requests: number }> {
  nameOf(login);
  const self = (await scopeOf(viewer, login)) === "self";
  const chosen = await choices(deps.db, login);
  if (chosen.hidden && !self) return { status: "hidden", login, requests: 0 };
  const kept = await stored(deps.db, login, "public");
  if (kept && kept.identityAt > now() - PROFILE_FOR) {
    const identity = JSON.parse(kept.identity) as Identity;
    if (identity.kind === "organization") return { status: "organization", login: identity.login, identity, requests: 0 };
    return { status: "ok", identity, hidden: chosen.hidden, self, fetchedAt: kept.fetchedAt ?? null, requests: 0 };
  }
  const count = { requests: 0 };
  const owner = await fetchOwner(gh(deps, await viewer.token().catch(() => null), count), login).catch((e: unknown) => {
    if (kept) return "kept" as const;
    throw e;
  });
  if (owner === "kept" && kept) {
    const identity = JSON.parse(kept.identity) as Identity;
    return { status: "ok", identity, hidden: chosen.hidden, self, fetchedAt: kept.fetchedAt ?? null, requests: count.requests };
  }
  if (!owner || owner === "kept") return { status: "not_found", login, requests: count.requests };
  const identity = identityOf(owner);
  const fields = { githubId: identity.githubId, identity: JSON.stringify(identity), identityAt: now() };
  await deps.db
    .insert(profiles)
    .values({ login: identity.login.toLowerCase(), scope: "public", ...fields })
    .onConflictDoUpdate({ target: [profiles.login, profiles.scope], set: fields });
  if (identity.kind === "organization") return { status: "organization", login: identity.login, identity, requests: count.requests };
  return { status: "ok", identity, hidden: chosen.hidden, self, fetchedAt: kept?.fetchedAt ?? null, requests: count.requests };
}

const inflight = new Map<string, Promise<unknown>>();

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = run().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}

async function save(db: Db, scope: Profile["scope"], profile: Profile, raw: Raw) {
  const fields = { githubId: profile.identity.githubId, identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), raw: JSON.stringify(raw), fetchedAt: profile.fetchedAt };
  await db
    .insert(profiles)
    .values({ login: profile.identity.login.toLowerCase(), scope, ...fields })
    .onConflictDoUpdate({ target: [profiles.login, profiles.scope], set: fields });
}

/** A person's Profile, their own private work only when they are the viewer, from a copy at most a day old; `full` waits for their pull requests too. */
export async function readProfile(deps: ProfileDeps, viewer: ProfileViewer, login: string, full = false): Promise<Profile> {
  nameOf(login);
  const scope = await scopeOf(viewer, login);
  const chosen = await choices(deps.db, login);
  if (chosen.hidden && scope !== "self") throw new SiteError(404, "This person has chosen to stay out of comparisons, so their Profile is hidden.");
  if (chosen.namePrivate && scope === "public") {
    const own = await stored(deps.db, login, "self");
    const kept = own?.data ? upgraded(JSON.parse(own.data) as Profile) : null;
    if (kept && (!full || kept.read.complete)) return { ...kept, scope: "public", read: { ...kept.read, requests: 0 } };
  }
  const kept = await stored(deps.db, login, scope);
  const fresh = !!kept?.data && (kept.fetchedAt ?? 0) > now() - PROFILE_FOR;
  const keptProfile = kept?.data ? upgraded(JSON.parse(kept.data) as Profile) : null;
  const key = `${login.toLowerCase()}:${scope}`;
  const count = { requests: 0 };
  const client = async () => gh(deps, await viewer.token().catch(() => null), count);
  if (fresh && keptProfile && (!full || keptProfile.read.complete)) {
    if (full && kept?.raw && !keptProfile.clock?.week && (keptProfile.read.clockAt ?? 0) <= now() - CLOCK_RETRY) {
      const raw = kept.raw;
      return once(`${key}:clock`, async () => {
        const clock = await fetchClock(await client(), keptProfile.identity.login);
        const patched: Profile = { ...keptProfile, clock, read: { ...keptProfile.read, clockAt: now() } };
        await save(deps.db, scope, patched, JSON.parse(raw) as Raw);
        return { ...patched, read: { ...patched.read, requests: count.requests } };
      }).catch(() => ({ ...keptProfile, read: { ...keptProfile.read, requests: 0 } }));
    }
    return { ...keptProfile, read: { ...keptProfile.read, requests: 0 } };
  }
  try {
    const raw =
      fresh && kept?.raw
        ? (JSON.parse(kept.raw) as Raw)
        : await once(`${key}:years`, async () => {
            const c = await client();
            const owner = await fetchOwner(c, login);
            if (!owner || owner.__typename !== "User") throw new SiteError(404, "GitHub has no person by that name.");
            const r = await fetchYears(c, owner);
            await save(deps.db, scope, assemble(r.owner, r.years, null, [], scope, now(), count.requests), r);
            return r;
          });
    if (!full) return assemble(raw.owner, raw.years, null, [], scope, now(), count.requests);
    return await once(`${key}:prs`, async () => {
      const { prs, reviewers, clock } = await fetchPrs(await client(), raw);
      const profile = assemble(raw.owner, raw.years, prs, reviewers, scope, now(), count.requests, clock);
      await save(deps.db, scope, profile, raw);
      return profile;
    });
  } catch (e) {
    if (keptProfile && (!full || keptProfile.read.complete)) return keptProfile;
    throw e;
  }
}

/** The signed-in person's GitHub login. */
export async function loginOf(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ login: user.login }).from(user).where(eq(user.id, userId));
  return row?.login ?? null;
}
