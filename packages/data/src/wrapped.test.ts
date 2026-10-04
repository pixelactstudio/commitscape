import { expect, test } from "vitest";
import type { Profile } from "./profile";
import { wrappedOf } from "./wrapped";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

test("a year, worked out by hand: its days, streak, busiest day, months and merged pull requests", () => {
  const firstDay = day("2025-12-30");
  const days = Array.from({ length: 30 }, () => 0);
  const on = (iso: string, n: number) => (days[day(iso) - firstDay] = n);
  on("2025-12-31", 9);
  on("2026-01-01", 2);
  on("2026-01-02", 3);
  on("2026-01-03", 1);
  on("2026-01-10", 7);
  on("2026-01-20", 1);
  const profile = {
    identity: { login: "alice", name: "Alice" },
    years: [{ year: 2026, commits: 11, prs: 3, reviews: 4, issues: 1, hidden: 0, languages: [{ name: "Rust", colour: null, commits: 11 }], top: [{ repo: "acme/rocket", commits: 11, private: false }] }],
    calendar: { firstDay, days },
    prs: [
      { repo: "acme/rocket", number: 1, title: "a", state: "MERGED", createdAt: "2025-12-20T00:00:00Z", mergedAt: "2026-01-02T00:00:00Z", additions: 50, deletions: 5, private: false, stars: 1 },
      { repo: "acme/rocket", number: 2, title: "b", state: "MERGED", createdAt: "2026-01-04T00:00:00Z", mergedAt: "2026-01-05T00:00:00Z", additions: 10, deletions: 1, private: false, stars: 1 },
      { repo: "acme/rocket", number: 3, title: "c", state: "MERGED", createdAt: "2025-11-01T00:00:00Z", mergedAt: "2025-12-01T00:00:00Z", additions: 99, deletions: 99, private: false, stars: 1 },
    ],
    read: { prs: 3, prsTotal: 3, requests: 0, complete: true },
  } as unknown as Profile;
  const w = wrappedOf(profile, 2026);
  expect(w).toMatchObject({ year: 2026, contributions: 14, commits: 11, prsOpened: 3, prsMerged: 2, reviews: 4, issues: 1, linesAdded: 60, linesRemoved: 6, activeDays: 5, longestStreak: 3, busiest: { day: "2026-01-10", contributions: 7 }, complete: true });
  expect(w.months.slice(0, 2)).toEqual([14, 0]);
  expect(w.calendar.days).toHaveLength(365);
  expect(w.repositories).toEqual([{ repo: "acme/rocket", commits: 11, private: false }]);
});
