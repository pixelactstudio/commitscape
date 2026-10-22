import { expect, test } from "vitest";
import type { GitPullFile } from "@commitscape/data";
import { buildRows, HEIGHTS, heightOf, orderOf, parsePatch, sidesOf } from "./diff";

const patch = ["diff --git a/a.ts b/a.ts", "index 1..2 100644", "--- a/a.ts", "+++ b/a.ts", "@@ -3,4 +3,5 @@ function f() {", " keep", "-gone", "+new", "+more", " tail", "\\ No newline at end of file", ""].join("\n");

const file = (path: string, over: Partial<GitPullFile> = {}): GitPullFile => ({ path, old: null, status: "M", added: 1, removed: 1, binary: false, patch: null, omitted: null, ...over });

test("a unified diff becomes numbered lines past its header", () => {
  const lines = parsePatch(patch);
  expect(lines.map((l) => [l.kind, l.old, l.now, l.text])).toEqual([
    ["hunk", null, null, "@@ -3,4 +3,5 @@ function f() {"],
    ["ctx", 3, 3, "keep"],
    ["del", 4, null, "gone"],
    ["add", null, 4, "new"],
    ["add", null, 5, "more"],
    ["ctx", 5, 6, "tail"],
    ["note", null, null, "No newline at end of file"],
  ]);
});

test("a second hunk restarts the numbers and an empty patch has no lines", () => {
  const two = `${patch}@@ -20 +21 @@\n-a\n+b\n`;
  const lines = parsePatch(two);
  expect(lines.filter((l) => l.kind === "hunk")).toHaveLength(2);
  expect(lines.at(-2)).toMatchObject({ kind: "del", old: 20 });
  expect(lines.at(-1)).toMatchObject({ kind: "add", now: 21 });
  expect(parsePatch("")).toEqual([]);
});

test("rows are a header, hunks and lines for each file, or a note that says why there is nothing, with each file's start and the size of the whole", () => {
  const files = [file("a.ts", { patch }), file("b.png", { binary: true, added: null, removed: null }), file("c.lock", { omitted: "large" }), file("d.ts", { omitted: "cap" }), file("e.ts", { added: 0, removed: 0 })];
  const built = buildRows(files, new Set());
  expect(built.starts).toEqual([0, 9, 12, 15, 18]);
  expect(built.rows.map((r) => r.kind).slice(0, 10)).toEqual(["file", "hunk", "line", "line", "line", "line", "line", "line", "gap", "file"]);
  expect(built.rows.filter((r) => r.kind === "note").map((r) => (r.kind === "note" ? r.why : ""))).toEqual(["binary", "large", "cap", "empty"]);
  expect(built.longest).toBe(25);
  expect(built.digits).toBe(1);
  expect(built.rows.at(-1)).toMatchObject({ kind: "gap" });
  expect(built.rows.reduce((n, r) => n + heightOf(r), 0)).toBe(5 * (HEIGHTS.file + HEIGHTS.gap) + HEIGHTS.hunk + 6 * HEIGHTS.line + 4 * HEIGHTS.note);
});

test("a collapsed file keeps only its header", () => {
  const built = buildRows([file("a.ts", { patch }), file("b.ts", { patch })], new Set([0]));
  expect(built.rows.filter((r) => r.file === 0).map((r) => r.kind)).toEqual(["file", "gap"]);
  expect(built.rows.filter((r) => r.file === 1 && r.kind === "line")).toHaveLength(6);
});

test("the two sides of a patch keep the unchanged lines in both and tell where each diff line is", () => {
  const sides = sidesOf(parsePatch(patch));
  expect(sides.now).toBe("\nkeep\nnew\nmore\ntail");
  expect(sides.old).toBe("\nkeep\ngone\ntail");
  expect(sides.where).toEqual([null, [0, 1], [1, 2], [0, 2], [0, 3], [0, 4], null]);
  expect(sidesOf(parsePatch("@@ -1 +1 @@\n+a\n")).old).toBeNull();
});

test("files are ordered by the lines they changed, the largest first, or by path", () => {
  const files = [file("b.ts", { added: 1, removed: 1 }), file("a.ts", { added: 1, removed: 1 }), file("c.ts", { added: 50, removed: 0 })];
  expect(orderOf(files, "size").map((f) => f.path)).toEqual(["c.ts", "a.ts", "b.ts"]);
  expect(orderOf(files, "path").map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
});
