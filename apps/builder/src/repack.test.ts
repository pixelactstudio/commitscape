import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ensureClone, gitEnv } from "./clone";
import { repo } from "./gitdata/fixture";
import { repackClones, smallPacks } from "./repack";
import { run, type RunOptions, type Runner } from "./run";

const upkeepOff = gitEnv(null);
const n = Number(upkeepOff.GIT_CONFIG_COUNT);
const env = {
  ...upkeepOff,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_COUNT: String(n + 2),
  [`GIT_CONFIG_KEY_${n}`]: "fetch.unpackLimit",
  [`GIT_CONFIG_VALUE_${n}`]: "1",
  [`GIT_CONFIG_KEY_${n + 1}`]: "protocol.file.allow",
  [`GIT_CONFIG_VALUE_${n + 1}`]: "always",
};
const files = (dir: string, kind: string) => readdirSync(join(dir, ".git", "objects", "pack")).filter((f) => f.endsWith(kind));

test("the smallest packs merge until one is twice the size of all before it", () => {
  const sizes = (packs: { bytes: number }[]) => packs.map((p) => p.bytes);
  expect(sizes(smallPacks([{ bytes: 1000 }, { bytes: 1 }, { bytes: 2 }, { bytes: 3 }, { bytes: 50 }]))).toEqual([1, 2, 3]);
  expect(sizes(smallPacks([{ bytes: 1000 }, { bytes: 5 }]))).toEqual([]);
  expect(sizes(smallPacks([{ bytes: 4 }, { bytes: 5 }, { bytes: 6 }]))).toEqual([4, 5, 6]);
});

test("a kept clone with many packs, whole or blobless, has its small packs merged through the memory gate, keeps every object it had and still lacks the ones it was promised", async () => {
  const r = repo();
  r.sh(r.origin, "config", "uploadpack.allowFilter", "true");
  r.commit({ "a.rs": "0\n".repeat(400) }, "first");
  const work = mkdtempSync(join(tmpdir(), "work-"));
  const full = join(work, "repos", "acme", "rocket", "full");
  const lean = join(work, "repos", "acme", "rocket", "lean");
  const url = `file://${r.origin}`;
  const clones = () => Promise.all([ensureClone(run, { url, dir: full, blobless: false, env, timeoutMs: 60_000 }), ensureClone(run, { url, dir: lean, blobless: true, checkout: false, env, timeoutMs: 60_000 })]);
  await clones();
  for (let i = 1; i <= 6; i++) {
    r.commit({ "a.rs": `${i}\n`.repeat(400 + i), [`f${i}.rs`]: `${i}\n` }, `change ${i}`, "Ada", i);
    await clones();
  }
  const objects = (dir: string) => r.sh(dir, "rev-list", "--objects", "--all", "--missing=print").trim().split("\n").filter(Boolean).sort();
  const before = { full: objects(full), lean: objects(lean) };
  expect(before.lean.some((l) => l.startsWith("?"))).toBe(true);
  expect(files(full, ".pack").length).toBeGreaterThan(4);
  const asked: (RunOptions | undefined)[] = [];
  const gate: Runner = (cmd, args, e, t, opts) => {
    asked.push(opts);
    return run(cmd, args, e, t, opts);
  };
  expect((await repackClones(gate, work, 60_000, 4)).sort()).toEqual([full, lean].sort());
  expect(asked.every((o) => (o?.memoryMb ?? 0) > 0)).toBe(true);
  expect(files(full, ".pack").length).toBeLessThanOrEqual(2);
  expect(files(lean, ".pack").length).toBeLessThanOrEqual(2);
  expect(files(lean, ".promisor").length).toBe(files(lean, ".pack").length);
  expect(objects(full)).toEqual(before.full);
  expect(objects(lean)).toEqual(before.lean);
  r.sh(full, "fsck", "--connectivity-only");
  r.sh(lean, "fsck", "--connectivity-only");
  expect(await repackClones(gate, work, 60_000, 4)).toEqual([]);
});

test("every clone and fetch runs with git's own upkeep off", () => {
  const e = gitEnv("t");
  const config = Object.fromEntries(Array.from({ length: Number(e.GIT_CONFIG_COUNT) }, (_, i) => [e[`GIT_CONFIG_KEY_${i}`], e[`GIT_CONFIG_VALUE_${i}`]]));
  expect(config).toMatchObject({ "gc.auto": "0", "maintenance.auto": "false" });
});
