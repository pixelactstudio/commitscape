import { expect, test } from "vitest";
import type { EngineRepo, EngineView } from "@commitscape/data";
import { coverage, survival } from "./survival";

test("Survival is shown only when both numbers are known and it is a share", () => {
  expect(survival(61_148, 106_349)).toBe("57%");
  expect(survival(1, 1000)).toBe("<1%");
  expect(survival(0, 6)).toBe("0%");
  expect(survival(null, 10)).toBeNull();
  expect(survival(10, null)).toBeNull();
  expect(survival(10, 0)).toBeNull();
  expect(survival(12, 10)).toBeNull();
});

const repo = (name: string, status: EngineRepo["surviving"]["status"], lines: number | null, added: number | null): EngineRepo => ({ owner: "acme", name, private: false, builtAt: 1, commits: 3, linesAdded: 10, linesRemoved: 1, first: 1, last: 2, surviving: { status, lines, added } });

test("the total equals the sum of the counted repositories shown, and says how many of all it covers", () => {
  const engine: EngineView = {
    repos: [repo("a", "counted", 100, 400), repo("b", "counted", 20, 50), repo("c", "counting", null, null), repo("d", "failed", null, null)],
    surviving: 999,
    added: 999,
    counting: 1,
    unread: [{ owner: "acme", name: "e", private: false, commits: 9, state: "not_read", reason: null, canRead: true }],
  };
  const c = coverage(engine);
  expect(c.counted.map((r) => r.name)).toEqual(["a", "b"]);
  expect(c.total).toBe(c.counted.reduce((n, r) => n + (r.surviving.lines ?? 0), 0));
  expect(c.total).toBe(120);
  expect(c.added).toBe(450);
  expect(c.waiting.map((r) => r.name)).toEqual(["c", "d"]);
  expect(c.repositories).toBe(5);
  expect(c.busy).toBe(true);
});

test("nothing counted is no total, and a list never checked against GitHub covers an unknown number", () => {
  const c = coverage({ repos: [repo("a", "counting", null, null)], surviving: null, added: null, counting: 1 });
  expect(c.total).toBeNull();
  expect(c.repositories).toBeNull();
  expect(coverage({ repos: [repo("a", "counted", 5, null)], surviving: 5, added: null, counting: 0, unread: [] })).toMatchObject({ total: 5, added: null, repositories: 1, busy: false });
});
