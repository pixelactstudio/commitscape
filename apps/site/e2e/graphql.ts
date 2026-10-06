import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const fixtures = resolve(import.meta.dirname, "../../../fixtures");

function authorOf(name: string, oid: string): string | null {
  try {
    const email = execFileSync("git", ["-C", resolve(fixtures, name), "log", "-1", "--format=%ae", oid], { encoding: "utf8" }).trim().toLowerCase();
    if (email.startsWith("alice@")) return "alice";
    if (email.startsWith("bob@")) return "bob";
    if (email.includes("carol@")) return "carol";
    return null;
  } catch {
    return null;
  }
}

const repo = (nameWithOwner: string, isPrivate = false, language = "Rust") => ({ nameWithOwner, isPrivate, stargazerCount: 42, primaryLanguage: { name: language, color: "#dea584" } });
const who = (login: string) => ({ __typename: "User", login, avatarUrl: `http://127.0.0.1/${login}.png` });

const alice = {
  __typename: "User",
  login: "alice",
  databaseId: 1001,
  name: "Alice Example",
  avatarUrl: "http://127.0.0.1/alice.png",
  bio: "Writes the fixtures",
  company: "Acme",
  location: "Leeds",
  websiteUrl: null,
  twitterUsername: null,
  createdAt: "2019-05-01T00:00:00Z",
  followers: { totalCount: 12 },
  contributionsCollection: { contributionYears: [2026, 2025] },
  merged: { totalCount: 3 },
  open: { totalCount: 1 },
  closed: { totalCount: 0 },
};

const bob = { ...alice, login: "bob", databaseId: 1002, name: "Bob Example", avatarUrl: "http://127.0.0.1/bob.png", bio: null, contributionsCollection: { contributionYears: [2026] }, merged: { totalCount: 5 }, open: { totalCount: 0 }, closed: { totalCount: 1 } };

const calendar = (year: number, every: number) => {
  const days = [];
  for (let d = Date.UTC(year, 0, 1); d <= Date.UTC(year, 11, 31); d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    days.push({ date, contributionCount: new Date(d).getUTCDate() % every === 0 ? 3 : 0 });
  }
  return { weeks: [{ contributionDays: days }] };
};

const years: Record<string, unknown> = {
  y2026: {
    totalCommitContributions: 21,
    totalPullRequestContributions: 4,
    totalPullRequestReviewContributions: 5,
    totalIssueContributions: 2,
    restrictedContributionsCount: 7,
    contributionCalendar: calendar(2026, 3),
    commitContributionsByRepository: [
      { repository: repo("acme/ownership", false, "Shell"), contributions: { totalCount: 15 }, latest: { nodes: [{ occurredAt: "2026-09-30T10:00:00Z" }] }, earliest: { nodes: [{ occurredAt: "2026-01-05T10:00:00Z" }] } },
      { repository: repo("acme/private-thing", true), contributions: { totalCount: 6 }, latest: { nodes: [] }, earliest: { nodes: [] } },
    ],
    pullRequestReviewContributionsByRepository: [{ repository: repo("acme/ownership", false, "Shell"), contributions: { totalCount: 5, nodes: [{ pullRequest: { author: who("bob") } }, { pullRequest: { author: who("carol") } }] } }],
    pullRequestContributionsByRepository: [{ repository: repo("acme/ownership", false, "Shell"), contributions: { totalCount: 4 } }],
  },
  y2025: {
    totalCommitContributions: 9,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalIssueContributions: 0,
    restrictedContributionsCount: 0,
    contributionCalendar: calendar(2025, 9),
    commitContributionsByRepository: [{ repository: repo("alice/dots", false, "Shell"), contributions: { totalCount: 9 }, latest: { nodes: [{ occurredAt: "2025-12-20T10:00:00Z" }] }, earliest: { nodes: [{ occurredAt: "2025-02-01T10:00:00Z" }] } }],
    pullRequestReviewContributionsByRepository: [],
    pullRequestContributionsByRepository: [],
  },
};

const pr = (number: number, state: string, nameWithOwner: string, createdAt: string, mergedAt: string | null, additions: number, deletions: number, isPrivate = false) => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/${nameWithOwner}/pull/${number}`,
  state,
  createdAt,
  mergedAt,
  additions,
  deletions,
  repository: repo(nameWithOwner, isPrivate, "Shell"),
});

const prs = [
  pr(4, "OPEN", "acme/ownership", "2026-09-20T00:00:00Z", null, 10, 1),
  pr(3, "MERGED", "acme/ownership", "2026-08-01T00:00:00Z", "2026-08-01T03:00:00Z", 120, 20),
  pr(2, "MERGED", "acme/private-thing", "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", 60, 6, true),
  pr(1, "MERGED", "acme/ownership", "2026-03-01T00:00:00Z", "2026-03-01T01:00:00Z", 30, 3),
];

/** GitHub's GraphQL API as the Site's Profiles ask it, answered by hand. */
export function graphqlAnswer(query: string, variables: Record<string, unknown>): unknown {
  const login = String(variables.login ?? "").toLowerCase();
  if (query.includes("u0: user(")) {
    const counts: Record<string, [number, number, number, number]> = { alice: [3, 5, 21, 40], bob: [5, 2, 40, 61], carol: [1, 9, 4, 12] };
    const data: Record<string, unknown> = {};
    for (const m of query.matchAll(/u(\d+): user\(login: "([^"]+)"\)/g)) {
      const c = counts[(m[2] ?? "").toLowerCase()];
      data[`u${m[1]}`] = c ? { login: m[2], name: `${m[2]} the tester`, contributionsCollection: { totalCommitContributions: c[2], totalPullRequestReviewContributions: c[1], contributionCalendar: { totalContributions: c[3] } } } : null;
      data[`p${m[1]}`] = { issueCount: c?.[0] ?? 0 };
    }
    return { data };
  }
  if (query.includes("pullRequests(first: 50") && String(variables.name ?? "") === "ownership") {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const who = (login: string) => ({ __typename: "User", login });
    const node = (number: number, author: string, reviewers: string[], ago: number) => ({ number, title: `Change ${number}`, state: "MERGED", createdAt: day(ago + 1), mergedAt: day(ago), updatedAt: day(ago), additions: 10, deletions: 2, author: who(author), reviews: { nodes: reviewers.map((r) => ({ author: who(r), submittedAt: day(ago) })) } });
    return { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(4, "bob", ["alice"], 0), node(3, "bob", ["carol"], 0), node(2, "alice", ["bob"], 0), node(1, "carol", [], 0)] } } } };
  }
  if (query.includes("repositoryOwner")) {
    if (login === "alice") return { data: { repositoryOwner: alice } };
    if (login === "bob") return { data: { repositoryOwner: bob } };
    if (login === "acme") return { data: { repositoryOwner: { __typename: "Organization", login: "acme", databaseId: 2002, name: "Acme", avatarUrl: "http://127.0.0.1/acme.png", description: "Rockets", createdAt: "2018-01-01T00:00:00Z" } } };
    return { data: { repositoryOwner: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a User" }] };
  }
  if (query.includes("repository(owner: $owner, name: $name)")) {
    const name = String(variables.name ?? "");
    const fields: Record<string, unknown> = {};
    for (const m of query.matchAll(/(c\d+): object\(oid: "([0-9a-f]{40})"\)/g)) {
      const login = authorOf(name, m[2] ?? "");
      fields[m[1] ?? ""] = { author: { user: login ? { login } : null } };
    }
    return { data: { repository: fields } };
  }
  if (query.includes("search(query")) {
    const q = String(variables.q ?? "");
    const [, from = "", to = ""] = /(?:created|merged):(\S+)\.\.(\S+)/.exec(q) ?? [];
    const merged = q.includes("is:merged");
    const at = (p: (typeof prs)[number]) => (merged ? (p.mergedAt ?? "") : p.createdAt).slice(0, 10);
    const inside = q.includes("author:alice") ? prs.filter((p) => (!merged || p.mergedAt) && at(p) >= from && at(p) <= to) : [];
    return { data: { search: { issueCount: inside.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: inside } } };
  }
  if (query.includes("pullRequests(first: 100")) {
    return { data: { user: login === "alice" || login === "bob" ? { pullRequests: { nodes: [{ reviews: { nodes: [{ author: who("bob") }] } }, { reviews: { nodes: [{ author: who("bob") }, { author: who("carol") }] } }] } } : null } };
  }
  if (query.includes("contributionsCollection(from")) {
    if (login === "bob") return { data: { user: { y2026: { ...(years.y2026 as object), totalCommitContributions: 40, totalPullRequestReviewContributions: 2, restrictedContributionsCount: 0, contributionCalendar: calendar(2026, 2) } } } };
    if (login !== "alice") return { data: { user: null } };
    return { data: { user: Object.fromEntries(Object.entries(years).filter(([k]) => query.includes(`${k}: contributionsCollection`))) } };
  }
  return { data: null, errors: [{ message: "not in the fake" }] };
}

/** GitHub's commit search for alice, answered by hand. */
export function commitSearch(q: string): unknown {
  if (!q.includes("author:alice")) return { total_count: 0, items: [] };
  const items = [
    { sha: "1".repeat(40), html_url: "https://github.com/acme/ownership/commit/111", commit: { message: "Tidy the docs", author: { date: "2026-08-02T10:00:00Z" } }, repository: { full_name: "acme/ownership", private: false } },
    { sha: "2".repeat(40), html_url: "https://github.com/acme/ownership/commit/222", commit: { message: "Change 3 (#3)", author: { date: "2026-08-01T03:00:00Z" } }, repository: { full_name: "acme/ownership", private: false } },
    { sha: "3".repeat(40), html_url: "https://github.com/acme/private-thing/commit/333", commit: { message: "Quiet fix", author: { date: "2026-08-05T10:00:00Z" } }, repository: { full_name: "acme/private-thing", private: true } },
  ];
  return { total_count: items.length, items };
}
