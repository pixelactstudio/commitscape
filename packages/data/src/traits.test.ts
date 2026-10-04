import { describe, expect, test } from "vitest";
import type { ProfilePr } from "./profile";
import { achievementsOf, archetypesOf, isFix, type TraitInput } from "./traits";

const NOW = Date.UTC(2026, 9, 4) / 1000;

function input(over: Partial<TraitInput> = {}, totals: Partial<TraitInput["totals"]> = {}): TraitInput {
  return {
    totals: { prsOpened: 0, prsMerged: 0, prsClosed: 0, prsOpen: 0, reviews: 0, commits: 0, issues: 0, hidden: 0, linesAdded: 0, linesRemoved: 0, hoursToMerge: null, activeDays: 0, longestStreak: 0, currentStreak: 0, contributions: 100, ...totals },
    years: [],
    prs: [],
    clock: null,
    calendar: { firstDay: 0, days: [] },
    complete: true,
    engine: null,
    now: NOW,
    ...over,
  };
}

const pr = (n: number, title: string, extra: Partial<ProfilePr> = {}): ProfilePr => ({ repo: "acme/rocket", number: n, title, state: "MERGED", createdAt: "2026-01-01T00:00:00Z", mergedAt: `2026-01-${String((n % 28) + 1).padStart(2, "0")}T00:00:00Z`, additions: 1, deletions: 1, private: false, stars: 10, ...extra });
const ids = (i: TraitInput) => archetypesOf(i).map((a) => a.id);

describe("Archetypes, each rule at its edges", () => {
  test("none below 50 contributions", () => {
    expect(ids(input({}, { reviews: 500, contributions: 49 }))).toEqual([]);
    expect(ids(input({}, { reviews: 500, contributions: 50 }))).toEqual(["reviewer"]);
  });

  test("Reviewer: more reviews than pull requests opened, and 20 or more", () => {
    expect(ids(input({}, { reviews: 19, prsOpened: 0 }))).toEqual([]);
    expect(ids(input({}, { reviews: 20, prsOpened: 19 }))).toEqual(["reviewer"]);
    expect(ids(input({}, { reviews: 20, prsOpened: 20 }))).toEqual([]);
  });

  test("Janitor: removed more than added in merged pull requests, and 1,000 or more removed; unknown lines are no Janitor", () => {
    expect(ids(input({}, { linesRemoved: 999, linesAdded: 0 }))).toEqual([]);
    expect(ids(input({}, { linesRemoved: 1000, linesAdded: 999 }))).toEqual(["janitor"]);
    expect(ids(input({}, { linesRemoved: 1000, linesAdded: 1000 }))).toEqual([]);
    expect(ids(input({}, { linesRemoved: null, linesAdded: null }))).toEqual([]);
  });

  test("Firefighter: half of the merged pull requests are fixes, and 10 or more", () => {
    const fixes = (n: number) => Array.from({ length: n }, (_, i) => pr(i, `fix: thing ${i}`));
    const others = (n: number) => Array.from({ length: n }, (_, i) => pr(100 + i, `feat: thing ${i}`));
    expect(ids(input({ prs: fixes(9) }))).toEqual([]);
    expect(ids(input({ prs: [...fixes(10), ...others(10)] }))).toEqual(["firefighter"]);
    expect(ids(input({ prs: [...fixes(10), ...others(11)] }))).toEqual([]);
    expect(ids(input({ prs: [...fixes(10), pr(500, "fix: open", { state: "OPEN", mergedAt: null })] }))).toEqual(["firefighter"]);
  });

  test("what counts as a fix", () => {
    for (const t of ["fix: x", "Fix crash", "fix(parser): x", "fix!: x", "Hotfix for login", "bugfix: y", "[fix] z"]) expect(isFix(t)).toBe(true);
    for (const t of ["feat: fixture", "Prefix the names", "Fixture data", "docs: fix typo"]) expect(isFix(t)).toBe(false);
  });

  test("Night Owl: 40% of the newest commits between 22:00 and 04:59 on their own clock, 30 or more read", () => {
    const clock = (night: number, day: number) => {
      const hours = Array(24).fill(0) as number[];
      hours[23] = night;
      hours[12] = day;
      return { hours, sampled: night + day };
    };
    expect(ids(input({ clock: clock(12, 17) }))).toEqual([]);
    expect(ids(input({ clock: clock(12, 18) }))).toEqual(["night-owl"]);
    expect(ids(input({ clock: clock(11, 19) }))).toEqual([]);
    const edges = Array(24).fill(0) as number[];
    edges[4] = 20;
    edges[5] = 30;
    expect(ids(input({ clock: { hours: edges, sampled: 50 } }))).toEqual(["night-owl"]);
    edges[4] = 19;
    edges[5] = 31;
    expect(ids(input({ clock: { hours: edges, sampled: 50 } }))).toEqual([]);
  });

  test("Polyglot: five languages, each 5% or more of commits", () => {
    const year = (counts: number[]) => [{ year: 2026, commits: 0, prs: 0, reviews: 0, issues: 0, hidden: 0, languages: counts.map((commits, i) => ({ name: `L${i}`, colour: null, commits })) }];
    expect(ids(input({ years: year([5, 5, 5, 5, 80]) }))).toEqual(["polyglot"]);
    expect(ids(input({ years: year([4, 5, 5, 5, 81]) }))).toEqual([]);
  });

  test("Weekend Warrior: 40% of the last year's active days on a weekend, 30 or more active days", () => {
    const firstDay = Date.UTC(2026, 0, 3) / 86_400_000;
    const days = (weekend: number, weekday: number) => {
      const out: number[] = [];
      let w = 0;
      let d = 0;
      for (let i = 0; out.length < 365; i++) {
        const dow = (firstDay + i + 4) % 7;
        const isWeekend = dow === 6 || dow === 0;
        if (isWeekend && w < weekend) {
          out.push(1);
          w++;
        } else if (!isWeekend && d < weekday) {
          out.push(1);
          d++;
        } else out.push(0);
      }
      return out;
    };
    expect(ids(input({ calendar: { firstDay, days: days(12, 18) } }))).toEqual(["weekend"]);
    expect(ids(input({ calendar: { firstDay, days: days(11, 19) } }))).toEqual([]);
    expect(ids(input({ calendar: { firstDay, days: days(11, 18) } }))).toEqual([]);
  });

  test("Marathoner: a streak of 30 days", () => {
    expect(ids(input({}, { longestStreak: 29 }))).toEqual([]);
    expect(ids(input({}, { longestStreak: 30 }))).toEqual(["marathoner"]);
  });

  test("Builder: 25 merged pull requests, adding twice what they removed", () => {
    expect(ids(input({}, { prsMerged: 25, linesAdded: 200, linesRemoved: 100 }))).toEqual(["builder"]);
    expect(ids(input({}, { prsMerged: 24, linesAdded: 200, linesRemoved: 100 }))).toEqual([]);
    expect(ids(input({}, { prsMerged: 25, linesAdded: 199, linesRemoved: 100 }))).toEqual([]);
  });

  test("they are tried in order, and the first is the person's", () => {
    expect(ids(input({}, { reviews: 30, longestStreak: 40 }))).toEqual(["reviewer", "marathoner"]);
  });
});

describe("Achievements, each rule at its edges", () => {
  const earned = (i: TraitInput) => achievementsOf(i).filter((a) => a.earned).map((a) => a.id);

  test("a pull request merged into a repository with 10,000 stars, the first one dated", () => {
    expect(earned(input({ prs: [pr(1, "a", { stars: 9_999 })] }))).toEqual([]);
    const a = achievementsOf(input({ prs: [pr(3, "late", { stars: 50_000 }), pr(2, "early", { stars: 10_000, repo: "big/one" }), pr(1, "open", { stars: 90_000, state: "OPEN", mergedAt: null })] })).find((x) => x.id === "star-10k");
    expect(a).toMatchObject({ earned: true, at: "2026-01-03", detail: "big/one#2" });
  });

  test("100 and 1,000 merged pull requests and reviews", () => {
    expect(earned(input({}, { prsMerged: 99, reviews: 99 }))).toEqual([]);
    expect(earned(input({}, { prsMerged: 100, reviews: 100 }))).toEqual(["prs-100", "reviews-100"]);
    expect(earned(input({}, { prsMerged: 1000, reviews: 1000 }))).toEqual(["prs-100", "prs-1000", "reviews-100", "reviews-1000"]);
  });

  test("the 100th merged pull request's day only when every pull request was read", () => {
    const prs = Array.from({ length: 100 }, (_, i) => pr(i, "x", { mergedAt: `2026-0${1 + Math.floor(i / 30)}-15T00:00:00Z` }));
    expect(achievementsOf(input({ prs }, { prsMerged: 100 })).find((a) => a.id === "prs-100")?.at).toBe("2026-04-15");
    expect(achievementsOf(input({ prs }, { prsMerged: 150 })).find((a) => a.id === "prs-100")?.at).toBeNull();
  });

  test("removing 10,000 lines in one pull request", () => {
    expect(earned(input({ prs: [pr(1, "a", { deletions: 9_999 })] }))).toEqual([]);
    expect(achievementsOf(input({ prs: [pr(4, "big clean", { deletions: 10_000 })] })).find((a) => a.id === "demolition")).toMatchObject({ earned: true, detail: "acme/rocket#4, −10,000" });
  });

  test("30- and 100-day streaks", () => {
    expect(earned(input({}, { longestStreak: 29 }))).toEqual([]);
    expect(earned(input({}, { longestStreak: 100 }))).toEqual(["streak-30", "streak-100"]);
  });

  test("10,000 lines still running, and a line that has survived five years", () => {
    const fiveYears = 5 * 365.25 * 86_400;
    expect(earned(input({ engine: { surviving: 9_999, oldest: NOW - fiveYears + 1 } }))).toEqual([]);
    expect(earned(input({ engine: { surviving: 10_000, oldest: NOW - fiveYears } }))).toEqual(["surviving-10k", "survivor-5y"]);
    expect(achievementsOf(input({ engine: { surviving: 10, oldest: Date.UTC(2019, 4, 2) / 1000 } })).find((a) => a.id === "survivor-5y")).toMatchObject({ earned: true, at: "2019-05-02" });
    expect(earned(input({ engine: null }))).toEqual([]);
  });
});
