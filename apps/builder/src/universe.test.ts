import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { atlasOf, encodeAtlas, encodeNames, type AtlasCommitRow, type AtlasFileRow, type AtlasPersonRow, type AtlasRows } from "@commitscape/data/universe";
import { atlasKey, memoryStorage } from "@commitscape/server";
import { writeAtlasMade } from "./fake";
import { storeAtlas } from "./universe";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const bin = join(root, "target/release/commitscape");
const fixtures = join(root, "fixtures");

function readRows(file: string): AtlasRows {
  const [head = "", ...lines] = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const counts = JSON.parse(head) as { mainline: boolean; newest: number; releases: [string, number][]; commits: number; files: number; people: number };
  const rows = lines.map((l) => JSON.parse(l) as unknown);
  return {
    mainline: counts.mainline,
    newest: counts.newest,
    releases: counts.releases,
    commits: rows.slice(0, counts.commits) as AtlasCommitRow[],
    files: rows.slice(counts.commits, counts.commits + counts.files) as AtlasFileRow[],
    people: rows.slice(counts.commits + counts.files) as AtlasPersonRow[],
  };
}

test("a Build's Atlas is made from its pack by commitscape and stored where the Site reads it first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "universe-"));
  const storage = memoryStorage();
  const asked: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    asked.push([cmd, ...args]);
    await writeAtlasMade(args);
    return { code: 0, stderr: "", timedOut: false };
  };
  const pack = "packs/acme/rocket/7/abc-b1-lines.pack";
  await storeAtlas(run, storage, { bin: "commitscape", quality: 5, si: 7, pack, file: join(dir, "pack.bin"), dir, timeoutMs: 1000 });
  expect(asked).toEqual([["commitscape", "atlas", join(dir, "pack.bin"), "--out", join(dir, "atlas"), "--quality", "5"]]);
  const map = storage.objects.get(atlasKey(7, pack, "map"));
  expect(map?.encoding).toBe("br");
  expect(brotliDecompressSync(map?.body ?? new Uint8Array()).toString()).toBe(`map of ${join(dir, "pack.bin")}`);
  expect(storage.objects.has(atlasKey(7, pack, "names"))).toBe(true);
});

test("an Atlas that fails says why and stores nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "universe-"));
  const storage = memoryStorage();
  const failing = async () => ({ code: 1, stderr: "out of memory\n", timedOut: false });
  await expect(storeAtlas(failing, storage, { bin: "commitscape", quality: 5, si: 1, pack: "p", file: join(dir, "pack.bin"), dir, timeoutMs: 1000 })).rejects.toThrow("making the Atlas failed: out of memory");
  expect(storage.objects.size).toBe(0);
});

const why = !existsSync(bin) ? "build the binary first: cargo build --release -p commitscape" : !existsSync(join(fixtures, "crafted/.git")) ? "build the fixtures first: cargo xtask fixtures --force" : null;
const repos = why ? [] : readdirSync(fixtures).filter((name) => name !== "empty" && existsSync(join(fixtures, name, ".git")));

describe.skipIf(why !== null)(`the Atlas commitscape makes from a pack is the Site's own, byte for byte${why ? ` (skipped: ${why})` : ""}`, () => {
  test.each(repos)("%s", async (name) => {
    const dir = await mkdtemp(join(tmpdir(), "atlas-"));
    const env = { ...process.env, COMMITSCAPE_TELEMETRY: "0" };
    execFileSync(bin, ["build", "--offline", "--no-cache", "--out", join(dir, "out"), join(fixtures, name)], { env, stdio: "ignore" });
    execFileSync(bin, ["atlas", join(dir, "out", "pack.bin"), "--out", join(dir, "atlas"), "--raw"], { env, stdio: "ignore" });
    const { atlas, names } = atlasOf(readRows(join(dir, "atlas", "universe.jsonl")));
    const map = readFileSync(join(dir, "atlas", "map.bin"));
    expect(Buffer.from(encodeAtlas(atlas)).equals(map)).toBe(true);
    expect(Buffer.from(encodeNames(names)).equals(readFileSync(join(dir, "atlas", "names.bin")))).toBe(true);
    expect(brotliDecompressSync(readFileSync(join(dir, "atlas", "map.bin.br"))).equals(map)).toBe(true);
    await writeFile(join(dir, "done"), "");
  });
});
