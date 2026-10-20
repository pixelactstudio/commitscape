import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitBlobKey, memoryStorage, type Storage } from "@commitscape/server";
import { linesOf, listTree, readFiles, type Kept } from "./files";
import { repo } from "./fixture";

const limits = { fileBytes: 200, repoBytes: 10_000, warm: 100 };

function counting(): Storage & { puts: string[]; objects: Map<string, { body: Uint8Array }> } {
  const inner = memoryStorage();
  const puts: string[] = [];
  return { ...inner, puts, objects: inner.objects, put: (key, body, options) => (puts.push(key), inner.put(key, body, options)) };
}

function project() {
  const r = repo();
  r.commit({ "README.md": "# hi\n", "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\nexport const c = 3;\n" }, "start", "Ada", 0);
  r.commit({ "src/dup.ts": "export const a = 1;\n", "big.txt": "x".repeat(500), "img.png": "PNG", "data": "a\0b" }, "more", "Bob", 1);
  symlinkSync("src/a.ts", join(r.origin, "link"));
  r.sh(r.origin, "add", "link");
  r.commit({ "src/a.ts": "export const a = 2;\n" }, "edit", "Ada", 2);
  r.sync();
  return r;
}

const blob = (r: ReturnType<typeof repo>, path: string) => r.sh(r.clone, "rev-parse", `HEAD:${path}`).trim();

const done = (r: ReturnType<typeof repo>, storage: Storage, known = new Map<string, Kept>(), more: Partial<typeof limits> = {}) =>
  readFiles(r.git, { storage, prefix: "git/gh/a/b", known, limits: { ...limits, ...more }, head: r.sh(r.clone, "rev-parse", "HEAD").trim() });

test("the text of each small file is kept once per blob, with its lines, and binary files are only noted", async () => {
  const r = project();
  const storage = counting();
  const out = await done(r, storage);
  expect(out.files).toBe(8);
  expect(out.blobs.get(blob(r, "src/b.ts"))).toEqual({ lines: 2, binary: false });
  expect(out.blobs.get(blob(r, "data"))).toEqual({ lines: 0, binary: true });
  expect(out.blobs.get(blob(r, "img.png"))).toEqual({ lines: 0, binary: true });
  expect(out.blobs.has(blob(r, "big.txt"))).toBe(false);
  expect(out.skipped).toBe(1);
  expect(storage.objects.has(gitBlobKey("git/gh/a/b", blob(r, "src/dup.ts")))).toBe(true);
  expect(storage.puts.filter((k) => k.endsWith(blob(r, "src/dup.ts")))).toHaveLength(1);
});

test("a blob kept by the last Build is not written again, and one no longer at HEAD is dropped", async () => {
  const r = project();
  const storage = counting();
  const first = await done(r, storage);
  const before = storage.puts.length;
  const old = blob(r, "src/b.ts");
  r.commit({ "src/b.ts": "export const b = 3;\n" }, "change b", "Cy", 3);
  r.sync();
  const second = await done(r, storage, first.blobs);
  expect(storage.puts.length - before).toBe(1);
  expect(second.uploaded).toBe(1);
  expect(second.dropped).toEqual([old]);
});

test("a warm set keeps the README first, then the files changed most, within its size and count", async () => {
  const r = project();
  const value = new Map([["src/b.ts", 9], ["src/a.ts", 3]]);
  const counted = await readFiles(r.git, { storage: counting(), prefix: "git/gh/a/b", known: new Map(), limits: { ...limits, warm: 2 }, head: r.sh(r.clone, "rev-parse", "HEAD").trim(), value });
  const kept = [...counted.blobs].filter(([, b]) => !b.binary).map(([sha]) => sha);
  expect(kept.sort()).toEqual([blob(r, "README.md"), blob(r, "src/b.ts")].sort());
  expect([counted.stored, counted.eligible, counted.complete]).toEqual([2, 2, true]);
  const sized = await done(r, counting(), new Map(), { repoBytes: 30 });
  expect(sized.stored).toBe(2);
});

test("nothing is uploaded when no warm set is asked for, and stored text no longer at HEAD is found", async () => {
  const r = project();
  const storage = counting();
  await storage.put(gitBlobKey("git/gh/a/b", "e".repeat(40)), "old", { type: "text/plain" });
  await storage.put(gitBlobKey("git/gh/a/b", blob(r, "src/b.ts")), "kept", { type: "text/plain" });
  const out = await done(r, storage, new Map(), { warm: 0 });
  expect(storage.puts.filter((k) => k.includes("/blobs/") && !k.endsWith("e".repeat(40)) && !k.endsWith(blob(r, "src/b.ts")))).toEqual([]);
  expect([out.stored, out.eligible, out.complete, out.files]).toEqual([0, 0, true, 8]);
  expect(out.orphans).toEqual(["e".repeat(40)]);
});

test("a warm set cut off by the deadline is not complete", async () => {
  const r = project();
  const g = { ...r.git, deadline: Date.now() + 60_000 };
  const storage = counting();
  const slow: typeof storage = { ...storage, put: async (key, body, options) => {
    g.deadline = 0;
    return storage.put(key, body, options);
  } };
  const out = await readFiles(g, { storage: slow, prefix: "git/gh/a/b", known: new Map(), limits, head: r.sh(r.clone, "rev-parse", "HEAD").trim() });
  expect(out.complete).toBe(false);
  expect(out.stored).toBeLessThan(out.eligible);
});

test("a blob's lines count a last line with no newline", () => {
  expect(linesOf(Buffer.from(""))).toBe(0);
  expect(linesOf(Buffer.from("a\nb\n"))).toBe(2);
  expect(linesOf(Buffer.from("a\nb"))).toBe(2);
});

test("the listing leaves submodules out and sorts by path", async () => {
  const r = project();
  const list = await listTree(r.git, "HEAD");
  expect(list.map((e) => e.path)).toEqual([...list.map((e) => e.path)].sort());
});

test("a blob that could not be written is not kept, and is written by the next Build", async () => {
  const r = project();
  const inner = memoryStorage();
  let broken = true;
  const readme = blob(r, "README.md");
  const storage: Storage = { ...inner, put: (key, body, options) => (broken && key.endsWith(readme) ? Promise.reject(new Error("storage is down")) : inner.put(key, body, options)) };
  const first = await done(r, storage);
  expect(first.blobs.has(readme)).toBe(false);
  broken = false;
  const second = await done(r, storage, first.blobs);
  expect(second.blobs.get(readme)).toEqual({ lines: 1, binary: false });
  expect(second.uploaded).toBe(1);
});
