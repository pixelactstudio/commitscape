import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { atlasOf, encodeAtlas, encodeNames, type AtlasCommitRow, type AtlasFileRow, type AtlasPersonRow, type AtlasRows } from "@commitscape/data/universe";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { atlasKey, memoryStorage, schema, type Db } from "@commitscape/server";
import { writeAtlasMade } from "./fake";
import type { Config } from "./config";
import { atlasJob, storeAtlas } from "./universe";

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

const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

test("an Atlas job makes the Atlas of the repository's live pack from R2, once, and leaves alone a pack that is not live or a quick one", async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  const work = await mkdtemp(join(tmpdir(), "atlas-job-"));
  const cfg = { bin: "commitscape", timeLimit: 60, nice: 10, work, atlas: { quality: 5 } } as Config;
  const storage = memoryStorage();
  const pack = "packs/acme/rocket/1/a-b1-lines.pack";
  await db.insert(schema.repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const [si] = await db.insert(schema.storedIndexes).values({ repoId: "acme/rocket", lineage: "1", kept: true, state: "live", lines: true, builtAt: 1, pack, commits: 3 }).returning({ id: schema.storedIndexes.id });
  await db.update(schema.repositories).set({ indexId: si?.id ?? null });
  await storage.put(pack, "the pack", { type: "application/octet-stream" });
  const asked: string[][] = [];
  const run = async (cmd: string, args: string[], _env: NodeJS.ProcessEnv, _t: number, opts?: { memoryMb?: number }) => {
    asked.push([cmd, args[0] ?? "", String(opts?.memoryMb ?? 0)]);
    await writeAtlasMade(args);
    return { code: 0, stderr: "", timedOut: false };
  };
  const job = { repoId: "acme/rocket", si: si?.id ?? 0, pack };
  expect(await atlasJob(job, { db, storage, run, cfg })).toBe("made");
  expect(storage.objects.has(atlasKey(job.si, pack, "map"))).toBe(true);
  expect(asked).toEqual([["commitscape", "atlas", expect.stringMatching(/^[1-9]/) as unknown as string]]);
  expect(await atlasJob(job, { db, storage, run, cfg })).toBe("kept");
  expect(await atlasJob({ ...job, pack: "packs/acme/rocket/1/old-b0-lines.pack" }, { db, storage, run, cfg })).toBe("gone");
  expect(await atlasJob({ ...job, pack: "packs/acme/rocket/1/a-b2-quick.pack" }, { db, storage, run, cfg })).toBe("gone");
  expect(asked).toHaveLength(1);
  expect(readdirSync(join(work, "jobs"))).toEqual([]);
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
