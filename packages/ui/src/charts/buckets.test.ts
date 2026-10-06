import { expect, test } from "vitest";
import { buckets, sum, unitFor } from "./buckets";

const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

test("a chart counts in days, weeks, months, quarters or years, by how long it covers", () => {
  expect(unitFor(30, true)).toBe("day");
  expect(unitFor(365, true)).toBe("week");
  expect(unitFor(365, false)).toBe("month");
  expect(unitFor(3650, true)).toBe("quarter");
  expect(unitFor(365 * 20, true)).toBe("year");
});

test("periods follow the calendar and are clipped to the days asked for", () => {
  const list = buckets(day("2025-01-15"), 400, false);
  expect(list[0]).toMatchObject({ from: day("2025-01-15"), to: day("2025-02-01"), label: "Jan 2025" });
  expect(list.at(-1)?.to).toBe(day("2025-01-15") + 400);
  expect(list.filter((b) => b.tick).length).toBeLessThanOrEqual(8);
});

test("weeks start on Monday and quarters are named", () => {
  expect(buckets(day("2026-10-01"), 200, true)[0]?.key).toBe(String(day("2026-09-28")));
  expect(buckets(day("2020-02-10"), 3000, false)[0]?.label).toBe("Q1 2020");
});

test("a series sums into its periods", () => {
  const first = day("2025-01-30");
  const list = buckets(first, 150, false);
  expect(sum([1, 1, 1, 5], first, list).slice(0, 2)).toEqual([2, 6]);
});
