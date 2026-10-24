import { describe, expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { pullStats } from "./pull-stats";

const { pullRequests, pullReviews, repositories } = schema;

const DAY = 86_400;
const HOUR = 3600;
const AT = Date.UTC(2026, 5, 15) / 1000;

async function stored(unread = false) {
  const deps = await testDeps();
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500, pullsReadAt: 5 });
  const pull = (number: number, state: string, opened: number, took: number | null, extra: Partial<typeof pullRequests.$inferInsert> = {}) => ({
    repoId: "acme/rocket",
    number,
    state,
    author: "alice",
    title: `pull ${number}`,
    createdAt: AT - opened,
    mergedAt: state === "MERGED" && took !== null ? AT - opened + took : null,
    closedAt: state !== "OPEN" && took !== null ? AT - opened + took : null,
    updatedAt: AT - DAY,
    additions: 5,
    deletions: 5,
    headOwner: "acme",
    changedFiles: unread ? null : 2,
    ...extra,
  });
  await deps.db.insert(pullRequests).values([
    pull(1, "MERGED", 40 * DAY, 30 * 60),
    pull(2, "MERGED", 30 * DAY, 5 * HOUR),
    pull(3, "MERGED", 20 * DAY, 3 * DAY, { additions: 400, deletions: 100 }),
    pull(4, "MERGED", 12 * DAY, 10 * DAY, { additions: 3000, deletions: 0 }),
    pull(5, "MERGED", 400 * DAY, 2 * DAY),
    pull(6, "CLOSED", 10 * DAY, 2 * DAY),
    pull(7, "OPEN", 8 * DAY, null),
    pull(8, "OPEN", 200 * DAY, null, { updatedAt: AT - 150 * DAY }),
  ]);
  await deps.db.insert(pullReviews).values([
    { repoId: "acme/rocket", number: 2, reviewer: "bob", reviews: 2, firstAt: AT - 30 * DAY + 2 * HOUR, state: "approved" },
    { repoId: "acme/rocket", number: 3, reviewer: "bob", reviews: 1, firstAt: AT - 20 * DAY + 10 * HOUR, state: "approved" },
    { repoId: "acme/rocket", number: 3, reviewer: "cy", reviews: 4, firstAt: AT - 20 * DAY + 20 * HOUR, state: "commented" },
    { repoId: "acme/rocket", number: 5, reviewer: "cy", reviews: 1, firstAt: AT - 400 * DAY + HOUR, state: "approved" },
  ]);
  return deps;
}

describe("the pull request numbers of a Window", () => {
  test("counts what was opened, merged and closed in the Window and the backlog as it is now", async () => {
    const stats = await pullStats(await stored(), viewer(), "acme", "rocket", { window: "90d" }, AT);
    expect(stats).toMatchObject({ total: 8, unread: 0, opened: 6, merged: 4, closed: 1, open: 2, idle: 1 });
    expect(stats.span).toEqual({ since: AT - 90 * DAY, until: AT });
    const all = await pullStats(await stored(), viewer(), "acme", "rocket", {}, AT);
    expect(all).toMatchObject({ opened: 8, merged: 5, closed: 1 });
    expect(all.span.since).toBeNull();
  });

  test("works out how long merging took, in bands, and how long the first review took", async () => {
    const stats = await pullStats(await stored(), viewer(), "acme", "rocket", { window: "90d" }, AT);
    expect(stats.mergeTime.n).toBe(4);
    expect(stats.mergeTime.bands).toEqual([1, 1, 1, 1, 0]);
    expect(stats.mergeTime.median).toBe((5 * HOUR + 3 * DAY) / 2);
    expect(stats.mergeTime.p90).toBeCloseTo(3 * DAY + (10 * DAY - 3 * DAY) * 0.7, 0);
    expect(stats.firstReview).toEqual({ n: 2, of: 6, median: 6 * HOUR });
    expect(stats.unreviewed).toEqual({ n: 2, of: 4 });
  });

  test("draws throughput by week for a short Window and by month for a long one, with every period there", async () => {
    const week = await pullStats(await stored(), viewer(), "acme", "rocket", { window: "30d" }, AT);
    expect(week.months?.unit).toBe("week");
    expect(week.months?.opened.reduce((a, b) => a + b, 0)).toBe(5);
    const month = await pullStats(await stored(), viewer(), "acme", "rocket", { window: "1y" }, AT);
    expect(month.months?.unit).toBe("month");
    expect(month.months && month.months.opened.length).toBeGreaterThanOrEqual(12);
    expect(month.months?.merged.reduce((a, b) => a + b, 0)).toBe(4);
    expect(month.months?.closed.reduce((a, b) => a + b, 0)).toBe(1);
    expect(month.months?.from).toBe(Date.UTC(2025, 5, 1) / 1000);
  });

  test("buckets sizes and ranks who reviewed the most", async () => {
    const stats = await pullStats(await stored(), viewer(), "acme", "rocket", { window: "all" }, AT);
    expect(stats.sizes.map((s) => [s.size, s.opened])).toEqual([["xs", 0], ["s", 6], ["m", 0], ["l", 1], ["xl", 1]]);
    expect(stats.reviewers).toEqual([
      { login: "cy", pulls: 2, reviews: 5, median: (20 * HOUR + HOUR) / 2 },
      { login: "bob", pulls: 2, reviews: 3, median: (2 * HOUR + 10 * HOUR) / 2 },
    ]);
  });

  test("says how many pull requests have not been read in full", async () => {
    expect((await pullStats(await stored(true), viewer(), "acme", "rocket", {}, AT)).unread).toBe(8);
  });

  test("reads dates chosen as whole days", async () => {
    const stats = await pullStats(await stored(), viewer(), "acme", "rocket", { from: Math.floor((AT - 35 * DAY) / DAY), to: Math.floor((AT - 15 * DAY) / DAY) }, AT);
    expect(stats.opened).toBe(2);
    expect(stats.merged).toBe(2);
  });
});
