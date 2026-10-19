import { expect, test } from "vitest";
import { activityScale } from "./cells";

test("every count falls in the range the legend says", () => {
  for (const most of [1, 2, 3, 7, 40, 454, 4045, 7196]) {
    const { step, ranges } = activityScale(most);
    for (let n = 1; n <= most; n += Math.max(1, Math.floor(most / 300))) {
      const found = ranges.find((r) => n >= r.low && n <= r.high);
      expect(found?.step, `${n} of ${most}`).toBe(step(n));
    }
    expect(step(most)).toBe(ranges.at(-1)?.step);
  }
});

test("ranges are in order, never overlap and start at one", () => {
  const { ranges } = activityScale(454);
  expect(ranges[0]?.low).toBe(1);
  ranges.slice(1).forEach((r, i) => expect(r.low).toBe((ranges[i]?.high ?? 0) + 1));
  expect(ranges.at(-1)?.high).toBe(454);
});

test("nothing changed is no step", () => {
  expect(activityScale(10).step(0)).toBe(0);
});
