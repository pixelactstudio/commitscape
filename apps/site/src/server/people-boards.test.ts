import { describe, expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { saveChoices } from "./people";
import { distinctSeeds, peopleBoards, placed, windowDates } from "./people-boards";

test("a board's window: this Season, last Season, 90 days or all time", () => {
  const today = new Date(Date.UTC(2026, 9, 4));
  expect(windowDates("season", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  expect(windowDates("last-season", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  expect(windowDates("90d", today)).toEqual({ from: "2026-07-07", to: "2026-10-04" });
  expect(windowDates("all", today)).toEqual({ from: null, to: null });
});

describe("people boards", () => {
  test("seed repositories only, counted in the window, bots and hidden people left out", async () => {
    const db = await testDb();
    await db.insert(schema.repositories).values([
      { id: "a/one", owner: "a", name: "one", seed: true, reportAt: 1 },
      { id: "a/two", owner: "a", name: "two", seed: true, reportAt: 1 },
      { id: "b/other", owner: "b", name: "other", seed: false, reportAt: 1 },
    ]);
    const t = now();
    const pr = (repoId: string, number: number, author: string, mergedAt: number | null) => ({ repoId, number, author, state: mergedAt ? "MERGED" : "OPEN", title: "x", createdAt: t, mergedAt, updatedAt: t, additions: 1, deletions: 1 });
    await db.insert(schema.pullRequests).values([pr("a/one", 1, "ann", t), pr("a/two", 2, "ann", t), pr("a/one", 3, "ben", t), pr("a/one", 4, "ben", t - 200 * 86_400), pr("b/other", 5, "cat", t), pr("a/one", 6, "dependabot[bot]", t), pr("a/one", 7, "ann", null)]);
    await db.insert(schema.pullReviews).values([{ repoId: "a/one", number: 3, reviewer: "ann", reviews: 2, firstAt: t }]);
    let boards = await peopleBoards(db, "90d");
    expect(boards.repositories.map((r) => r.id)).toEqual(["a/one", "a/two"]);
    expect(boards.boards[0]?.rows).toEqual([
      { login: "ann", value: 2, repositories: 2, place: 1 },
      { login: "ben", value: 1, repositories: 1, place: 2 },
    ]);
    expect(boards.boards[1]?.rows).toEqual([{ login: "ann", value: 1, repositories: 1, place: 1 }]);
    expect((await peopleBoards(db, "all")).boards[0]?.rows.find((r) => r.login === "ben")?.value).toBe(2);
    expect((await peopleBoards(db, "90d", "A/Two")).boards[0]?.rows).toEqual([{ login: "ann", value: 1, repositories: 1, place: 1 }]);
    await db.insert(schema.user).values({ id: "u-ann", name: "Ann", email: "ann@example.com", login: "ann" });
    await saveChoices({ db }, "u-ann", "ann", { hidden: true });
    boards = await peopleBoards(db, "90d");
    expect(boards.boards.flatMap((b) => b.rows.map((r) => r.login))).toEqual(["ben"]);
  });
});

test("a renamed or moved repository counts once, under its newest read", () => {
  const rows = [
    { id: "facebook/react", githubId: 7, reportAt: 100 },
    { id: "react/react", githubId: 7, reportAt: 200 },
    { id: "a/one", githubId: null, reportAt: 50 },
    { id: "b/two", githubId: 8, reportAt: null },
  ];
  expect(distinctSeeds(rows).map((r) => r.id)).toEqual(["react/react", "a/one", "b/two"]);
});

test("ties share a place", () => {
  expect(placed([{ value: 9 }, { value: 5 }, { value: 5 }, { value: 2 }]).map((r) => r.place)).toEqual([1, 2, 2, 4]);
});

test("a moved repository's pull requests are not counted twice, bots never rank for lines, ties are in name order, and seeds waiting for a read are told apart", async () => {
  const db = await testDb();
  await db.insert(schema.repositories).values([
    { id: "old/name", owner: "old", name: "name", githubId: 1, seed: true, reportAt: 1, stars: 5 },
    { id: "new/name", owner: "new", name: "name", githubId: 1, seed: true, reportAt: 2, reportKey: "k", stars: 9 },
    { id: "c/later", owner: "c", name: "later", githubId: 2, seed: true },
  ]);
  const t = now();
  const pr = (repoId: string, number: number, author: string) => ({ repoId, number, author, state: "MERGED", title: "x", createdAt: t, mergedAt: t, updatedAt: t, additions: 1, deletions: 1 });
  await db.insert(schema.pullRequests).values([pr("old/name", 1, "zed"), pr("new/name", 1, "zed"), pr("new/name", 2, "amy")]);
  await db.insert(schema.repoPeople).values([
    { repoId: "new/name", reportKey: "k", personId: 1, name: "Renovate", login: "renovate[bot]", commits: 9 },
    { repoId: "new/name", reportKey: "k", personId: 2, name: "Amy", login: "Amy", commits: 3 },
  ]);
  await db.insert(schema.surviving).values([
    { repoId: "new/name", reportKey: "k", personId: 1, status: "counted", lines: 900, askedAt: t },
    { repoId: "new/name", reportKey: "k", personId: 2, status: "counted", lines: 40, askedAt: t },
  ]);
  const boards = await peopleBoards(db, "all");
  expect(boards.repositories.map((r) => r.id)).toEqual(["new/name"]);
  expect(boards.waiting).toBe(1);
  expect(boards.boards[0]?.rows).toEqual([
    { login: "amy", value: 1, repositories: 1, place: 1 },
    { login: "zed", value: 1, repositories: 1, place: 1 },
  ]);
  expect(boards.boards[2]?.rows).toEqual([{ login: "amy", value: 40, repositories: 1, place: 1 }]);
});
