import { expect, test } from "vitest";
import type { PullHeader } from "@commitscape/data";
import { agoOf, DAY, lifeOf, momentsOf, percent, periodsOf, periodTick, periodWords, sortsOf, spanDates, spanParts, spanWords } from "./model";

test("a length of time is a number and a unit that fit the figure", () => {
  expect(spanParts(40)).toEqual(["40", "s"]);
  expect(spanParts(30 * 60)).toEqual(["30", "min"]);
  expect(spanParts(11.3 * 3600)).toEqual(["11.3", "h"]);
  expect(spanParts(3 * DAY)).toEqual(["3", "d"]);
  expect(spanParts(9 * 30.44 * DAY)).toEqual(["9", "mo"]);
  expect(spanParts(3 * 365.25 * DAY)).toEqual(["3", "y"]);
  expect(spanWords(2 * 3600)).toBe("2 hours");
  expect(spanWords(3600)).toBe("60 minutes");
  expect(spanWords(5 * DAY)).toBe("5 days");
});

test("how long ago a time was reads as hours before a day and days after", () => {
  expect(agoOf(1000, 990)).toBe("just now");
  expect(agoOf(10_000, 10_000 - 20 * 60)).toBe("20 minutes ago");
  expect(agoOf(10 * DAY, 10 * DAY - 5 * 3600)).toBe("5 hours ago");
  expect(agoOf(10 * DAY, 7 * DAY)).toBe("3 days ago");
});

test("how long a pull request lived is to its merge or close, or to now while it is open, and nothing when its end was not read", () => {
  expect(lifeOf({ state: "merged", createdAt: 10, mergedAt: 70, closedAt: null }, 1000)).toBe(60);
  expect(lifeOf({ state: "closed", createdAt: 10, mergedAt: null, closedAt: null }, 1000)).toBeNull();
  expect(lifeOf({ state: "open", createdAt: 10, mergedAt: null, closedAt: null }, 1000)).toBe(990);
});

test("shares are whole percents, under one percent said so, and nothing over nothing", () => {
  expect(percent(1, 3)).toBe("33%");
  expect(percent(1, 1000)).toBe("<1%");
  expect(percent(0, 10)).toBe("0%");
  expect(percent(1, 0)).toBe("—");
});

test("the Window is dates, with no start for all time", () => {
  const to = Date.UTC(2026, 9, 19) / 1000;
  expect(spanDates({ since: null, until: to })).toBe("All time, to 19 Oct 2026");
  expect(spanDates({ since: to - 30 * DAY, until: to })).toBe("19 Sep 2026 to 19 Oct 2026");
});

test("months fold into quarters and years when there are too many columns, and weeks stay weeks", () => {
  const from = Date.UTC(2013, 0, 1) / 1000;
  const n = 120;
  const ones = Array.from({ length: n }, () => 1);
  const months = periodsOf({ unit: "month", from, opened: ones, merged: ones, closed: ones });
  expect(months.unit).toBe("quarter");
  expect(months.periods).toHaveLength(40);
  expect(months.periods[0]).toMatchObject({ opened: 3 });
  expect(periodsOf({ unit: "month", from, opened: Array.from({ length: 200 }, () => 1), merged: [], closed: [] }).unit).toBe("year");
  expect(periodsOf({ unit: "month", from, opened: ones.slice(0, 12), merged: ones.slice(0, 12), closed: ones.slice(0, 12) }).unit).toBe("month");
  const weeks = periodsOf({ unit: "week", from, opened: ones.slice(0, 5), merged: ones.slice(0, 5), closed: ones.slice(0, 5) });
  expect(weeks.unit).toBe("week");
  expect(weeks.periods.map((p) => (p.to - p.from) / DAY)).toEqual([7, 7, 7, 7, 7]);
});

test("quarters and years start on the calendar even when the series does not", () => {
  const from = Date.UTC(2018, 8, 1) / 1000;
  const ones = Array.from({ length: 70 }, () => 1);
  const quarters = periodsOf({ unit: "month", from, opened: ones, merged: ones, closed: ones }, 30);
  expect(quarters.unit).toBe("quarter");
  expect(quarters.periods[0]).toMatchObject({ opened: 1 });
  expect(quarters.periods[1]).toMatchObject({ opened: 3 });
  expect(quarters.periods.map((p) => new Date(p.from * 1000).getUTCMonth()).slice(0, 4)).toEqual([8, 9, 0, 3]);
  expect(quarters.periods.reduce((n, p) => n + p.opened, 0)).toBe(70);
  expect(periodTick({ from: Date.UTC(2019, 0, 1) / 1000 }, "quarter", 2, 24)).toBe("2019");
  expect(periodTick({ from: Date.UTC(2018, 8, 1) / 1000 }, "quarter", 0, 24)).toBe("");
});

test("a column is named by its month, quarter, year or week, and ticks are spaced", () => {
  const jan = { from: Date.UTC(2026, 0, 1) / 1000 };
  expect(periodWords(jan, "month")).toBe("Jan 2026");
  expect(periodWords(jan, "quarter")).toBe("Q1 2026");
  expect(periodWords(jan, "year")).toBe("2026");
  expect(periodWords({ from: Date.UTC(2026, 9, 12) / 1000 }, "week")).toBe("Week of 12 Oct 2026");
  expect(periodTick(jan, "month", 0, 12)).toBe("2026");
  expect(periodTick({ from: Date.UTC(2026, 3, 1) / 1000 }, "month", 3, 12)).toBe("Apr");
  expect(periodTick({ from: Date.UTC(2026, 1, 1) / 1000 }, "month", 1, 12)).toBe("");
});

const header = (extra: Partial<PullHeader>): PullHeader => ({
  number: 7,
  title: "t",
  state: "merged",
  author: "ann",
  createdAt: 100,
  mergedAt: 500,
  closedAt: 500,
  updatedAt: 500,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  commits: 1,
  comments: 0,
  draft: false,
  head: "h",
  headOwner: "ann",
  fork: false,
  base: "main",
  labels: [],
  decision: null,
  mergedBy: "bob",
  mergeCommit: null,
  reviewers: [],
  firstReviewAt: null,
  reviews: [],
  git: false,
  ...extra,
});

test("a pull request's life runs from its opening through each review to its merge, with a last line while it is open", () => {
  const reviews = [{ login: "cy", reviews: 3, firstAt: 200, lastAt: 400, state: "approved" as const, approvedAt: 400 }];
  const merged = momentsOf(header({ reviews }), 900);
  expect(merged.map((m) => [m.kind, m.who, m.at])).toEqual([["opened", "ann", 100], ["review", "cy", 200], ["review", "cy", 400], ["merged", "bob", 500]]);
  expect(merged[2]?.verb).toBe("approved");
  const open = momentsOf(header({ state: "open", mergedAt: null, closedAt: null }), 900);
  expect(open.map((m) => m.kind)).toEqual(["opened", "now"]);
  expect(momentsOf(header({ state: "closed", mergedAt: null }), 900).at(-1)).toMatchObject({ kind: "closed", at: 500 });
});

test("each tab names its own order first and offers the others after it", () => {
  expect(sortsOf("open").map((s) => s.label)).toEqual(["Newest opened", "Recently updated", "Oldest opened", "Largest", "Most comments"]);
  expect(sortsOf("merged").slice(0, 2).map((s) => s.label)).toEqual(["Latest merged", "Newest opened"]);
});
