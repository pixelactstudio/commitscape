import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import type { Profile } from "@commitscape/data";
import { assemble, CLOCK_RETRY, localSlot, upgraded, lookupProfile, PROFILE_FOR, readProfile, searchPrs, type ProfileViewer } from "./profiles";

const repo = (nameWithOwner: string, isPrivate = false, language = "Rust") => ({ nameWithOwner, isPrivate, stargazerCount: 10, primaryLanguage: { name: language, color: "#dea584" } });
const who = (login: string, type = "User") => ({ __typename: type, login, avatarUrl: `https://a/${login}` });

const owner = {
  __typename: "User",
  login: "Alice",
  databaseId: 7,
  name: "Alice Example",
  avatarUrl: "https://a/alice",
  bio: "Builds things",
  company: null,
  location: "Leeds",
  websiteUrl: "",
  twitterUsername: null,
  createdAt: "2020-03-01T00:00:00Z",
  followers: { totalCount: 3 },
  contributionsCollection: { contributionYears: [2026, 2025] },
  merged: { totalCount: 3 },
  open: { totalCount: 1 },
  closed: { totalCount: 1 },
};

const days = (list: [string, number][]) => ({ weeks: [{ contributionDays: list.map(([date, contributionCount]) => ({ date, contributionCount })) }] });

const years = {
  y2026: {
    totalCommitContributions: 10,
    totalPullRequestContributions: 3,
    totalPullRequestReviewContributions: 4,
    totalIssueContributions: 1,
    restrictedContributionsCount: 5,
    contributionCalendar: days([["2026-10-01", 2], ["2026-10-02", 1], ["2026-10-03", 0], ["2026-10-04", 4]]),
    commitContributionsByRepository: [
      { repository: repo("acme/rocket"), contributions: { totalCount: 7 }, latest: { nodes: [{ occurredAt: "2026-10-04T10:00:00Z" }] }, earliest: { nodes: [{ occurredAt: "2026-01-02T10:00:00Z" }] } },
      { repository: repo("acme/secret", true, "Go"), contributions: { totalCount: 3 }, latest: { nodes: [] }, earliest: { nodes: [] } },
    ],
    pullRequestReviewContributionsByRepository: [
      { repository: repo("acme/rocket"), contributions: { totalCount: 3, nodes: [{ pullRequest: { author: who("bob") } }, { pullRequest: { author: who("bob") } }, { pullRequest: { author: who("renovate[bot]", "Bot") } }] } },
      { repository: repo("acme/secret", true), contributions: { totalCount: 1, nodes: [{ pullRequest: { author: who("carol") } }] } },
    ],
    pullRequestContributionsByRepository: [
      { repository: repo("acme/rocket"), contributions: { totalCount: 4 } },
      { repository: repo("acme/secret", true), contributions: { totalCount: 1 } },
    ],
  },
  y2025: {
    totalCommitContributions: 2,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalIssueContributions: 0,
    restrictedContributionsCount: 0,
    contributionCalendar: days([["2025-12-30", 1], ["2025-12-31", 1]]),
    commitContributionsByRepository: [{ repository: repo("alice/dots", false, "Shell"), contributions: { totalCount: 2 }, latest: { nodes: [{ occurredAt: "2025-12-31T10:00:00Z" }] }, earliest: { nodes: [{ occurredAt: "2025-12-30T10:00:00Z" }] } }],
    pullRequestReviewContributionsByRepository: [],
  },
};

const pr = (number: number, state: string, nameWithOwner: string, created: string, merged: string | null, additions: number, deletions: number, reviewers: string[] = [], isPrivate = false) => ({
  number,
  title: `change ${number}`,
  state,
  createdAt: created,
  mergedAt: merged,
  additions,
  deletions,
  repository: repo(nameWithOwner, isPrivate),
  reviews: { nodes: reviewers.map((r) => ({ author: who(r) })) },
});

const prs = [
  pr(4, "OPEN", "acme/rocket", "2026-10-03T00:00:00Z", null, 50, 0),
  pr(3, "MERGED", "acme/rocket", "2026-09-01T00:00:00Z", "2026-09-01T02:00:00Z", 100, 10, ["bob"]),
  pr(2, "MERGED", "acme/secret", "2026-08-01T00:00:00Z", "2026-08-01T06:00:00Z", 30, 5, ["carol"], true),
  pr(1, "MERGED", "acme/rocket", "2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z", 20, 20, ["bob", "Alice"]),
  pr(5, "CLOSED", "acme/rocket", "2026-06-01T00:00:00Z", null, 9, 9),
];

const commitTimes = { items: [{ commit: { author: { date: "2026-09-01T23:30:00+05:30" } } }, { commit: { author: { date: "2026-09-02T23:10:00-07:00" } } }, { commit: { author: { date: "2026-09-03T09:00:00Z" } } }, { commit: { author: null } }] };

function fakeGitHub(answers: { owner?: unknown; clock?: () => Response | Promise<Response> } = {}) {
  const asked: string[] = [];
  const tokens: (string | null)[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    if (url.includes("/search/commits")) {
      asked.push("clock");
      tokens.push(new Headers(init.headers).get("authorization"));
      return answers.clock ? answers.clock() : Response.json(commitTimes);
    }
    const body = JSON.parse(String(init.body)) as { query: string; variables: { after?: string | null; q?: string } };
    tokens.push(new Headers(init.headers).get("authorization"));
    if (body.query.includes("repositoryOwner")) {
      asked.push("owner");
      return Response.json({ data: { repositoryOwner: "owner" in answers ? answers.owner : owner } });
    }
    if (body.query.includes("pullRequests(first: 100")) {
      asked.push("reviewers");
      return Response.json({ data: { user: { pullRequests: { nodes: prs.map((p) => ({ reviews: { nodes: p.reviews.nodes } })) } } } });
    }
    if (body.query.includes("search(query")) {
      const year = /created:(\d{4})/.exec(body.variables.q ?? "")?.[1] ?? "";
      expect(body.variables.q).toBe(`author:Alice is:pr created:${year}-01-01..${year}-12-31`);
      const all = prs.filter((p) => p.createdAt.startsWith(year));
      const page = body.variables.after ? all.slice(2) : all.slice(0, 2);
      asked.push(`prs:${year}:${body.variables.after ?? "first"}`);
      return Response.json({ data: { search: { issueCount: all.length, pageInfo: { hasNextPage: !body.variables.after && all.length > 2, endCursor: "c1" }, nodes: [...page, {}] } } });
    }
    const wanted = Object.fromEntries(Object.entries(years).filter(([k]) => body.query.includes(`${k}: contributionsCollection`)));
    asked.push(`years:${Object.keys(wanted).join(",")}`);
    return Response.json({ data: { user: wanted } });
  }) as unknown as typeof fetch;
  return { asked, tokens, fetcher };
}

const anonymous: ProfileViewer = { login: async () => null, token: async () => null };
const as = (login: string, token: string): ProfileViewer => ({ login: async () => login, token: async () => token });

describe("a Profile from GitHub", () => {
  test("its totals, worked out by hand, and private work named to nobody else", async () => {
    const gh = fakeGitHub();
    const deps = { db: await testDb(), github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const quick = await readProfile(deps, anonymous, "alice");
    expect(quick.read.complete).toBe(false);
    expect(quick.totals).toMatchObject({ prsMerged: 3, reviews: 4, commits: 12, linesAdded: null, hoursToMerge: null });
    expect(quick.repositories.find((r) => r.name === "rocket")).toMatchObject({ prsOpened: 4, prsMerged: 0 });
    expect(gh.asked).toEqual(["owner", "years:y2026,y2025"]);
    const p = await readProfile(deps, anonymous, "alice", true);
    expect(p.read.complete).toBe(true);
    expect(p.scope).toBe("public");
    expect(p.totals).toMatchObject({ prsOpened: 5, prsMerged: 3, prsClosed: 1, prsOpen: 1, reviews: 4, commits: 12, issues: 1, hidden: 5, linesAdded: 150, linesRemoved: 35, activeDays: 5, contributions: 9 });
    expect(p.totals.hoursToMerge).toBe(6);
    expect(p.totals.longestStreak).toBe(2);
    expect(p.repositories.map((r) => `${r.owner}/${r.name}`)).toEqual(["acme/rocket", "alice/dots"]);
    expect(p.repositories[0]).toMatchObject({ commits: 7, prsOpened: 4, prsMerged: 2, reviews: 3, linesAdded: 120, linesRemoved: 30, first: "2026-01-02T10:00:00Z", last: "2026-10-04T10:00:00Z" });
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(p.prs.map((x) => x.number)).toEqual([4, 3, 0, 1, 5]);
    expect(p.prs[2]).toMatchObject({ repo: "", number: 0, title: "", private: true, additions: 30, deletions: 5 });
    expect(p.partners.map((x) => [x.login, x.reviewedYours, x.reviewedTheirs])).toEqual([
      ["bob", 2, 2],
      ["carol", 1, 1],
    ]);
    expect(p.years.find((y) => y.year === 2026)?.languages.map((l) => l.name)).toEqual(["Rust", "Go"]);
    expect(p.months.find((m) => m.month === "2026-09")).toEqual({ month: "2026-09", contributions: 0, prsMerged: 1, prs: { merged: 1, open: 0, closed: 0 } });
    expect([...gh.asked].sort()).toEqual(["clock", "owner", "prs:2025:first", "prs:2026:c1", "prs:2026:first", "reviewers", "years:y2026,y2025"]);
    expect(p.read).toMatchObject({ prs: 5, prsTotal: 5, requests: 5, complete: true });
    expect(p.clock?.sampled).toBe(3);
    expect(p.clock?.hours[23]).toBe(2);
    expect(p.clock?.hours[9]).toBe(1);
    expect(p.clock?.week?.[1]?.[23]).toBe(1);
    expect(p.clock?.week?.[2]?.[23]).toBe(1);
    expect(p.clock?.week?.[3]?.[9]).toBe(1);
    expect(p.clock?.week?.flat().reduce((a, b) => a + b, 0)).toBe(3);
    expect(gh.tokens.every((t) => t === "Bearer site")).toBe(true);
  });

  test("the person themselves sees their private work by name, read with their own token", async () => {
    const gh = fakeGitHub();
    const deps = { db: await testDb(), github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const p = await readProfile(deps, as("ALICE", "ghu_alice"), "alice", true);
    expect(p.scope).toBe("self");
    expect(p.repositories.find((r) => r.name === "secret")).toMatchObject({ private: true, commits: 3, prsMerged: 1 });
    expect(gh.tokens.every((t) => t === "Bearer ghu_alice")).toBe(true);
    const other = await readProfile(deps, as("bob", "ghu_bob"), "alice", true);
    expect(JSON.stringify(other)).not.toContain("secret");
  });

  test("a copy less than a day old asks GitHub nothing; an older one is read again", async () => {
    const gh = fakeGitHub();
    const db = await testDb();
    const deps = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    await readProfile(deps, anonymous, "alice", true);
    const before = gh.asked.length;
    const again = await readProfile(deps, anonymous, "Alice", true);
    expect(gh.asked.length).toBe(before);
    expect(again.read.requests).toBe(0);
    expect((await lookupProfile(deps, anonymous, "alice")).requests).toBe(0);
    await db.update(schema.profiles).set({ fetchedAt: now() - PROFILE_FOR - 1, identityAt: now() - PROFILE_FOR - 1 });
    await readProfile(deps, anonymous, "alice", true);
    expect(gh.asked.length).toBe(before + 7);
  });

  test("a name GitHub does not know, an organization, and a name that cannot be a login", async () => {
    const missing = fakeGitHub({ owner: null });
    const db = await testDb();
    expect(await lookupProfile({ db, github: { api: "http://github.test", token: "t", fetcher: missing.fetcher } }, anonymous, "nobody")).toMatchObject({ status: "not_found" });
    const org = fakeGitHub({ owner: { __typename: "Organization", login: "acme", databaseId: 9, name: "Acme", avatarUrl: "https://a/acme", description: "Rockets", createdAt: "2019-01-01T00:00:00Z" } });
    expect(await lookupProfile({ db, github: { api: "http://github.test", token: "t", fetcher: org.fetcher } }, anonymous, "acme")).toMatchObject({ status: "organization", identity: { kind: "organization", bio: "Rockets" } });
    await expect(lookupProfile({ db, github: { api: "http://github.test", token: "t", fetcher: org.fetcher } }, anonymous, "-x")).rejects.toThrow("not a GitHub username");
  });

  test("with no token at all it says how to get one", async () => {
    const gh = fakeGitHub();
    await expect(readProfile({ db: await testDb(), github: { api: "http://github.test", fetcher: gh.fetcher } }, anonymous, "alice")).rejects.toThrow("Sign in with GitHub");
  });
});

describe("when they commit", () => {
  const stored = async (db: Awaited<ReturnType<typeof testDb>>) => {
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.login, "alice"));
    return JSON.parse(row?.data ?? "null") as Profile;
  };
  const age = async (db: Awaited<ReturnType<typeof testDb>>, seconds: number) => {
    const p = await stored(db);
    await db.update(schema.profiles).set({ data: JSON.stringify({ ...p, read: { ...p.read, clockAt: (p.read.clockAt ?? 0) - seconds } }) });
  };

  test("each commit's weekday and hour come from its own clock", () => {
    expect(localSlot("2026-10-04T23:59:00-07:00")).toEqual({ weekday: 6, hour: 23 });
    expect(localSlot("2026-10-05T00:10:00+05:30")).toEqual({ weekday: 0, hour: 0 });
    expect(localSlot("not a date")).toBeNull();
  });

  for (const [why, clock] of [
    ["a rate limit", () => new Response("{}", { status: 403 })],
    ["a refused search", () => new Response("{}", { status: 422 })],
    ["a network failure", () => Promise.reject(new Error("offline"))],
    ["an answer that is not JSON", () => new Response("<html>", { status: 200 })],
  ] as const)
    test(`${why} is kept as unknown, not as no commits, and asked again on a later read`, async () => {
      let failing = true;
      const gh = fakeGitHub({ clock: () => (failing ? clock() : Response.json(commitTimes)) });
      const db = await testDb();
      const deps = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
      const first = await readProfile(deps, anonymous, "alice", true);
      expect(first.clock).toBeNull();
      expect((await stored(db)).clock).toBeNull();
      failing = false;
      const soon = await readProfile(deps, anonymous, "alice", true);
      expect(soon.clock).toBeNull();
      expect(gh.asked.filter((a) => a === "clock")).toHaveLength(1);
      await age(db, CLOCK_RETRY + 1);
      const later = await readProfile(deps, anonymous, "alice", true);
      expect(later.clock?.sampled).toBe(3);
      expect(later.read.requests).toBe(1);
      expect(gh.asked.filter((a) => a === "clock")).toHaveLength(2);
      expect((await stored(db)).clock?.sampled).toBe(3);
      await age(db, CLOCK_RETRY + 1);
      await readProfile(deps, anonymous, "alice", true);
      expect(gh.asked.filter((a) => a === "clock")).toHaveLength(2);
    });

  test("a person with no commits on GitHub is kept as none, and not asked about again", async () => {
    const gh = fakeGitHub({ clock: () => Response.json({ items: [] }) });
    const db = await testDb();
    const deps = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const p = await readProfile(deps, anonymous, "alice", true);
    expect(p.clock).toMatchObject({ sampled: 0 });
    await age(db, CLOCK_RETRY + 1);
    await readProfile(deps, anonymous, "alice", true);
    expect(gh.asked.filter((a) => a === "clock")).toHaveLength(1);
  });

  test("a failure that happens again waits another while before the next try", async () => {
    const gh = fakeGitHub({ clock: () => new Response("{}", { status: 403 }) });
    const db = await testDb();
    const deps = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    await readProfile(deps, anonymous, "alice", true);
    await age(db, CLOCK_RETRY + 1);
    expect((await readProfile(deps, anonymous, "alice", true)).clock).toBeNull();
    await readProfile(deps, anonymous, "alice", true);
    expect(gh.asked.filter((a) => a === "clock")).toHaveLength(2);
  });
});

test("the pull requests opened each month, by how they ended, and a Profile saved before they were counted is brought up to date", () => {
  const at = Date.parse("2026-10-04T12:00:00Z") / 1000;
  const p = assemble(owner as never, years as never, prs as never, [], "public", at, 0);
  const outcomes = Object.fromEntries(p.months.filter((m) => m.prs).map((m) => [m.month, m.prs]));
  expect(outcomes).toEqual({
    "2026-06": { merged: 0, open: 0, closed: 1 },
    "2026-07": { merged: 1, open: 0, closed: 0 },
    "2026-08": { merged: 1, open: 0, closed: 0 },
    "2026-09": { merged: 1, open: 0, closed: 0 },
    "2026-10": { merged: 0, open: 1, closed: 0 },
  });
  const old = { ...p, months: p.months.map((m) => ({ month: m.month, contributions: m.contributions, prsMerged: m.prsMerged })) };
  expect(upgraded(old).months).toEqual(p.months);
  const quick = assemble(owner as never, years as never, null, [], "public", at, 0);
  expect(upgraded(quick)).toBe(quick);
});

test("a streak still running counts today, or up to yesterday when today has nothing yet", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  const on = (iso: string) => assemble(owner as never, years as never, [], [], "public", at(iso), 0).totals;
  expect(on("2026-10-04T12:00:00Z")).toMatchObject({ currentStreak: 1, longestStreak: 2 });
  expect(on("2026-10-05T12:00:00Z").currentStreak).toBe(1);
  expect(on("2026-10-06T12:00:00Z").currentStreak).toBe(0);
});

test("a range holding more than 100 pull requests is split in two and both halves asked, until each fits", async () => {
  const created = Array.from({ length: 250 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString());
  const asked: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body)) as { variables: { q: string; after: string | null } };
    const [, from = "", to = ""] = /created:(\S+)\.\.(\S+)/.exec(variables.q) ?? [];
    asked.push(`${from}..${to}`);
    const inside = created.filter((c) => c.slice(0, 10) >= from && c.slice(0, 10) <= to);
    return Response.json({ data: { search: { issueCount: inside.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: inside.slice(0, 100).map((c, n) => ({ ...prs[1], number: n, createdAt: c })) } } });
  }) as unknown as typeof fetch;
  const found = await searchPrs({ api: "http://github.test", token: "t", fetcher }, "alice", [2025, 2024]);
  expect(found).toHaveLength(250);
  expect(new Set(found.map((p) => p.createdAt)).size).toBe(250);
  expect([...asked].sort()).toEqual(["2024-01-01..2024-12-31", "2025-01-01..2025-04-02", "2025-01-01..2025-07-02", "2025-01-01..2025-12-31", "2025-04-03..2025-07-02", "2025-07-03..2025-12-31"]);
});
