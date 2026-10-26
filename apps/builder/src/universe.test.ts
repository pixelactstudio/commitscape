import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { expect, test } from "vitest";
import { atlasOf, encodeAtlas, encodeNames, type AtlasRows } from "@commitscape/data/universe";
import { atlasKey, memoryStorage } from "@commitscape/server";
import { atlasFrom, readRows, storeAtlas, writeAtlas } from "./universe";

const rows: AtlasRows = {
  mainline: true,
  newest: 300,
  releases: [["v1", 200]],
  commits: [
    { time: 100, person: 0, bulk: false, firstParent: true, files: [0, 1], changes: [0, 0] },
    { time: 200, person: 1, bulk: false, firstParent: false, files: [1], changes: [1] },
    { time: 300, person: 0, bulk: true, firstParent: true, files: [2], changes: [0] },
  ],
  files: [
    { file: 0, path: "src/a.rs", alive: true, role: 0, language: "Rust", generated: false, lockfile: false, lines: 12 },
    { file: 1, path: "README.md", alive: true, role: 1, language: "Markdown", generated: false, lockfile: false, lines: 3 },
    { file: 2, path: "old/gone.txt", alive: false, role: 0, language: null, generated: false, lockfile: false, lines: null },
  ],
  people: [
    { id: 0, name: "Ada", login: "ada", bot: false },
    { id: 1, name: "Bob", login: null, bot: false },
  ],
};

async function written(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "universe-"));
  const file = join(dir, "universe.jsonl");
  const head = { mainline: rows.mainline, newest: rows.newest, releases: rows.releases, commits: rows.commits.length, files: rows.files.length, people: rows.people.length };
  await writeFile(file, [head, ...rows.commits, ...rows.files, ...rows.people].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, file };
}

test("the rows a Build wrote one per line read back as the rows the Atlas is made from", async () => {
  const { file } = await written();
  expect(await readRows(file)).toEqual(rows);
});

test("rows that end early are refused", async () => {
  const { dir } = await written();
  const short = join(dir, "short.jsonl");
  await writeFile(short, `${JSON.stringify({ mainline: true, newest: 1, releases: [], commits: 2, files: 0, people: 0 })}\n${JSON.stringify(rows.commits[0])}\n`);
  await expect(readRows(short)).rejects.toThrow("ended before its rows did");
});

test("the Atlas made from the rows is the one the Site makes, packed with brotli", async () => {
  const { file } = await written();
  const { atlas, names } = atlasOf(rows);
  const made = await atlasFrom(file, 5);
  expect(new Uint8Array(brotliDecompressSync(made.map))).toEqual(encodeAtlas(atlas));
  expect(new Uint8Array(brotliDecompressSync(made.names))).toEqual(encodeNames(names));
});

test("a Build's Atlas is made in a process of its own and stored where the Site reads it first", async () => {
  const { dir } = await written();
  const storage = memoryStorage();
  const asked: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    asked.push([cmd, ...args]);
    const [, , rowsFile = "", into = "", quality = ""] = args;
    await writeAtlas(rowsFile, into, Number(quality));
    return { code: 0, stderr: "", timedOut: false };
  };
  const pack = "packs/acme/rocket/7/abc-b1-lines.pack";
  expect(await storeAtlas(run, { command: "node", args: ["builder.mjs"], quality: 5 }, storage, { si: 7, pack, dir, timeoutMs: 1000 })).toBe(true);
  expect(asked).toEqual([["node", "builder.mjs", "atlas", join(dir, "universe.jsonl"), dir, "5"]]);
  const map = storage.objects.get(atlasKey(7, pack, "map"));
  expect(map?.encoding).toBe("br");
  expect(new Uint8Array(brotliDecompressSync(map?.body ?? new Uint8Array()))).toEqual(encodeAtlas(atlasOf(rows).atlas));
  expect(storage.objects.has(atlasKey(7, pack, "names"))).toBe(true);
});

test("a Build that wrote no rows makes no Atlas, and one that fails says why", async () => {
  const storage = memoryStorage();
  const empty = await mkdtemp(join(tmpdir(), "universe-"));
  const failing = async () => ({ code: 1, stderr: "out of memory\n", timedOut: false });
  const atlas = { command: "node", args: ["builder.mjs"], quality: 5 };
  expect(await storeAtlas(failing, atlas, storage, { si: 1, pack: "p", dir: empty, timeoutMs: 1000 })).toBe(false);
  const { dir } = await written();
  await expect(storeAtlas(failing, atlas, storage, { si: 1, pack: "p", dir, timeoutMs: 1000 })).rejects.toThrow("making the Atlas failed: out of memory");
  expect(storage.objects.size).toBe(0);
});
