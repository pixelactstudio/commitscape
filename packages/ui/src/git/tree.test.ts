import { expect, test } from "vitest";
import { ancestorsOf, find, nodesOf, rowsOf } from "./tree";

const paths = ["README.md", "src/main/java/App.java", "src/main/java/util/Log.java", "src/test/AppTest.java", "src/z.ts", "docs/a.md", "docs/b.md"].sort();

test("folders come first and a chain of single folders is one row", () => {
  const root = nodesOf(paths);
  expect(root.children.map((c) => [c.name, c.dir])).toEqual([["docs", true], ["src", true], ["README.md", false]]);
  const src = root.children[1];
  expect(src?.children.map((c) => [c.name, c.path])).toEqual([["main/java", "src/main/java/"], ["test", "src/test/"], ["z.ts", "src/z.ts"]]);
});

test("a folder knows the range of paths it holds", () => {
  const root = nodesOf(paths);
  const java = root.children[1]?.children[0];
  expect([java?.lo, java?.hi]).toEqual([paths.indexOf("src/main/java/App.java"), paths.indexOf("src/main/java/util/Log.java") + 1]);
});

test("only the open folders show their rows", () => {
  const root = nodesOf(paths);
  expect(rowsOf(root, new Set()).map((r) => r.node.name)).toEqual(["docs", "src", "README.md"]);
  const rows = rowsOf(root, new Set(["src/", "src/main/java/"]));
  expect(rows.map((r) => [r.node.name, r.depth])).toEqual([["docs", 0], ["src", 0], ["main/java", 1], ["util", 2], ["App.java", 2], ["test", 1], ["z.ts", 1], ["README.md", 0]]);
});

test("a file is shown by opening every folder above it", () => {
  const root = nodesOf(paths);
  expect(ancestorsOf(root, "src/main/java/util/Log.java")).toEqual(["src/", "src/main/java/", "src/main/java/util/"]);
  expect(ancestorsOf(root, "README.md")).toEqual([]);
});

test("finding a file by letters in order puts a name match and a start of word first", () => {
  expect(find(paths, "", 5)).toEqual([]);
  const found = find(paths, "app", 5).map((i) => paths[i]);
  expect(found[0]).toBe("src/main/java/App.java");
  expect(found).toContain("src/test/AppTest.java");
  expect(find(paths, "zzz", 5)).toEqual([]);
  expect(find(paths, "ajl", 5).map((i) => paths[i])).toContain("src/main/java/util/Log.java");
});
