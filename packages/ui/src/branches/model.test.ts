import { expect, test } from "vitest";
import type { GitBranch } from "@commitscape/data";
import { authorsOf, binsOf, deleteCommands, extentOf, facetsOf, fitOf, itemsOf, matches, prefixOf, prefixesOf, rowsOf, shellQuote, sortRows, type Filter, type Row } from "./model";

const DAY = 86_400;
const anchor = 1000 * DAY;

const b = (name: string, daysOld: number, over: Partial<GitBranch> = {}): GitBranch => ({
  name,
  sha: name,
  at: anchor - daysOld * DAY,
  author: "Ada",
  login: "ada",
  subject: "",
  ahead: 1,
  behind: 0,
  base: "",
  baseAt: anchor - (daysOld + 5) * DAY,
  merged: false,
  squashed: false,
  parent: "main",
  shared: 0,
  ...over,
});

const data = {
  default: "main",
  builtAt: anchor,
  branches: [
    b("main", 0, { ahead: 0 }),
    b("a/one", 5, { ahead: 9, behind: 40 }),
    b("a/two", 60, { ahead: 2, behind: 100 }),
    b("a/three", 200),
    b("fix", 10, { author: "Bob", login: "bob", pull: { number: 7, state: "OPEN", title: "Fix the thing", mergedAt: null } }),
    b("done", 40, { merged: true, ahead: 0 }),
    b("deps/x", 3, { bot: true, author: "dependabot[bot]", login: "dependabot[bot]" }),
  ],
};

const rows = rowsOf(data);
const open: Filter = { q: "", state: undefined, who: undefined, prefix: undefined, bots: false };

test("every branch but the default one gets its state, its place in the list and the person it is of", () => {
  expect(rows.map((r) => [r.b.name, r.index, r.state, r.who])).toEqual([
    ["a/one", 1, "flight", "ada"],
    ["a/two", 2, "waiting", "ada"],
    ["a/three", 3, "abandoned", "ada"],
    ["fix", 4, "flight", "bob"],
    ["done", 5, "merged", "ada"],
    ["deps/x", 6, "flight", "dependabot[bot]"],
  ]);
});

test("a filter keeps what matches every part of it, and bots only when asked", () => {
  const names = (f: Filter) => rows.filter((r) => matches(r, f)).map((r) => r.b.name);
  expect(names(open)).toEqual(["a/one", "a/two", "a/three", "fix", "done"]);
  expect(names({ ...open, bots: true })).toContain("deps/x");
  expect(names({ ...open, state: "merged" })).toEqual(["done"]);
  expect(names({ ...open, who: "bob" })).toEqual(["fix"]);
  expect(names({ ...open, prefix: "a/" })).toEqual(["a/one", "a/two", "a/three"]);
  expect(names({ ...open, q: "#7" })).toEqual(["fix"]);
  expect(names({ ...open, q: "THING" })).toEqual(["fix"]);
  expect(names({ ...open, q: "ada" })).toEqual(["a/one", "a/two", "a/three", "done"]);
});

test("the numbers of each state leave its own filter out, and say how many bots are hidden", () => {
  expect(facetsOf(rows, { ...open, state: "merged" })).toEqual({ states: { flight: 2, waiting: 1, abandoned: 1, merged: 1 }, hiddenBots: 0 });
  expect(facetsOf(rows, open).hiddenBots).toBe(1);
  expect(facetsOf(rows, { ...open, bots: true }).hiddenBots).toBe(0);
  expect(facetsOf(rows, { ...open, q: "zzz" })).toEqual({ states: { flight: 0, waiting: 0, abandoned: 0, merged: 0 }, hiddenBots: 0 });
});

test("branches sort by newest, oldest, most ahead or most behind commit", () => {
  const order = (by: Parameters<typeof sortRows>[1]) => sortRows(rows, by).map((r) => r.b.name);
  expect(order("new")[0]).toBe("deps/x");
  expect(order("old")[0]).toBe("a/three");
  expect(order("ahead")[0]).toBe("a/one");
  expect(order("behind")[0]).toBe("a/two");
});

test("a prefix shared by three branches is one header where its first member falls, open or closed", () => {
  const sorted = sortRows(rows.filter((r) => r.b.name !== "deps/x"), "new");
  const closed = itemsOf(sorted, () => false);
  expect(closed.map((i) => (i.kind === "group" ? `${i.prefix}:${i.rows.length}:${i.open}` : i.row.b.name))).toEqual(["a/:3:false", "fix", "done"]);
  const opened = itemsOf(sorted, (p) => p === "a/");
  expect(opened.map((i) => (i.kind === "group" ? i.prefix : `${i.indent ? "  " : ""}${i.row.b.name}`))).toEqual(["a/", "  a/one", "  a/two", "  a/three", "fix", "done"]);
  expect(itemsOf(sorted, () => false, false).every((i) => i.kind === "row")).toBe(true);
});

test("people and prefixes are listed by how many branches they have", () => {
  expect(authorsOf(rows).map((a) => [a.key, a.count])).toEqual([["ada", 4], ["bob", 1], ["dependabot[bot]", 1]]);
  expect(prefixesOf(rows)).toEqual([{ prefix: "a/", count: 3 }]);
  expect(prefixOf("plain")).toBeNull();
  expect(prefixOf("/odd")).toBeNull();
});

test("the days shown by default begin where most open branches did, and never fewer than two weeks", () => {
  const fit = fitOf(rows, anchor);
  expect(fit.to).toBe(1001);
  expect(fit.from).toBeLessThan(1001 - 14 + 1);
  expect(fitOf([], anchor)).toEqual({ from: 911, to: 1001 });
  expect(binsOf(rows, { from: 780, to: 1000 }, 4).reduce((n, x) => n + x, 0)).toBe(rows.length);
});

test("a strip covers the days on view and a stretch before them, as far back as the oldest last commit, and counts the branches older than that", () => {
  const fit = { from: 900, to: 1001 };
  const rowsAt = (...days: number[]) => days.map((d) => rowsOf({ default: "main", builtAt: anchor, branches: [b("x", 1000 - d)] })[0] as Row);
  expect(extentOf(rowsAt(990, 950), fit, anchor)).toEqual({ span: { from: 900, to: 1001 }, older: 0 });
  expect(extentOf(rowsAt(990, 500), fit, anchor)).toEqual({ span: { from: 839, to: 1001 }, older: 1 });
  expect(extentOf(rowsAt(990, 880), fit, anchor).span.from).toBe(877);
  expect(extentOf([], fit, anchor)).toEqual({ span: { from: 900, to: 1001 }, older: 0 });
});

test("names are quoted for a shell only when they need it, and long lists are cut into several commands", () => {
  expect(shellQuote("feature/a-b_c.1")).toBe("feature/a-b_c.1");
  expect(shellQuote("it's here")).toBe("'it'\\''s here'");
  expect(shellQuote("a;b")).toBe("'a;b'");
  expect(deleteCommands(["a", "b", "c"], "origin", 2)).toBe("git push origin --delete a b\ngit push origin --delete c");
});

test("rows come out typed", () => {
  const first: Row | undefined = rows[0];
  expect(first?.prefix).toBe("a/");
});
