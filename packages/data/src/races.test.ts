import { expect, test } from "vitest";
import { leadersOf, previousSeason, raceState, seasonDates, seasonOf } from "./races";

const row = (login: string, prsMerged: number, reviews: number, commits: number, contributions: number) => ({ login, name: null, prsMerged, reviews, commits, contributions });

test("each view has its leaders, ties shared, nobody when everyone has nothing", () => {
  expect(leadersOf([row("a", 3, 0, 10, 20), row("b", 3, 0, 12, 19), row("c", 1, 0, 1, 2)])).toEqual({ prsMerged: ["a", "b"], reviews: [], commits: ["b"], contributions: ["a"] });
  expect(leadersOf([])).toEqual({ prsMerged: [], reviews: [], commits: [], contributions: [] });
});

test("a Season is a calendar month", () => {
  expect(seasonOf(new Date(Date.UTC(2026, 9, 4)))).toBe("2026-10");
  expect(seasonDates("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  expect(seasonDates("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  expect(previousSeason("2026-01")).toBe("2025-12");
  expect(previousSeason("2026-10")).toBe("2026-09");
});

test("a Race is upcoming before its first day, running through its last, finished after", () => {
  expect(raceState("2026-10-05", "2026-10-11", "2026-10-04")).toBe("upcoming");
  expect(raceState("2026-10-05", "2026-10-11", "2026-10-05")).toBe("running");
  expect(raceState("2026-10-05", "2026-10-11", "2026-10-11")).toBe("running");
  expect(raceState("2026-10-05", "2026-10-11", "2026-10-12")).toBe("finished");
});
