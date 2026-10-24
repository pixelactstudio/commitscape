import { expect, test } from "vitest";
import { clampSpan, dayOf, dayWords, fractionOf, ticksOf } from "./time";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

test("a time falls across a span from 0 at its start to 1 at its end", () => {
  const span = { from: 100, to: 200 };
  expect(fractionOf(span, 100 * 86_400)).toBe(0);
  expect(fractionOf(span, 150 * 86_400)).toBe(0.5);
  expect(fractionOf(span, 250 * 86_400)).toBe(1.5);
  expect(dayOf(150 * 86_400 + 86_399)).toBe(150);
});

test("a short span is marked by weeks from Monday, a few months by months, many years by years", () => {
  const weeks = ticksOf({ from: day("2026-09-01"), to: day("2026-10-20") }, 10);
  expect(weeks.map((t) => t.label)).toEqual(["7 Sep", "14 Sep", "21 Sep", "28 Sep", "5 Oct", "12 Oct", "19 Oct"]);
  const months = ticksOf({ from: day("2025-11-15"), to: day("2026-06-10") }, 10);
  expect(months.map((t) => t.label)).toEqual(["Dec", "2026", "Feb", "Mar", "Apr", "May", "Jun"]);
  expect(months.filter((t) => t.major).map((t) => t.label)).toEqual(["2026"]);
  const years = ticksOf({ from: day("2013-05-29"), to: day("2026-10-14") }, 8);
  expect(years.map((t) => t.label)).toEqual(["2014", "2016", "2018", "2020", "2022", "2024", "2026"]);
});

test("no marks for an empty span, and a day is written out", () => {
  expect(ticksOf({ from: 5, to: 5 }, 8)).toEqual([]);
  expect(dayWords(day("2026-10-05"))).toBe("5 Oct 2026");
});

test("a span is kept inside its extent", () => {
  const extent = { from: 0, to: 100 };
  expect(clampSpan(-20, 30, extent)).toEqual({ from: 0, to: 30 });
  expect(clampSpan(95, 30, extent)).toEqual({ from: 70, to: 100 });
  expect(clampSpan(10, 500, extent)).toEqual({ from: 0, to: 100 });
});
