import { promisify } from "node:util";
import { gunzip, gunzipSync, gzipSync } from "node:zlib";
import { LRUCache } from "lru-cache";
import { COMMIT_LIST_KEY, type BuildStats, type Meta } from "@commitscape/data";
import { sha256 } from "./random";
import type { Storage } from "./storage";

export type ReportIndex = {
  meta: Meta;
  stats: BuildStats | null;
  keys: string[];
};

type Written = { meta: Meta; data: Record<string, unknown>; stats?: BuildStats | null };

export const reportPrefix = (repoId: string, buildId: string) => `reports/gh/${repoId}/${buildId}`;

export type AtlasPart = "map" | "names";

/** Where a part of the Atlas of a Stored Index's pack is kept: named by the pack, so a new pack never serves an old Atlas. */
export function atlasKey(si: number, pack: string, part: AtlasPart): string {
  return `atlas/${si}/${sha256(pack).slice(0, 16)}/${part}.bin.br`;
}
/** Where the standard screens of a Stored Index's pack are kept: named by the pack, so a pack published again at the same head never serves the screens of the one before. */
export function screensPrefix(si: number, pack: string): string {
  return `screens/${si}/${sha256(pack).slice(0, 16)}`;
}

/** Where everything kept beside a Stored Index's pack is, its Atlas and its screens, for deleting with the pack. */
export function besidePack(si: number, pack: string): string[] {
  const named = sha256(pack).slice(0, 16);
  return [`atlas/${si}/${named}/`, `screens/${si}/${named}/`];
}

const entryKey = (prefix: string, key: string) => `${prefix}/e/${sha256(key).slice(0, 32)}.json`;

const gz = (value: unknown) => gzipSync(JSON.stringify(value));
const gunzipAsync = promisify(gunzip);

/** Stores a gzipped Report's index and, unless the Stored Index answers for it, one R2 object per answer. */
export async function storeReport(storage: Storage, prefix: string, gzipped: Uint8Array, options: { entries: boolean } = { entries: true }): Promise<{ index: ReportIndex; bytes: number }> {
  const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as Written;
  const keys = Object.keys(report.data).filter((k) => k !== COMMIT_LIST_KEY);
  const index: ReportIndex = { meta: report.meta, stats: report.stats ?? null, keys };
  let bytes = 0;
  const writes: [string, Uint8Array][] = options.entries ? keys.map((k) => [entryKey(prefix, k), gz(report.data[k])]) : [];
  writes.push([`${prefix}/index.json`, gz(index)]);
  for (let i = 0; i < writes.length; i += 16) {
    await Promise.all(
      writes.slice(i, i + 16).map(([key, body]) => {
        bytes += body.length;
        return storage.put(key, body, { type: "application/json", encoding: "gzip" });
      }),
    );
  }
  return { index, bytes };
}

/** The Windows whose screens every Build works out ahead and stores with its Report. */
export const SCREEN_WINDOWS = ["all", "1y", "90d"];

const SCREENS = new Set(["/api/overview", "/api/activity", "/api/people", "/api/map"]);

/** Whether a question, without its `top`, is one of the screens a Build stores with its Report: the stats, or the overview, activity, people or top of the map of a stored Window. */
export function isStoredScreen(path: string, params: Record<string, unknown>): boolean {
  const asked = Object.keys(params).filter((k) => k !== "top");
  if (path === "/api/stats") return asked.length === 0;
  return SCREENS.has(path) && asked.length === 1 && asked[0] === "window" && SCREEN_WINDOWS.includes(String(params.window));
}

/** Stores answers a Build worked out ahead with its Report, one R2 object per answer, read back by `readEntry`. */
export async function storeEntries(storage: Storage, prefix: string, data: Record<string, unknown>): Promise<number> {
  const writes: [string, Uint8Array][] = Object.entries(data).map(([k, value]) => [entryKey(prefix, k), gz(value)]);
  for (let i = 0; i < writes.length; i += 16) {
    await Promise.all(writes.slice(i, i + 16).map(([key, body]) => storage.put(key, body, { type: "application/json", encoding: "gzip" })));
  }
  return writes.length;
}

const cache = new LRUCache<string, { value: unknown }>({ maxSize: 256 * 1024 * 1024 });

async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit) return hit.value as T;
  const object = await storage.get(key);
  if (!object) return null;
  const text = (object.encoding === "gzip" ? await gunzipAsync(object.body) : Buffer.from(object.body)).toString("utf8");
  const value = JSON.parse(text) as T;
  cache.set(key, { value }, { size: Math.max(1, text.length) });
  return value;
}

/** A stored Report's meta, stats and the answers it holds. */
export function readIndex(storage: Storage, prefix: string): Promise<ReportIndex | null> {
  return readJson<ReportIndex>(storage, `${prefix}/index.json`);
}

/** A repository's Report meta, stats and the answers stored for it: from its row, where Builds write them, else from the `index.json` that Builds before them stored in R2. */
export async function reportIndexOf(storage: Storage, row: { reportKey: string | null; reportMeta: Meta | null; reportStats: BuildStats | null }): Promise<ReportIndex | null> {
  if (row.reportMeta) return { meta: row.reportMeta, stats: row.reportStats, keys: [] };
  return row.reportKey ? readIndex(storage, row.reportKey) : null;
}

/** One answer of a stored Report, or null when it was written without it. */
export function readEntry<T = unknown>(storage: Storage, prefix: string, key: string): Promise<T | null> {
  return readJson<T>(storage, entryKey(prefix, key));
}
