import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { zstdCompress, zstdDecompress } from "node:zlib";
import { lt, sql } from "drizzle-orm";
import { now, schema, sha256, type Db, type Storage } from "@commitscape/server";

const { repoStates } = schema;

const zstd = promisify(zstdCompress);
const unzstd = promisify(zstdDecompress);

export const CHUNK_BYTES = 8 << 20;

const LEAST_BYTES = 512 << 10;

const CUT_BITS = 21;

const LOCAL = "state.json";
const SKIPPED = new Set(["index.lock", "index.load", "graph", "graph.writing", "blame", "merging.part", LOCAL]);
const POINTER = "index.current";
const GENERATION = /^([0-9a-f]{16})\.(cols|head)$/;
const PASSING = /\.(tmp|writing|part|runs)$|^building\./;

const GEAR = (() => {
  const table = new Uint32Array(256);
  let x = 0x9e3779b9;
  for (let i = 0; i < 256; i++) {
    x = (x + 0x6d2b79f5) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    table[i] = (z ^ (z >>> 14)) >>> 0;
  }
  return table;
})();

function cutAt(buf: Buffer, have: number): number {
  if (have <= LEAST_BYTES) return have;
  const limit = Math.min(have, CHUNK_BYTES);
  let h = 0;
  for (let i = LEAST_BYTES; i < limit; i++) {
    h = ((h << 1) + (GEAR[buf[i] ?? 0] ?? 0)) >>> 0;
    if (h >>> (32 - CUT_BITS) === 0) return i + 1;
  }
  return limit;
}

/** A file cut where its content says, between 512 KB and 8 MB, about 2.5 MB apart: bytes inserted or removed change only the chunks around them. */
async function* chunksOf(path: string): AsyncGenerator<Buffer> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(2 * CHUNK_BYTES);
    let have = 0;
    let done = false;
    for (;;) {
      while (!done && have < CHUNK_BYTES) {
        const { bytesRead } = await handle.read(buf, have, buf.length - have, null);
        if (bytesRead === 0) done = true;
        else have += bytesRead;
      }
      if (have === 0) return;
      const end = cutAt(buf, have);
      yield Buffer.from(buf.subarray(0, end));
      buf.copy(buf, 0, end, have);
      have -= end;
    }
  } finally {
    await handle.close();
  }
}
const DAY = 24 * 3600;
const AT_ONCE = 4;

async function* inOrder<T, R>(items: readonly T[], most: number, get: (item: T) => Promise<R>): AsyncGenerator<R> {
  const pending: Promise<R>[] = [];
  let next = 0;
  const start = () => {
    const p = get(items[next++] as T);
    p.catch(() => undefined);
    pending.push(p);
  };
  while (next < items.length && pending.length < most) start();
  while (pending.length > 0) {
    const first = await (pending.shift() as Promise<R>);
    if (next < items.length) start();
    yield first;
  }
}

type Entry = { path: string; size: number; mtime: number; chunks: string[] };
type Manifest = { version: 1; files: Entry[] };

export type StateKeys = { seal: Buffer; name: Buffer };

/** The keys a Repo State is sealed and named with in R2, from the Builder's own STATE_KEY: no one without it can read the email addresses an engine cache holds. */
export function stateKeys(secret: string): StateKeys {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, "commitscape", info, 32));
  return { seal: derive("repo state seal"), name: derive("repo state name") };
}

export type StateTier = { storage: Storage; keys: StateKeys; db?: Db; log?: (line: string) => void };

/** Where a repository's State is kept in R2. */
export const statePrefix = (repoId: string) => `state/${sha256(repoId).slice(0, 32)}/`;

const nameOf = (keys: StateKeys, bytes: Uint8Array) => createHmac("sha256", keys.name).update(bytes).digest("hex").slice(0, 40);

async function seal(keys: StateKeys, bytes: Uint8Array): Promise<Uint8Array> {
  const packed = await zstd(bytes);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.seal, iv);
  return Buffer.concat([iv, cipher.update(packed), cipher.final(), cipher.getAuthTag()]);
}

async function unseal(keys: StateKeys, bytes: Uint8Array): Promise<Buffer> {
  const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decipher = createDecipheriv("aes-256-gcm", keys.seal, all.subarray(0, 12));
  decipher.setAuthTag(all.subarray(all.length - 16));
  return unzstd(Buffer.concat([decipher.update(all.subarray(12, all.length - 16)), decipher.final()]));
}

async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    const current = (await readFile(join(dir, POINTER), "utf8").catch(() => "")).trim();
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (SKIPPED.has(entry.name) || PASSING.test(entry.name)) continue;
      const generation = GENERATION.exec(entry.name)?.[1];
      if (generation && current && generation !== current) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  await walk(root);
  return out.sort((a, b) => Number(b.endsWith(POINTER)) - Number(a.endsWith(POINTER)) || a.localeCompare(b));
}

async function readLocal(root: string): Promise<Manifest | null> {
  const text = await readFile(join(root, LOCAL), "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

/** Whether an engine cache is in `root`: some cache folder in it names its current Index. */
export async function hasCache(root: string): Promise<boolean> {
  for (const entry of await readdir(root).catch(() => [])) if (existsSync(join(root, entry, POINTER))) return true;
  return false;
}

/** Whether a cache under `root` has no column file for its current generation yet, so the next engine run writes it whole (linux: 498 MB, once after the upgrade that brought column files). */
export async function writesColumns(root: string): Promise<boolean> {
  for (const entry of await readdir(root).catch(() => [])) {
    const current = (await readFile(join(root, entry, POINTER), "utf8").catch(() => "")).trim();
    if (current && !existsSync(join(root, entry, `${current}.cols`))) return true;
  }
  return false;
}

export type Saved = { files: number; chunks: number; uploaded: number; bytes: number; sent: number; deleted: number };

/** Keeps a repository's engine cache in R2 as sealed chunks cut and named by their content, uploading only the chunks R2 does not hold yet (an append or an insertion uploads the chunks around it), then the manifest naming them, then deletes the chunks no manifest names any more. A file unchanged since the last save is not read again; files of a cache generation other than the current one, and files being written, are left out. */
export async function saveState(tier: StateTier, repoId: string, root: string, at = now()): Promise<Saved> {
  const prefix = statePrefix(repoId);
  const before = await readLocal(root);
  const known = new Map((before?.files ?? []).map((f) => [f.path, f]));
  const held = new Set((before?.files ?? []).flatMap((f) => f.chunks));
  const entries: Entry[] = [];
  let uploaded = 0;
  let sent = 0;
  let bytes = 0;
  const uploading = new Set<Promise<void>>();
  const upload = async (name: string, chunk: Buffer) => {
    const body = await seal(tier.keys, chunk);
    await tier.storage.put(prefix + name, body, { type: "application/octet-stream" });
    uploaded++;
    sent += body.byteLength;
  };
  for (const path of await files(root)) {
    const rel = relative(root, path);
    const s = await stat(path).catch(() => null);
    if (!s) continue;
    const was = known.get(rel);
    if (was && was.size === s.size && was.mtime === s.mtimeMs) {
      entries.push(was);
      bytes += was.size;
      continue;
    }
    const chunks: string[] = [];
    let size = 0;
    for await (const chunk of chunksOf(path)) {
      const name = nameOf(tier.keys, chunk);
      if (!held.has(name)) {
        held.add(name);
        const p: Promise<void> = upload(name, chunk).finally(() => uploading.delete(p));
        p.catch(() => undefined);
        uploading.add(p);
        if (uploading.size >= AT_ONCE) await Promise.race(uploading);
      }
      chunks.push(name);
      size += chunk.byteLength;
    }
    entries.push({ path: rel, size, mtime: s.mtimeMs, chunks });
    bytes += size;
  }
  await Promise.all(uploading);
  const manifest: Manifest = { version: 1, files: entries };
  await tier.storage.put(`${prefix}manifest`, await seal(tier.keys, Buffer.from(JSON.stringify(manifest))), { type: "application/octet-stream" });
  await writeFile(join(root, LOCAL), JSON.stringify(manifest));
  const named = new Set(entries.flatMap((f) => f.chunks));
  const stale = [...new Set((before?.files ?? []).flatMap((f) => f.chunks))].filter((c) => !named.has(c)).map((c) => prefix + c);
  if (stale.length > 0) await tier.storage.delete(stale).catch(() => undefined);
  await tier.db
    ?.insert(repoStates)
    .values({ repoId, savedAt: at, usedAt: at, bytes })
    .onConflictDoUpdate({ target: repoStates.repoId, set: { savedAt: at, usedAt: at, bytes } });
  return { files: entries.length, chunks: named.size, uploaded, bytes, sent, deleted: stale.length };
}

/** Brings a repository's engine cache back from R2 into `root` when the disk holds none: every chunk is checked against its name, and the files are moved into place only once all are whole. False when R2 holds no State for it, or it could not be read; the Build is then a clean one. */
export async function restoreState(tier: StateTier, repoId: string, root: string, at = now()): Promise<{ restored: boolean; bytes: number }> {
  if (await hasCache(root)) return { restored: false, bytes: 0 };
  const prefix = statePrefix(repoId);
  const stored = await tier.storage.get(`${prefix}manifest`).catch(() => null);
  if (!stored) return { restored: false, bytes: 0 };
  const into = `${root}.restoring`;
  await rm(into, { recursive: true, force: true });
  try {
    const manifest = JSON.parse((await unseal(tier.keys, stored.body)).toString("utf8")) as Manifest;
    let bytes = 0;
    for (const f of manifest.files) {
      const target = join(into, f.path);
      if (relative(into, target).startsWith("..")) throw new Error(`a State file outside its folder: ${f.path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "");
    }
    const parts = manifest.files.flatMap((f) => f.chunks.map((name) => ({ path: f.path, name })));
    const fetched = inOrder(parts, AT_ONCE, async ({ path, name }) => {
      const body = await tier.storage.get(prefix + name);
      if (!body) throw new Error(`a State chunk is missing: ${name}`);
      const chunk = await unseal(tier.keys, body.body);
      if (nameOf(tier.keys, chunk) !== name) throw new Error(`a State chunk does not match its name: ${name}`);
      return { path, chunk };
    });
    let out: Awaited<ReturnType<typeof open>> | null = null;
    let writing = "";
    try {
      for await (const { path, chunk } of fetched) {
        if (path !== writing || !out) {
          await out?.close();
          out = await open(join(into, path), "a");
          writing = path;
        }
        await out.write(chunk);
        bytes += chunk.byteLength;
      }
    } finally {
      await out?.close();
    }
    const placed = await Promise.all(manifest.files.map(async (f) => ({ ...f, mtime: (await stat(join(into, f.path))).mtimeMs })));
    await writeFile(join(into, LOCAL), JSON.stringify({ version: 1, files: placed } satisfies Manifest));
    await mkdir(dirname(root), { recursive: true });
    await rm(root, { recursive: true, force: true });
    await rename(into, root);
    await tier.db?.update(repoStates).set({ usedAt: at }).where(sql`${repoStates.repoId} = ${repoId}`);
    return { restored: true, bytes };
  } catch (e) {
    await rm(into, { recursive: true, force: true });
    tier.log?.(`State of ${repoId} not restored: ${(e as Error).message}`);
    return { restored: false, bytes: 0 };
  }
}

/** Deletes from R2 the States no Build has used for `days` days, with their rows. */
export async function forgetStates(tier: Pick<StateTier, "storage"> & { db: Db }, days: number, at = now()): Promise<string[]> {
  const old = await tier.db.select({ repoId: repoStates.repoId }).from(repoStates).where(lt(repoStates.usedAt, at - days * DAY));
  for (const { repoId } of old) {
    await tier.storage.deletePrefix(statePrefix(repoId));
    await tier.db.delete(repoStates).where(sql`${repoStates.repoId} = ${repoId}`);
  }
  return old.map((r) => r.repoId);
}
