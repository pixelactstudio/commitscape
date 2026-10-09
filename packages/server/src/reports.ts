import { gunzipSync, gzipSync } from "node:zlib";
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
const entryKey = (prefix: string, key: string) => `${prefix}/e/${sha256(key).slice(0, 32)}.json`;

const gz = (value: unknown) => gzipSync(JSON.stringify(value));

/** Splits a gzipped Report into one R2 object per answer and returns its index; a Commit List inside it is left out, as commits are rows (storeCommits). */
export async function storeReport(storage: Storage, prefix: string, gzipped: Uint8Array): Promise<{ index: ReportIndex; bytes: number }> {
  const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as Written;
  const keys = Object.keys(report.data).filter((k) => k !== COMMIT_LIST_KEY);
  const index: ReportIndex = { meta: report.meta, stats: report.stats ?? null, keys };
  let bytes = 0;
  const writes: [string, Uint8Array][] = keys.map((k) => [entryKey(prefix, k), gz(report.data[k])]);
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

const cache = new LRUCache<string, { value: unknown }>({ maxSize: 256 * 1024 * 1024 });

async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit) return hit.value as T;
  const object = await storage.get(key);
  if (!object) return null;
  const text = (object.encoding === "gzip" ? gunzipSync(object.body) : Buffer.from(object.body)).toString("utf8");
  const value = JSON.parse(text) as T;
  cache.set(key, { value }, { size: Math.max(1, text.length) });
  return value;
}

/** A stored Report's meta, stats and the answers it holds. */
export function readIndex(storage: Storage, prefix: string): Promise<ReportIndex | null> {
  return readJson<ReportIndex>(storage, `${prefix}/index.json`);
}

/** One answer of a stored Report, or null when it was written without it. */
export function readEntry<T = unknown>(storage: Storage, prefix: string, key: string): Promise<T | null> {
  return readJson<T>(storage, entryKey(prefix, key));
}
