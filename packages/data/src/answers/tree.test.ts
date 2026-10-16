import { expect, test } from "vitest";
import { FILE_BIG, FILE_BINARY, FILE_LINK, FILE_STORED, rawBase, rawPath } from "../git";
import { DAY, gitTree, type IndexView } from "./index";

function view(): IndexView {
  const head = [
    { file: 0, blob: "b0", loc: 120, bytes: 6_700, class: "source" as const },
    { file: 1, blob: "b1", loc: 9_000, bytes: 400_000, class: "generated" as const },
    { file: 2, blob: "b2", loc: 0, bytes: 2_000, class: "binary" as const },
    { file: 3, blob: "b3", loc: 1, bytes: 12, class: "symlink" as const },
    { file: 4, blob: "b4", loc: 3, bytes: 30, class: "prose" as const },
  ];
  const paths = ["src/a.ts", "dist/big.js", "logo.png", "link", "README.md"];
  return {
    anchor: 100 * DAY,
    options: { max_changeset_size: 50, coupling_support: 5, ownership_min_commits: 10 },
    lines: true,
    snapshot: { commits: 1, merges: 0, oldest: DAY, newest: DAY, languages: [], code_age: [], suspects: [], releases: [] },
    ids: ["a"],
    time: Float64Array.from([DAY]),
    offset: new Int16Array(1),
    authorDelta: new Int32Array(1),
    person: Int32Array.from([0]),
    flags: new Uint8Array(1),
    kind: new Uint8Array(1),
    start: Uint32Array.from([0, 1]),
    file: Int32Array.from([0]),
    added: Int32Array.from([120]),
    removed: Int32Array.from([0]),
    paths,
    born: new Float64Array(5).fill(DAY),
    last: new Float64Array(5).fill(DAY),
    known: new Uint8Array(5).fill(1),
    role: new Uint8Array(5),
    language: new Array<string | null>(5).fill(null),
    guessedGenerated: new Uint8Array(5),
    lockfile: new Uint8Array(5),
    head,
    headOf: new Map(head.map((h) => [h.file, h])),
    persons: new Map([[0, { id: 0, name: "Ada", colour: 0, login: "ada", traits: 0, identities: 1, commits: 1 }]]),
    byPath: new Map(paths.map((p, i) => [p, i])),
  };
}

const flagOf = (tree: ReturnType<typeof gitTree>, path: string) => tree.flags[tree.paths.indexOf(path)] ?? -1;
const linesOf = (tree: ReturnType<typeof gitTree>, path: string) => tree.lines[tree.paths.indexOf(path)];

test("every text file up to the size shown can be opened, whether or not the Builder kept its text, and its lines come from the Stored Index", () => {
  const tree = gitTree(view(), new Map(), { builtAt: 1, head: "h", branch: "main" });
  expect(flagOf(tree, "src/a.ts")).toBe(FILE_STORED);
  expect(linesOf(tree, "src/a.ts")).toBe(120);
  expect(flagOf(tree, "README.md")).toBe(FILE_STORED);
  expect(flagOf(tree, "dist/big.js")).toBe(FILE_BIG);
  expect(linesOf(tree, "dist/big.js")).toBe(9_000);
  expect(flagOf(tree, "logo.png")).toBe(FILE_BINARY);
  expect(linesOf(tree, "logo.png")).toBeNull();
  expect(flagOf(tree, "link")).toBe(FILE_LINK | FILE_STORED);
  expect([tree.stored, tree.skipped, tree.raw]).toEqual([3, 1, null]);
});

test("a file the Builder found binary stays binary, and the size limit and raw address are the caller's", () => {
  const tree = gitTree(view(), new Map([["b0", { lines: 0, binary: true }]]), { builtAt: 1, head: "h", branch: "main", fileBytes: 1_000, raw: rawBase("acme", "rocket", "h") });
  expect(flagOf(tree, "src/a.ts")).toBe(FILE_BINARY);
  expect(flagOf(tree, "README.md")).toBe(FILE_STORED);
  expect(flagOf(tree, "link")).toBe(FILE_LINK | FILE_STORED);
  expect(tree.raw).toBe("https://raw.githubusercontent.com/acme/rocket/h/");
});

test("a raw address encodes each part of a path on its own", () => {
  expect(rawPath("client/src/pages/[...].tsx")).toBe("client/src/pages/%5B...%5D.tsx");
  expect(rawPath("a b/c#d.md")).toBe("a%20b/c%23d.md");
});
