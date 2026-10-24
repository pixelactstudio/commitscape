import { expect, test } from "vitest";
import { FILE_STORED, GIT_FORMAT, type GitDir, type GitTree } from "@commitscape/data";
import { bytes, folderStats, heatOf, ownersOf, percent, totalsOf } from "./insights";

const tree: GitTree = {
  v: GIT_FORMAT,
  builtAt: 1,
  head: "h",
  branch: "main",
  logged: 10,
  complete: true,
  people: [{ name: "Ada", login: "ada" }, { name: "Bob", login: null }],
  langs: ["markdown", "typescript"],
  paths: ["README.md", "src/a.ts", "src/b.ts", "src/deep/c.ts"],
  size: [100, 400, 300, 200],
  sha: ["1", "2", "3", "4"],
  lang: [0, 1, 1, 1],
  flags: [FILE_STORED, FILE_STORED, FILE_STORED, FILE_STORED],
  lines: [10, 40, 30, 20],
  churn: [1, 9, 3, 0],
  first: [5, 5, 5, 5],
  last: [50, 90, 70, 20],
  owners: [[0, 1], [0, 6, 1, 3], [1, 3], []],
  dirs: [],
  stored: 4,
  skipped: 0,
};

const dirs = new Map<string, GitDir>([["src/", { path: "src/", files: 3, size: 900, commits: 8, last: 90, owners: [0, 6, 1, 3] }]]);

test("the whole repository is added up once per tree", () => {
  const t = totalsOf(tree);
  expect([t.size, t.lines, t.files]).toEqual([1000, 100, 4]);
  expect(totalsOf(tree)).toBe(t);
});

test("owners come with their share of the commits", () => {
  const o = ownersOf(tree, [0, 6, 1, 3], 9);
  expect(o.map((x) => [x.person.name, x.commits, Math.round(x.share * 100)])).toEqual([["Ada", 6, 67], ["Bob", 3, 33]]);
  expect(o[0]?.person.login).toBe("ada");
  expect(ownersOf(tree, [], 0)).toEqual([]);
});

test("a folder is summed from its files: languages by size, and the files to look at", () => {
  const f = folderStats(tree, "src/", dirs, 2);
  expect([f.files, f.size, f.lines, f.commits, f.last]).toEqual([3, 900, 90, 8, 90]);
  expect(f.languages).toEqual([{ lang: "typescript", size: 900, files: 3 }]);
  expect(f.hot.map((r) => tree.paths[r.index])).toEqual(["src/a.ts", "src/b.ts"]);
  expect(f.cold.map((r) => tree.paths[r.index])).toEqual(["src/deep/c.ts", "src/b.ts"]);
  expect(f.largest.map((r) => tree.paths[r.index])).toEqual(["src/a.ts", "src/b.ts"]);
  const all = folderStats(tree, "", dirs);
  expect(all.files).toBe(4);
  expect(all.languages.map((l) => l.lang)).toEqual(["typescript", "markdown"]);
});

test("bytes, shares and heat read the way people say them", () => {
  expect([bytes(12), bytes(2048), bytes(5 * 1024 ** 2)]).toEqual(["12 B", "2 KB", "5 MB"]);
  expect([percent(1, 1000), percent(0, 10), percent(25, 100), percent(1, 0)]).toEqual(["<1%", "0%", "25%", "—"]);
  expect([heatOf(0, 10), heatOf(1, 10), heatOf(10, 10)]).toEqual([0, 2, 4]);
});
