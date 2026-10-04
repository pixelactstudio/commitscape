import { expect, test } from "vitest";
import { binDays, thinMarks } from "./marks";

test("columns are days, weeks, four weeks or quarters, by how long the window is", () => {
  expect(binDays(90)).toBe(1);
  expect(binDays(365)).toBe(7);
  expect(binDays(3650)).toBe(28);
  expect(binDays(365 * 20)).toBe(91);
});

test("releases close together are thinned to those that fit, the newest kept", () => {
  const marks = Array.from({ length: 79 }, (_, i) => ({ day: 1000 + i * 10, label: `v${i}` }));
  const drawn = thinMarks(marks, 1000, 800);
  expect(drawn.length).toBeLessThanOrEqual(Math.ceil(100 / 3.5) + 1);
  expect(drawn.at(-1)?.mark.label).toBe("v78");
  for (let i = 1; i < drawn.length; i++) expect((drawn[i]?.at ?? 0) - (drawn[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(3.5);
  const labelled = drawn.filter((d) => d.labelled);
  for (let i = 1; i < labelled.length; i++) expect((labelled[i]?.at ?? 0) - (labelled[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(13);
});

test("a release outside the window is not drawn", () => {
  expect(thinMarks([{ day: 5, label: "old" }], 100, 50)).toEqual([]);
});
