import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { GIT_FORMAT } from "@commitscape/data";
import { gitFileKey, now, putGitJson, schema } from "@commitscape/server";
import { lockedFor } from "./gates";
import { SiteError } from "./http";
import { gitStatus } from "./git";
import { listPulls, pullAuthors, pullConversation, pullHeader, pullLabels, spanOf } from "./pulls";
import { fakeGitHub, signedIn, testDeps, viewer } from "#/test/deps";

const { pullRequests, pullReviews, repoGit, repositories, session, user } = schema;

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500, pullsReadAt: 5 });
  const pull = (number: number, state: string, author: string, title: string) => ({ repoId: "acme/rocket", number, state, author, title, createdAt: number * 100, mergedAt: state === "MERGED" ? number * 100 + 10 : null, updatedAt: number * 100 + 20, additions: number, deletions: 1 });
  await deps.db.insert(pullRequests).values([
    pull(1, "MERGED", "alice", "feat: launch the rocket"),
    pull(2, "OPEN", "bob", "fix: the fuel line"),
    pull(3, "CLOSED", "alice", "wip: staging"),
    pull(4, "OPEN", "alice", "fix: 100% of the fuel_lines"),
  ]);
  await deps.db.insert(pullReviews).values([
    { repoId: "acme/rocket", number: 2, reviewer: "alice", reviews: 3, firstAt: 250 },
    { repoId: "acme/rocket", number: 2, reviewer: "cy", reviews: 1, firstAt: 260 },
  ]);
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message, e.detail]);

describe("the pull requests list", () => {
  test("lists newest first with the counts of each state, the authors, and who reviewed", async () => {
    const deps = await stored();
    const all = await listPulls(deps, viewer(), "acme", "rocket");
    expect(all.rows.map((r) => r.number)).toEqual([4, 3, 2, 1]);
    expect(all.counts).toEqual({ open: 2, merged: 1, closed: 1 });
    expect(all.total).toBe(4);
    expect(all.rows.find((r) => r.number === 2)).toMatchObject({ state: "open", author: "bob", reviewers: ["alice", "cy"], additions: 2, deletions: 1 });
    expect(all.read).toBe(true);
  });

  test("narrows by state, author and the words of a title, each state's count honouring the other filters", async () => {
    const deps = await stored();
    expect((await listPulls(deps, viewer(), "acme", "rocket", { state: "open" })).rows.map((r) => r.number)).toEqual([4, 2]);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { state: "merged" })).rows.map((r) => r.number)).toEqual([1]);
    const alice = await listPulls(deps, viewer(), "acme", "rocket", { author: "Alice", state: "all" });
    expect(alice.rows.map((r) => r.number)).toEqual([4, 3, 1]);
    expect(alice.counts).toEqual({ open: 1, merged: 1, closed: 1 });
    expect((await listPulls(deps, viewer(), "acme", "rocket", { q: "fuel fix" })).rows.map((r) => r.number)).toEqual([4, 2]);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { q: "100%" })).rows.map((r) => r.number)).toEqual([4]);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { q: "%" })).total).toBe(1);
  });

  test("sorts merged ones by when they were merged, closed ones by when they closed, and narrows by label, base, draft and number", async () => {
    const deps = await stored();
    await deps.db.update(pullRequests).set({ mergedAt: 900 }).where(eq(pullRequests.number, 1));
    await deps.db.insert(pullRequests).values({ repoId: "acme/rocket", number: 5, state: "MERGED", author: "cy", title: "docs", createdAt: 450, mergedAt: 460, closedAt: 460, updatedAt: 470, additions: 900, deletions: 5, baseRef: "next", draft: false, labels: [{ name: "docs", colour: "0075ca" }], mergedBy: "bob", mergeCommit: "m".repeat(40), headRef: "patch-1", headOwner: "cy", fromFork: true, changedFiles: 2, commits: 1, comments: 4, reviewDecision: "approved" });
    await deps.db.update(pullRequests).set({ closedAt: 1000 }).where(eq(pullRequests.number, 3));
    await deps.db.insert(pullReviews).values({ repoId: "acme/rocket", number: 5, reviewer: "bob", reviews: 2, firstAt: 455, lastAt: 458, state: "approved", approvedAt: 458 });
    expect((await listPulls(deps, viewer(), "acme", "rocket", { state: "merged" })).rows.map((r) => r.number)).toEqual([1, 5]);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { sort: "size" })).rows.map((r) => r.number)[0]).toBe(5);
    const docs = await listPulls(deps, viewer(), "acme", "rocket", { label: "docs" });
    expect(docs.rows.map((r) => r.number)).toEqual([5]);
    expect(await pullLabels(deps, viewer(), "acme", "rocket")).toEqual([{ name: "docs", colour: "0075ca", pulls: 1 }]);
    expect(docs.rows[0]).toMatchObject({ base: "next", draft: false, mergedBy: "bob", mergeCommit: "m".repeat(40), head: "patch-1", headOwner: "cy", fork: true, changedFiles: 2, commits: 1, comments: 4, decision: "approved", closedAt: 460, reviewers: ["bob"], firstReviewAt: 455 });
    expect((await listPulls(deps, viewer(), "acme", "rocket", { base: "next" })).total).toBe(1);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { draft: false })).total).toBe(1);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { q: "#3" })).rows.map((r) => r.number)).toEqual([3]);
    expect((await pullHeader(deps, viewer(), "acme", "rocket", 5)).reviews).toEqual([{ login: "bob", reviews: 2, firstAt: 455, lastAt: 458, state: "approved", approvedAt: 458 }]);
  });

  test("pages by thirty and clamps a page that is not there", async () => {
    const deps = await stored();
    await deps.db.insert(pullRequests).values(Array.from({ length: 40 }, (_, i) => ({ repoId: "acme/rocket", number: 100 + i, state: "CLOSED", author: "z", title: "t", createdAt: 1000 + i, updatedAt: 1000 + i, additions: 0, deletions: 0 })));
    const first = await listPulls(deps, viewer(), "acme", "rocket", { page: 1 });
    expect([first.rows.length, first.pages, first.total]).toEqual([30, 2, 44]);
    const last = await listPulls(deps, viewer(), "acme", "rocket", { page: 99 });
    expect([last.page, last.rows.length]).toEqual([2, 14]);
  });
});

describe("the pull requests list over the Window", () => {
  const DAY = 86_400;

  async function windowed() {
    const deps = await testDeps();
    await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500, pullsReadAt: 5 });
    const at = 1000 * DAY;
    const pull = (number: number, state: string, created: number, extra: Partial<typeof pullRequests.$inferInsert> = {}) => ({
      repoId: "acme/rocket",
      number,
      state,
      author: "alice",
      title: `pull ${number}`,
      createdAt: at - created * DAY,
      mergedAt: null,
      updatedAt: at - DAY,
      additions: 1,
      deletions: 1,
      ...extra,
    });
    await deps.db.insert(pullRequests).values([
      pull(1, "MERGED", 200, { mergedAt: at - 150 * DAY, closedAt: at - 150 * DAY }),
      pull(2, "MERGED", 20, { mergedAt: at - 10 * DAY, closedAt: at - 10 * DAY, additions: 600, deletions: 500 }),
      pull(3, "CLOSED", 40, { closedAt: at - 20 * DAY }),
      pull(4, "OPEN", 300, { updatedAt: at - 200 * DAY }),
      pull(5, "OPEN", 5, { draft: true }),
      pull(6, "CLOSED", 90, { closedAt: null, updatedAt: at - 60 * DAY }),
    ]);
    await deps.db.insert(pullReviews).values([
      { repoId: "acme/rocket", number: 2, reviewer: "bob", reviews: 1, firstAt: at - 19 * DAY, state: "approved" },
      { repoId: "acme/rocket", number: 5, reviewer: "bob", reviews: 2, firstAt: at - 4 * DAY, state: "changes_requested" },
    ]);
    return { deps, at };
  }

  test("reads the Window from a name or from whole days, with no start for all time", () => {
    expect(spanOf({ window: "30d" }, 1000)).toEqual({ since: 1000 - 30 * DAY, until: 1000 });
    expect(spanOf({}, 1000)).toEqual({ since: null, until: 1000 });
    expect(spanOf({ from: 10, to: 11 }, 1000)).toEqual({ since: 10 * DAY, until: 12 * DAY - 1 });
  });

  test("lists open ones as they are now and merged and closed ones as they were merged or closed within the Window", async () => {
    const { deps, at } = await windowed();
    const ask = (more: object) => listPulls(deps, viewer(), "acme", "rocket", { window: "30d", ...more }, at);
    const month = await ask({});
    expect(month.counts).toEqual({ open: 2, merged: 1, closed: 1 });
    expect(month.span).toEqual({ since: at - 30 * DAY, until: at });
    expect((await ask({ state: "merged" })).rows.map((r) => r.number)).toEqual([2]);
    expect((await ask({ state: "closed" })).rows.map((r) => r.number)).toEqual([3]);
    expect((await ask({ state: "open" })).rows.map((r) => r.number)).toEqual([5, 4]);
    expect((await listPulls(deps, viewer(), "acme", "rocket", { window: "1y", state: "closed" }, at)).rows.map((r) => r.number)).toEqual([3, 6]);
    expect((await ask({ state: "merged", q: "#1" })).rows.map((r) => r.number)).toEqual([1]);
  });

  test("narrows by size, review, idleness and draft, and orders by size, age and comments", async () => {
    const { deps, at } = await windowed();
    const ask = (more: object) => listPulls(deps, viewer(), "acme", "rocket", { window: "all", ...more }, at);
    expect((await ask({ size: "xl" })).rows.map((r) => r.number)).toEqual([2]);
    expect((await ask({ size: "xs" })).total).toBe(5);
    expect((await ask({ review: "none", state: "merged" })).rows.map((r) => r.number)).toEqual([1]);
    expect((await ask({ review: "approved" })).rows.map((r) => r.number)).toEqual([2]);
    expect((await ask({ review: "changes" })).rows.map((r) => r.number)).toEqual([5]);
    expect((await ask({ stale: true })).rows.map((r) => r.number)).toEqual([4]);
    expect((await ask({ draft: true })).rows.map((r) => r.number)).toEqual([5]);
    expect((await ask({ state: "open", sort: "oldest" })).rows.map((r) => r.number)).toEqual([4, 5]);
    expect((await ask({ sort: "size" })).rows[0]?.number).toBe(2);
    const row = (await ask({ review: "approved" })).rows[0];
    expect(row).toMatchObject({ reviewers: ["bob"], reviewStates: ["approved"] });
  });

  test("finds authors by some letters of a login, the best match and the most pull requests first", async () => {
    const { deps } = await windowed();
    await deps.db.insert(pullRequests).values([
      { repoId: "acme/rocket", number: 90, state: "OPEN", author: "alicia", title: "t", createdAt: 1, updatedAt: 1, additions: 0, deletions: 0 },
      { repoId: "acme/rocket", number: 91, state: "OPEN", author: "malice", title: "t", createdAt: 1, updatedAt: 1, additions: 0, deletions: 0 },
    ]);
    expect(await pullAuthors(deps, viewer(), "acme", "rocket", "")).toEqual([{ login: "alice", pulls: 6 }, { login: "alicia", pulls: 1 }, { login: "malice", pulls: 1 }]);
    expect((await pullAuthors(deps, viewer(), "acme", "rocket", "@ali")).map((a) => a.login)).toEqual(["alice", "alicia", "malice"]);
    expect((await pullAuthors(deps, viewer(), "acme", "rocket", "mal")).map((a) => a.login)).toEqual(["malice"]);
  });
});

describe("one pull request", () => {
  test("has its header from Postgres and says whether its git data was kept", async () => {
    const deps = await stored();
    expect(await pullHeader(deps, viewer(), "acme", "rocket", 2)).toMatchObject({ number: 2, state: "open", git: false, reviews: [{ login: "alice", reviews: 3 }, { login: "cy", reviews: 1 }] });
    await deps.db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "git/gh/acme/rocket", buildId: "b", builtAt: 1, head: "h", branch: "main" });
    await putGitJson(deps.storage, gitFileKey("git/gh/acme/rocket", "pulls"), { v: GIT_FORMAT, builtAt: 1, pulls: { "2": { head: "h", stored: true, bytes: 1 } } });
    expect((await pullHeader(deps, viewer(), "acme", "rocket", 2)).git).toBe(true);
    expect((await pullHeader(deps, viewer(), "acme", "rocket", 1)).git).toBe(false);
    expect(await failure(pullHeader(deps, viewer(), "acme", "rocket", 99))).toEqual([404, "No such pull request.", {}]);
    expect(await failure(pullHeader(deps, viewer(), "acme", "rocket", 0))).toEqual([400, "That is not a pull request's number.", {}]);
  });
});

describe("the pull request counts of the git status", () => {
  test("counts every pull request and those open now, for the sidebar", async () => {
    const deps = await stored();
    await deps.db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "git/gh/acme/rocket", buildId: "b", builtAt: 1, head: "h", branch: "main", pulls: 1 });
    expect(await gitStatus(deps, viewer(), "acme", "rocket")).toMatchObject({ openPulls: 2, pullsTotal: 4, pulls: 1 });
  });
});

describe("a pull request's conversation", () => {
  const answers = {
    "/repos/acme/rocket/pulls/2": { state: "open", draft: false, merged: false, body: "Fixes the fuel line.", user: { login: "bob" }, created_at: "2026-01-01T00:00:00Z", head: { ref: "fuel" }, base: { ref: "main" }, labels: [{ name: "bug", color: "ff0000" }], html_url: "https://github.com/acme/rocket/pull/2" },
    "/repos/acme/rocket/issues/2/comments": [{ id: 1, user: { login: "alice" }, created_at: "2026-01-02T00:00:00Z", body: "Looks good", html_url: "u" }],
    "/repos/acme/rocket/pulls/2/reviews": [{ id: 5, user: { login: "cy" }, state: "APPROVED", submitted_at: "2026-01-03T00:00:00Z", body: "", html_url: "r" }, { id: 6, user: { login: "x" }, state: "PENDING", body: "", html_url: "r" }],
  };

  async function signed() {
    const github = fakeGitHub(answers);
    const deps = await stored();
    deps.github = { api: "http://github.test", fetcher: github.fetcher };
    await deps.db.insert(user).values({ id: "u1", name: "U", email: "u@example.com" });
    await deps.db.insert(session).values({ id: "s1", expiresAt: new Date(Date.now() + 1e6), token: "t", userId: "u1", updatedAt: new Date() });
    return { deps, github };
  }

  test("is read from GitHub with the signed-in person's own token and kept for them", async () => {
    const { deps, github } = await signed();
    const mine = signedIn({ token: async () => "their-token" });
    const read = await pullConversation(deps, mine, "acme", "rocket", 2);
    expect(read).toMatchObject({ body: "Fixes the fuel line.", login: "bob", head: "fuel", base: "main", labels: [{ name: "bug", colour: "ff0000" }], comments: [{ login: "alice", body: "Looks good" }], reviews: [{ login: "cy", state: "APPROVED" }] });
    expect(github.asked).toHaveLength(3);
    await pullConversation(deps, mine, "acme", "rocket", 2);
    expect(github.asked).toHaveLength(3);
  });

  test("is not sent to someone signed out, and spends no request", async () => {
    const { deps, github } = await signed();
    expect(await failure(pullConversation(deps, viewer(), "acme", "rocket", 2))).toEqual([401, "Sign in to read the conversation.", { gate: "pr" }]);
    expect(github.asked).toEqual([]);
    expect(await lockedFor("pr", viewer())).toEqual({ locked: "pr" });
    expect(await lockedFor("pr", signedIn({ token: async () => "t" }))).toBeNull();
  });

  test("says so when GitHub will not show the signed-in person the pull request", async () => {
    const { deps } = await signed();
    const mine = signedIn({ token: async () => "their-token" });
    expect(await failure(pullConversation(deps, mine, "acme", "rocket", 3))).toEqual([502, "GitHub did not let your token read this pull request.", {}]);
  });
});
