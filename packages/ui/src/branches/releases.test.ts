import { expect, test } from "vitest";
import type { GitTag } from "@commitscape/data";
import { familiesOf, gapsOf, leadOf, nearestTag } from "./releases";

const DAY = 86_400;
const tag = (name: string, days: number, since?: number): GitTag => ({ name, sha: name, at: days * DAY, ...(since === undefined ? {} : { since }) });

const tags = [tag("ignore-0.4.3", 1000), tag("15.2.0", 990), tag("ignore-0.4.2", 940), tag("15.1.0", 900), tag("grep-0.3", 800), tag("ignore-0.4.1", 700), tag("15.0.0", 600), tag("nightly", 500), tag("14.1.1", 100)];

test("tags are gathered into families: the version lines first, then the named ones, each group with the one released in last first", () => {
  const families = familiesOf(tags);
  expect(families.map((f) => [f.label, f.tags.length, f.newest.name])).toEqual([
    ["15.x", 3, "15.2.0"],
    ["14.x", 1, "14.1.1"],
    ["ignore-", 3, "ignore-0.4.3"],
    ["grep-", 1, "grep-0.3"],
    ["Other tags", 1, "nightly"],
  ]);
  expect(leadOf(families)?.label).toBe("15.x");
});

test("every release of a repository named only by version lands in the line of its major number", () => {
  const react = [tag("v19.1.10", 5000), tag("v19.0.0", 4600), tag("v18.3.1", 4000), tag("v18.0.0", 3000), tag("v16.14.0", 2000), tag("v0.14.9", 500), tag("v0.3-rc1", 100)];
  const families = familiesOf(react);
  expect(families.map((f) => [f.label, f.tags.length])).toEqual([
    ["v19.x", 2],
    ["v18.x", 2],
    ["v16.x", 1],
    ["v0.x", 2],
  ]);
  expect(leadOf(families)?.newest.name).toBe("v19.1.10");
});

test("a family's usual gap is the middle of its newest gaps, nothing for one release", () => {
  const [plain, , ignore, grep] = familiesOf(tags);
  expect(gapsOf(ignore?.tags ?? [])).toEqual([60, 240]);
  expect(ignore?.cadence).toBe(150);
  expect(plain?.cadence).toBe(195);
  expect(grep?.cadence).toBeNull();
});

test("tags made on one day count as one release when working out how often a family is released", () => {
  const same = [tag("v2.1", 1000), tag("v2.0.1", 1000), tag("v2.0", 998), tag("v2.0-rc.1", 990)];
  expect(gapsOf(same)).toEqual([2, 8]);
  expect(familiesOf(same)[0]?.cadence).toBe(5);
});

test("with no plain family the one with most tags leads, and the tag nearest a time is found", () => {
  const only = familiesOf([tag("a-1.0", 10), tag("a-1.1", 20), tag("b-1.0", 30)]);
  expect(leadOf(only)?.key).toBe("a");
  const newestFirst = [tag("c", 300), tag("b", 200), tag("a", 100)];
  expect(nearestTag(newestFirst, 190 * DAY)?.name).toBe("b");
  expect(nearestTag(newestFirst, 1000 * DAY)?.name).toBe("c");
  expect(nearestTag(newestFirst, 1 * DAY)?.name).toBe("a");
  expect(nearestTag([], 5)).toBeUndefined();
});
