import { expect, test } from "vitest";
import { niceTicks } from "./ticks";

test("ticks are round whole numbers from zero", () => {
  expect(niceTicks(260)).toEqual([0, 100, 200, 300]);
  expect(niceTicks(2)).toEqual([0, 1, 2]);
  expect(niceTicks(1)).toEqual([0, 1]);
  expect(niceTicks(9)).toEqual([0, 5, 10]);
  expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
});

test("the last tick is never below the largest value and there are never many", () => {
  for (const most of [1, 3, 7, 12, 55, 99, 101, 1234, 98765]) {
    const ticks = niceTicks(most);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(most);
    expect(ticks.length).toBeLessThanOrEqual(7);
  }
});

test("nothing to plot still gives an axis", () => {
  expect(niceTicks(0)).toEqual([0, 1]);
});
