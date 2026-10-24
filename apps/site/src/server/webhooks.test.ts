import { describe, expect, test } from "vitest";
import { now, reportPrefix, schema, sealToken } from "@commitscape/server";
import { testDeps } from "#/test/deps";
import { onWebhook, type Event } from "./webhooks";

const { account, builds, lentTokens, pullRequests, pullReviews, repoEvents, repositories, storedIndexes, user } = schema;

const repository = { full_name: "Acme/Rocket", default_branch: "main", stargazers_count: 120, forks_count: 9, open_issues_count: 3 };
const pull = { number: 7, title: "Faster launch", state: "closed", merged_at: "2026-10-01T10:00:00Z", created_at: "2026-09-30T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", additions: 40, deletions: 2, user: { login: "Alice" }, html_url: "https://github.com/acme/rocket/pull/7" };

async function setup() {
  const deps = await testDeps();
  const facts = { fullName: "acme/rocket", stars: 100, forks: 8, openIssues: 1 };
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", reportKey: reportPrefix("acme/rocket", "b1"), reportAt: now(), facts: JSON.stringify(facts), factsAt: now() });
  return deps;
}

describe("GitHub's webhooks", () => {
  test("a push to the default branch rebuilds once, records the push, and keeps the counts every event carries", async () => {
    const deps = await setup();
    const push: Event = { ref: "refs/heads/main", repository, sender: { login: "alice" }, commits: [{}, {}], head_commit: { message: "Launch\n\nmore", url: "u" } };
    expect(await onWebhook(deps, "push", push, "d1")).toMatchObject({ built: true });
    expect(await onWebhook(deps, "push", push, "d2")).toMatchObject({ built: false });
    expect(await onWebhook(deps, "push", { ...push, ref: "refs/heads/feature" }, "d3")).toMatchObject({ built: false, kept: false });
    expect(deps.sent).toHaveLength(1);
    const [row] = await deps.db.select().from(repositories);
    expect(row?.stars).toBe(120);
    expect(JSON.parse(row?.facts ?? "{}")).toMatchObject({ stars: 120, forks: 9, openIssues: 3 });
    expect(await deps.db.select().from(repoEvents)).toEqual(expect.arrayContaining([expect.objectContaining({ id: "d1", kind: "push", actor: "alice", title: "Launch", count: 2 })]));
  });

  test("a delivery GitHub sends again is recorded once", async () => {
    const deps = await setup();
    const star: Event = { action: "created", repository, sender: { login: "bob" } };
    await onWebhook(deps, "star", star, "same");
    await onWebhook(deps, "star", star, "same");
    expect(await deps.db.select().from(repoEvents)).toHaveLength(1);
  });

  test("pull requests and reviews are kept as the Builder keeps them, without asking GitHub", async () => {
    const deps = await setup();
    await onWebhook(deps, "pull_request", { action: "closed", repository, pull_request: pull }, "p1");
    await onWebhook(deps, "pull_request_review", { action: "submitted", repository, pull_request: pull, review: { user: { login: "Carol" }, submitted_at: "2026-10-01T09:00:00Z" } }, "r1");
    await onWebhook(deps, "pull_request_review", { action: "submitted", repository, pull_request: pull, review: { user: { login: "carol" }, submitted_at: "2026-09-30T12:00:00Z" } }, "r2");
    await onWebhook(deps, "pull_request_review", { action: "submitted", repository, pull_request: pull, review: { user: { login: "alice" }, submitted_at: "2026-10-01T09:30:00Z" } }, "r3");
    expect(await deps.db.select().from(pullRequests)).toEqual([expect.objectContaining({ number: 7, author: "alice", state: "MERGED", additions: 40 })]);
    const reviews = await deps.db.select().from(pullReviews);
    expect(reviews).toEqual([expect.objectContaining({ reviewer: "carol", reviews: 2, firstAt: Math.floor(Date.parse("2026-09-30T12:00:00Z") / 1000) })]);
    expect((await deps.db.select().from(repoEvents)).map((e) => e.kind).sort()).toEqual(["pr_merged", "review", "review", "review"]);
  });

  test("a pull request's webhook keeps where it came from, who merged it, its labels and counts, and a review's state", async () => {
    const deps = await setup();
    const fork = {
      ...pull,
      closed_at: "2026-10-01T10:00:00Z",
      draft: false,
      changed_files: 3,
      commits: 2,
      comments: 5,
      merged_by: { login: "Bob" },
      merge_commit_sha: "c".repeat(40),
      labels: [{ name: "perf", color: "0e8a16" }],
      head: { ref: "patch-1", repo: { full_name: "Alice/rocket", owner: { login: "Alice" } } },
      base: { ref: "main", repo: { full_name: "acme/rocket" } },
    };
    await onWebhook(deps, "pull_request", { action: "closed", repository, pull_request: fork }, "p1");
    await onWebhook(deps, "pull_request", { action: "edited", repository, pull_request: { ...pull, updated_at: "2026-10-02T10:00:00Z" } }, "p2");
    expect((await deps.db.select().from(pullRequests))[0]).toMatchObject({
      closedAt: Math.floor(Date.parse("2026-10-01T10:00:00Z") / 1000),
      headRef: "patch-1",
      headOwner: "alice",
      fromFork: true,
      baseRef: "main",
      draft: false,
      changedFiles: 3,
      commits: 2,
      comments: 5,
      mergedBy: "bob",
      mergeCommit: "c".repeat(40),
      labels: [{ name: "perf", colour: "0e8a16" }],
    });
    const review = (state: string, at: string) => ({ action: "submitted", repository, pull_request: fork, review: { user: { login: "carol" }, submitted_at: at, state } });
    await onWebhook(deps, "pull_request_review", review("changes_requested", "2026-10-01T08:00:00Z"), "r1");
    await onWebhook(deps, "pull_request_review", review("approved", "2026-10-01T09:00:00Z"), "r2");
    await onWebhook(deps, "pull_request_review", review("commented", "2026-10-01T09:30:00Z"), "r3");
    expect((await deps.db.select().from(pullReviews))[0]).toMatchObject({
      reviews: 3,
      state: "approved",
      firstAt: Math.floor(Date.parse("2026-10-01T08:00:00Z") / 1000),
      lastAt: Math.floor(Date.parse("2026-10-01T09:30:00Z") / 1000),
      approvedAt: Math.floor(Date.parse("2026-10-01T09:00:00Z") / 1000),
    });
  });

  test("a repository made private stops being public, one deleted loses its Report, and unknown repositories are left alone", async () => {
    const deps = await setup();
    await onWebhook(deps, "repository", { action: "privatized", repository });
    expect((await deps.db.select().from(repositories))[0]?.isPrivate).toBe(true);
    expect(await onWebhook(deps, "push", { ref: "refs/heads/main", repository: { ...repository, full_name: "other/thing" }, commits: [{}] })).toMatchObject({ built: false, kept: false });
    const [si] = await deps.db.insert(storedIndexes).values({ repoId: "acme/rocket", lineage: "1", kept: true, state: "live", lines: true, builtAt: 1 }).returning({ id: storedIndexes.id });
    await deps.storage.put(`atlas/${si?.id}/abc/map.bin.br`, new Uint8Array([1]), { type: "application/octet-stream" });
    await deps.storage.put("atlas/999999/abc/map.bin.br", new Uint8Array([1]), { type: "application/octet-stream" });
    expect(await onWebhook(deps, "repository", { action: "deleted", repository })).toMatchObject({ removed: 1 });
    expect((await deps.db.select().from(repositories))[0]?.reportKey ?? null).toBeNull();
    expect([...deps.storage.objects.keys()].filter((k) => k.startsWith("atlas/"))).toEqual(["atlas/999999/abc/map.bin.br"]);
    expect(await deps.db.select().from(builds)).toHaveLength(0);
  });

  test("a repository made private loses its stored Cards, its people's standing Cards too", async () => {
    const deps = await setup();
    await deps.storage.put("cards/gh/acme/rocket/hall-of-fame-light-d1.png", new Uint8Array([1]), { type: "image/png" });
    await deps.storage.put("cards/gh/acme/rocket/u/alice/standing-light-d1.png", new Uint8Array([1]), { type: "image/png" });
    await deps.storage.put("cards/u/alice/totals-light-d1.png", new Uint8Array([1]), { type: "image/png" });
    await onWebhook(deps, "repository", { action: "privatized", repository });
    expect([...deps.storage.objects.keys()].filter((k) => k.startsWith("cards/"))).toEqual(["cards/u/alice/totals-light-d1.png"]);
  });

  test("a renamed repository is found by its GitHub id and moved to its new name", async () => {
    const deps = await setup();
    await deps.db.update(repositories).set({ githubId: 42 });
    await onWebhook(deps, "repository", { action: "renamed", repository: { ...repository, id: 42, full_name: "Acme/Rocket2", name: "Rocket2", owner: { login: "Acme" } } });
    const rows = await deps.db.select().from(repositories);
    expect(rows.map((r) => r.id)).toEqual(["acme/rocket2"]);
    expect(rows[0]).toMatchObject({ name: "Rocket2", factsAt: 0 });
  });

  test("someone who revokes the App loses their stored tokens and anything they lent", async () => {
    const deps = await setup();
    await deps.db.insert(user).values({ id: "u1", name: "Alice", email: "a@example.com", emailVerified: true, login: "Alice", createdAt: new Date(), updatedAt: new Date() });
    await deps.db.insert(account).values({ id: "a1", accountId: "1", providerId: "github", userId: "u1", accessToken: "x", refreshToken: "y", createdAt: new Date(), updatedAt: new Date() });
    await deps.db.insert(lentTokens).values({ repoId: "acme/rocket", userId: "u1", token: sealToken("s".repeat(32), "ghu_x"), until: now() + 60 });
    expect(await onWebhook(deps, "github_app_authorization", { action: "revoked", sender: { login: "alice" } })).toMatchObject({ kept: true });
    expect(await deps.db.select().from(account)).toEqual([expect.objectContaining({ accessToken: null, refreshToken: null })]);
    expect(await deps.db.select().from(lentTokens)).toHaveLength(0);
  });

  test("repositories added to an installation are linked to it", async () => {
    const deps = await setup();
    await onWebhook(deps, "installation_repositories", { action: "added", installation: { id: 42 }, repositories_added: [{ full_name: "acme/rocket" }] });
    expect((await deps.db.select().from(repositories))[0]?.installationId).toBe(42);
  });
});
