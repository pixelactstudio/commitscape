import { describe, expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { saveChoices } from "./people";
import { peopleBoards, windowDates } from "./people-boards";

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
    expect(boards.repositories).toEqual(["a/one", "a/two"]);
    expect(boards.boards[0]?.rows).toEqual([
      { login: "ann", value: 2, repositories: 2 },
      { login: "ben", value: 1, repositories: 1 },
    ]);
    expect(boards.boards[1]?.rows).toEqual([{ login: "ann", value: 1, repositories: 1 }]);
    expect((await peopleBoards(db, "all")).boards[0]?.rows.find((r) => r.login === "ben")?.value).toBe(2);
    expect((await peopleBoards(db, "90d", "A/Two")).boards[0]?.rows).toEqual([{ login: "ann", value: 1, repositories: 1 }]);
    await db.insert(schema.user).values({ id: "u-ann", name: "Ann", email: "ann@example.com", login: "ann" });
    await saveChoices({ db }, "u-ann", "ann", { hidden: true });
    boards = await peopleBoards(db, "90d");
    expect(boards.boards.flatMap((b) => b.rows.map((r) => r.login))).toEqual(["ben"]);
  });
});
