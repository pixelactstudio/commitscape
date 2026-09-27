import { gunzipSync, gzipSync } from "node:zlib";
import { LRUCache } from "lru-cache";
import type { BuildStats, Meta } from "@commitscape/data";
import { sha256 } from "./random";
import type { Storage } from "./storage";

export const COMMITS_KEY = "/api/commits?";

export type ReportIndex = {
  meta: Meta;
  stats: BuildStats | null;
  keys: string[];
  cards: string[];
  commits: boolean;
};

type Written = { meta: Meta; data: Record<string, unknown>; cards: Record<string, string>; stats?: BuildStats | null };

export const reportPrefix = (repoId: string, buildId: string) => `reports/gh/${repoId}/${buildId}`;
const entryKey = (prefix: string, key: string) => `${prefix}/e/${sha256(key).slice(0, 32)}.json`;
export const commitsKey = (prefix: string) => `${prefix}/commits.json`;
export const cardKey = (prefix: string, window: string) => `${prefix}/cards/${window}.svg`;

const gz = (value: unknown) => gzipSync(JSON.stringify(value));

/** Splits a gzipped Report into one R2 object per answer and returns its index. */
export async function storeReport(storage: Storage, prefix: string, gzipped: Uint8Array): Promise<{ index: ReportIndex; bytes: number }> {
  const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as Written;
  const keys = Object.keys(report.data).filter((k) => k !== COMMITS_KEY);
  const index: ReportIndex = {
    meta: report.meta,
    stats: report.stats ?? null,
    keys,
    cards: Object.keys(report.cards),
    commits: COMMITS_KEY in report.data,
  };
  let bytes = 0;
  const writes: [string, Uint8Array, string, string | undefined][] = keys.map((k) => [entryKey(prefix, k), gz(report.data[k]), "application/json", "gzip"]);
  if (index.commits) writes.push([commitsKey(prefix), gz(report.data[COMMITS_KEY]), "application/json", "gzip"]);
  for (const [window, svg] of Object.entries(report.cards)) writes.push([cardKey(prefix, window), new TextEncoder().encode(svg), "image/svg+xml", undefined]);
  writes.push([`${prefix}/index.json`, gz(index), "application/json", "gzip"]);
  for (let i = 0; i < writes.length; i += 16) {
    await Promise.all(
      writes.slice(i, i + 16).map(([key, body, type, encoding]) => {
        bytes += body.length;
        return storage.put(key, body, { type, encoding });
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

/** A stored Report's card for a Window, as SVG. */
export async function readCard(storage: Storage, prefix: string, window: string): Promise<string | null> {
  const object = await storage.get(cardKey(prefix, window));
  return object ? new TextDecoder().decode(object.body) : null;
}
