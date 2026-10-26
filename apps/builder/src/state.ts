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

const LOCAL = "state.json";
const SKIPPED = new Set(["index.lock", "index.load", "graph", "graph.writing", "blame", LOCAL]);
const POINTER = "index.current";
const DAY = 24 * 3600;

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
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (SKIPPED.has(entry.name) || entry.name.endsWith(".tmp")) continue;
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

export type Saved = { files: number; chunks: number; uploaded: number; bytes: number; sent: number; deleted: number };

/** Keeps a repository's engine cache in R2 as sealed chunks named by their content, uploading only the chunks R2 does not hold yet (an append to a file uploads its new tail), then the manifest naming them, then deletes the chunks no manifest names any more. A file unchanged since the last save is not read again. */
export async function saveState(tier: StateTier, repoId: string, root: string, at = now()): Promise<Saved> {
  const prefix = statePrefix(repoId);
  const before = await readLocal(root);
  const known = new Map((before?.files ?? []).map((f) => [f.path, f]));
  const held = new Set((before?.files ?? []).flatMap((f) => f.chunks));
  const entries: Entry[] = [];
  let uploaded = 0;
  let sent = 0;
  let bytes = 0;
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
    const handle = await open(path, "r");
    const chunks: string[] = [];
    let size = 0;
    try {
      const buffer = Buffer.alloc(CHUNK_BYTES);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, size);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        const name = nameOf(tier.keys, chunk);
        if (!held.has(name)) {
          const body = await seal(tier.keys, chunk);
          await tier.storage.put(prefix + name, body, { type: "application/octet-stream" });
          held.add(name);
          uploaded++;
          sent += body.byteLength;
        }
        chunks.push(name);
        size += bytesRead;
        if (bytesRead < CHUNK_BYTES) break;
      }
    } finally {
      await handle.close();
    }
    entries.push({ path: rel, size, mtime: s.mtimeMs, chunks });
    bytes += size;
  }
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
      const out = await open(target, "w");
      try {
        for (const name of f.chunks) {
          const body = await tier.storage.get(prefix + name);
          if (!body) throw new Error(`a State chunk is missing: ${name}`);
          const chunk = await unseal(tier.keys, body.body);
          if (nameOf(tier.keys, chunk) !== name) throw new Error(`a State chunk does not match its name: ${name}`);
          await out.write(chunk);
          bytes += chunk.byteLength;
        }
      } finally {
        await out.close();
      }
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
