import { isBinaryPath } from "@commitscape/data";
import { gitBlobKey, putGitBlob, type Storage } from "@commitscape/server";
import { git, pooled, text, type Git } from "./exec";

export type FileLimits = { fileBytes: number; repoBytes: number; warm: number };

export type Entry = { path: string; sha: string; size: number; mode: string };

const RECORD = /^(\d+) (\w+) ([0-9a-f]{40,64}) +(-|\d+)\t([\s\S]*)$/;
const SNIFF = 8000;
const UPLOADS = 48;

/** Every file at a commit, with its size and blob id, in path order; submodules are left out. */
export async function listTree(g: Git, ref: string): Promise<Entry[]> {
  const out = await text(g, ["ls-tree", "-r", "-l", "-z", ref], { maxBytes: 256 * 1024 * 1024 });
  const entries: Entry[] = [];
  for (const record of out.split("\0")) {
    const m = RECORD.exec(record);
    if (!m || m[2] !== "blob") continue;
    entries.push({ mode: m[1] as string, sha: m[3] as string, size: m[4] === "-" ? 0 : Number(m[4]), path: m[5] as string });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export const isBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, SNIFF).includes(0);

export const linesOf = (bytes: Uint8Array): number => {
  if (bytes.length === 0) return 0;
  let n = 0;
  for (let i = bytes.indexOf(10); i !== -1; i = bytes.indexOf(10, i + 1)) n++;
  return bytes[bytes.length - 1] === 10 ? n : n + 1;
};

async function readBlobs(g: Git, shas: string[]): Promise<Map<string, Uint8Array | null>> {
  const found = new Map<string, Uint8Array | null>();
  if (shas.length === 0) return found;
  const ran = await git(g, ["cat-file", "--batch"], { input: `${shas.join("\n")}\n`, maxBytes: 512 * 1024 * 1024 });
  const buf = ran.out;
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl === -1) break;
    const [sha = "", kind = "", size = "0"] = buf.toString("latin1", pos, nl).split(" ");
    if (kind === "missing") {
      found.set(sha, null);
      pos = nl + 1;
      continue;
    }
    const length = Number(size);
    if (nl + 1 + length > buf.length) break;
    found.set(sha, buf.subarray(nl + 1, nl + 1 + length));
    pos = nl + 1 + length + 1;
  }
  return found;
}

export type Kept = { lines: number; binary: boolean };

export type FilesDone = {
  files: number;
  stored: number;
  skipped: number;
  eligible: number;
  blobs: Map<string, Kept>;
  dropped: string[];
  orphans: string[];
  bytes: number;
  uploaded: number;
  failed: number;
  complete: boolean;
};

const README = /^readme(\.[a-z0-9]+)?$/i;

const depthOf = (path: string) => path.split("/").length;

/** The order a warm set is kept in: READMEs first, shallowest first, then the files changed most often (`value`), then the smallest. */
export function byValue(entries: Entry[], value: ReadonlyMap<string, number>): Entry[] {
  const readme = (e: Entry) => README.test(e.path.slice(e.path.lastIndexOf("/") + 1));
  return [...entries].sort(
    (a, b) =>
      Number(readme(b)) - Number(readme(a)) ||
      (readme(a) ? depthOf(a.path) - depthOf(b.path) : 0) ||
      (value.get(b.path) ?? 0) - (value.get(a.path) ?? 0) ||
      a.size - b.size ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

/** Reads the files at a commit for the Code window and decides which texts to keep in storage; a public repository's texts are not uploaded. */
export async function readFiles(
  g: Git,
  deps: { storage: Storage; prefix: string; known: Map<string, Kept>; limits: FileLimits; head: string; value?: ReadonlyMap<string, number> },
): Promise<FilesDone> {
  const { storage, prefix, known, limits } = deps;
  const entries = await listTree(g, deps.head);
  const seen = new Set<string>();
  const unique = entries.filter((e) => !seen.has(e.sha) && seen.add(e.sha));
  const blobs = new Map<string, Kept>();
  const wanted: Entry[] = [];
  let kept = 0;
  let skipped = 0;
  let eligible = 0;
  for (const e of byValue(unique, deps.value ?? new Map())) {
    const had = known.get(e.sha);
    if (isBinaryPath(e.path) || had?.binary) {
      blobs.set(e.sha, { lines: 0, binary: true });
      continue;
    }
    if (e.size > limits.fileBytes) {
      skipped++;
      continue;
    }
    if (eligible >= limits.warm || kept + e.size > limits.repoBytes) continue;
    eligible++;
    kept += e.size;
    if (had) blobs.set(e.sha, had);
    else wanted.push(e);
  }
  const contents = await readBlobs(g, wanted.map((e) => e.sha));
  const writes: [string, Uint8Array][] = [];
  for (const { sha } of wanted) {
    const bytes = contents.get(sha);
    if (!bytes) continue;
    if (isBinary(bytes)) {
      blobs.set(sha, { lines: 0, binary: true });
      eligible--;
    } else writes.push([sha, bytes]);
  }
  const written = await pooled(g, writes, UPLOADS, async ([sha, body]) => {
    try {
      await putGitBlob(storage, gitBlobKey(prefix, sha), body);
      return sha;
    } catch {
      return null;
    }
  });
  let uploaded = 0;
  let failed = 0;
  written.forEach((sha, i) => {
    if (sha) {
      blobs.set(sha, { lines: linesOf(writes[i]?.[1] ?? new Uint8Array()), binary: false });
      uploaded++;
    } else if (sha === null) failed++;
  });
  let stored = 0;
  let bytes = 0;
  const sizeOf = new Map(unique.map((e) => [e.sha, e.size]));
  for (const [sha, b] of blobs) {
    if (b.binary) continue;
    stored++;
    bytes += sizeOf.get(sha) ?? 0;
  }
  const dropped = [...known].filter(([sha, b]) => !b.binary && !sizeOf.has(sha)).map(([sha]) => sha);
  const gone = new Set(dropped);
  const at = `${prefix}/blobs/`;
  const orphans = ((await storage.keys?.(at).catch(() => [])) ?? []).map((k) => k.slice(at.length)).filter((sha) => !sizeOf.has(sha) && !gone.has(sha));
  return { files: entries.length, stored, skipped, eligible, blobs, dropped, orphans, bytes, uploaded, failed, complete: stored >= eligible };
}
