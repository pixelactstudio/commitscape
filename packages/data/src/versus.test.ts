import { expect, test } from "vitest";
import type { ProfileRepo } from "./profile";
import { betweenOf, gapsTo, sharedRepositories, versusRows, type VersusSide } from "./versus";

const totals = (over: Record<string, number | null>) => ({ prsOpened: 0, prsMerged: 0, prsClosed: 0, prsOpen: 0, reviews: 0, commits: 0, issues: 0, hidden: 0, linesAdded: 0, linesRemoved: 0, hoursToMerge: null, activeDays: 0, longestStreak: 0, currentStreak: 0, contributions: 0, ...over });

const ada: VersusSide = { identity: { login: "ada", name: "Ada" }, totals: totals({ prsMerged: 40, reviews: 12, commits: 900, linesAdded: 10_000, activeDays: 200, longestStreak: 14, hoursToMerge: 3 }), surviving: 5_000, thisMonth: { prsMerged: 4, contributions: 61 } };
const bo: VersusSide = { identity: { login: "bo", name: "Bo" }, totals: totals({ prsMerged: 55, reviews: 12, commits: 400, linesAdded: null, activeDays: 230, longestStreak: 9, hoursToMerge: 1.5 }), surviving: null, thisMonth: { prsMerged: 7, contributions: 40 } };

test("a winner per view, worked out by hand: the higher number, the lower time to merge, ties, and no winner when either is unknown", () => {
  expect(versusRows(ada, bo).map((r) => [r.view, r.a, r.b, r.winner])).toEqual([
    ["surviving", 5_000, null, null],
    ["prsMerged", 40, 55, "b"],
    ["reviews", 12, 12, "tie"],
    ["commits", 900, 400, "a"],
    ["linesAdded", 10_000, null, null],
    ["activeDays", 200, 230, "b"],
    ["longestStreak", 14, 9, "a"],
    ["hoursToMerge", 3, 1.5, "b"],
  ]);
});

test("the gap to a Rival, this month and over all time, and none where a number is unknown", () => {
  expect(gapsTo(ada, bo).map((g) => [g.label, g.mine, g.theirs])).toEqual([
    ["pull requests merged this month", 4, 7],
    ["contributions this month", 61, 40],
  ]);
  expect(gapsTo(ada, { ...bo, surviving: 5_312 }).at(-1)).toMatchObject({ label: "lines that still run, all time", mine: 5_000, theirs: 5_312 });
});

const repo = (owner: string, name: string, over: Partial<ProfileRepo> = {}): ProfileRepo => ({ owner, name, private: false, stars: 10, language: "Rust", colour: "#dea584", commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, linesAdded: 0, linesRemoved: 0, first: null, last: null, ...over });

test("shared repositories: public ones both worked in, whatever the case of the name, the one where the lesser did most first", () => {
  const mine = [repo("acme", "big", { prsMerged: 50 }), repo("acme", "small", { commits: 3 }), repo("acme", "secret", { private: true, commits: 9 }), repo("acme", "solo", { commits: 40 }), repo("acme", "idle")];
  const theirs = [repo("ACME", "Big", { commits: 1, stars: 99 }), repo("acme", "small", { reviews: 6 }), repo("acme", "secret", { commits: 9 }), repo("acme", "idle", { commits: 5 })];
  const shared = sharedRepositories(mine, theirs);
  expect(shared.map((r) => [r.name, r.stars, r.a.prsMerged + r.a.commits, r.b.commits + r.b.reviews])).toEqual([
    ["small", 10, 3, 6],
    ["big", 99, 50, 1],
  ]);
});

test("between two people: each one's reviews of the other, from either Profile, or none", () => {
  const ada = { identity: { login: "ada" }, partners: [{ login: "Bo", avatar: "", reviewedTheirs: 4, reviewedYours: 1 }] };
  const bo = { identity: { login: "bo" }, partners: [{ login: "ada", avatar: "", reviewedTheirs: 3, reviewedYours: 2 }] };
  expect(betweenOf(ada as never, bo as never)).toEqual({ aReviewedB: 4, bReviewedA: 3 });
  expect(betweenOf(ada as never, { identity: { login: "cy" }, partners: [] } as never)).toBeNull();
});
