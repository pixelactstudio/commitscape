import "@tanstack/react-start/server-only";
import { setImmediate as yieldNow } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { key as keyOf, type Params } from "@commitscape/data";
import { analysesHeld, answer, askedOf, commitsUnder, DAY, type IndexView } from "@commitscape/data/answers";
import { indexStamp, loadView, schema, type Db } from "@commitscape/server";
import { heldBy, pack, packed, type Packed } from "./packed";

const { storedIndexes } = schema;

export const VIEW_BYTES = 512 * 1024 ** 2;
export const ANSWER_BYTES = 160 * 1024 ** 2;
export const FILE_BYTES = 96 * 1024 ** 2;
const FRESH_FOR = 10_000;
const UNDER_KEPT = 16;

class Sized<V> {
  private readonly map = new Map<string, V>();
  private readonly budget: number;
  private readonly size: (v: V) => number;
  constructor(budget: number, size: (v: V) => number) {
    this.budget = budget;
    this.size = size;
  }
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  peek(k: string): V | undefined {
    return this.map.get(k);
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    this.trim();
  }
  delete(k: string): void {
    this.map.delete(k);
  }
  trim(): void {
    let total = this.bytes();
    for (const [k, v] of this.map) {
      if (total <= this.budget || this.map.size <= 1) break;
      total -= this.size(v);
      this.map.delete(k);
    }
  }
  bytes(): number {
    let total = 0;
    for (const v of this.map.values()) total += this.size(v);
    return total;
  }
}

type Held = { stamp: string; view: Promise<IndexView | null>; done: IndexView | null; bytes: number };

export type Kept = { value: unknown; bytes: number; packed: Packed | null };

type Made = { packed: Promise<Packed>; done: Packed | null };

const unders = new WeakMap<IndexView, Map<string, number[]>>();
const underBytes = (v: IndexView) => {
  let n = 0;
  for (const list of unders.get(v)?.values() ?? []) n += list.length * 8;
  return n;
};
const views = new Sized<Held>(VIEW_BYTES, (h) => h.bytes + (h.done ? analysesHeld(h.done) * analysisBytes(h.done) + underBytes(h.done) : 0));
const answers = new Sized<Kept>(ANSWER_BYTES, (k) => k.bytes * 2 + (k.packed ? heldBy(k.packed) : 0));
const files = new Sized<Made>(FILE_BYTES, (m) => (m.done ? heldBy(m.done) : 0));
const stamps = new Map<number, { stamp: string | null; at: number }>();

/** About how much memory a view holds, as measured on react and freeCodeCamp: its columns exactly, and its strings and maps by what V8 spends on each. */
export function sizeOf(v: IndexView): number {
  let bytes = 0;
  for (const a of [v.time, v.offset, v.authorDelta, v.person, v.flags, v.kind, v.start, v.file, v.added, v.removed, v.born, v.last, v.known, v.role, v.guessedGenerated, v.lockfile]) bytes += a.byteLength;
  for (const id of v.ids) bytes += 32 + id.length;
  for (const p of v.paths) bytes += 32 + p.length;
  return bytes + v.language.length * 8 + v.byPath.size * 48 + v.head.length * 160 + v.headOf.size * 48 + v.persons.size * 200;
}

/** About how much memory one Analysis of a view holds beside it, as measured on react and freeCodeCamp. */
export const analysisBytes = (v: IndexView): number => 64 * 1024 + v.time.length * 48 + v.paths.length * 25;

/** What changes whenever a Stored Index is loaded again: its load time and head; read again when the one remembered was read before `after`, in seconds. */
export async function stampOf(db: Db, si: number, after?: number): Promise<string | null> {
  const known = stamps.get(si);
  if (known && Date.now() - known.at < FRESH_FOR && (after === undefined || known.at > (after + 1) * 1000)) return known.stamp;
  const [row] = await db.select({ loadedAt: storedIndexes.loadedAt, head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, si));
  const stamp = row ? indexStamp(row) : null;
  stamps.set(si, { stamp, at: Date.now() });
  return stamp;
}

/** Forgets the stamp remembered for a Stored Index, so the next request reads it again. */
export function forgetStamp(si: number): void {
  stamps.delete(si);
}

/** A Stored Index in memory, read from Postgres once per load and kept while there is room. */
export async function viewOf(db: Db, si: number): Promise<IndexView | null> {
  const stamp = await stampOf(db, si);
  if (stamp === null) return null;
  const id = String(si);
  const held = views.get(id);
  if (held && held.stamp === stamp) return held.view;
  const entry: Held = { stamp, view: loadView(db, si), done: null, bytes: 0 };
  views.set(id, entry);
  try {
    const view = await entry.view;
    if (view?.stamp && view.stamp !== entry.stamp) {
      entry.stamp = view.stamp;
      stamps.set(si, { stamp: view.stamp, at: Date.now() });
    }
    entry.done = view;
    entry.bytes = view ? sizeOf(view) : 0;
    views.trim();
    return view;
  } catch (e) {
    if (views.peek(id) === entry) views.delete(id);
    throw e;
  }
}

/** Whether a Stored Index is held in memory now, under its current stamp or an older one. */
export function holds(si: number): boolean {
  return views.peek(String(si)) !== undefined;
}

/** The commits under a path in a view, newest first, worked out once and kept for the few paths most asked. */
export function underOf(view: IndexView, path: string): number[] {
  let kept = unders.get(view);
  if (!kept) {
    kept = new Map();
    unders.set(view, kept);
  }
  const found = kept.get(path);
  if (found) {
    kept.delete(path);
    kept.set(path, found);
    return found;
  }
  const made = commitsUnder(view, path);
  kept.set(path, made);
  if (kept.size > UNDER_KEPT) kept.delete(kept.keys().next().value as string);
  return made;
}

/** A question to the Data Source with only the params its answer depends on, and its one key. */
export function askedKey(key: string): { path: string; params: Params; key: string } {
  const at = key.indexOf("?");
  const path = at < 0 ? key : key.slice(0, at);
  const params = askedOf(Object.fromEntries(new URLSearchParams(at < 0 ? "" : key.slice(at + 1))));
  return { path, params, key: keyOf(path, params) };
}

/** Whether a question names its own dates rather than one of the Report's Windows. */
export const isRange = (params: Params) => (params.from !== undefined && params.from !== "") || (params.to !== undefined && params.to !== "");

/** Whether a range's dates are whole days, as the Site's pages ask for them: from the start of one day to the end of another. */
export function wholeDays(params: Params): boolean {
  const whole = (v: Params[string], end: boolean) => v === undefined || v === null || v === "" || (/^-?\d{1,12}$/.test(String(v)) && (Number(v) + (end ? 1 : 0)) % DAY === 0);
  return whole(params.from, false) && whole(params.to, true);
}

let line: Promise<unknown> = Promise.resolve();

/** Runs work that holds the main thread one piece at a time, each after the event loop has had a turn, so other requests are answered in between. */
export function inTurn<T>(work: () => T | Promise<T>): Promise<T> {
  const run = line.then(() => yieldNow()).then(work);
  line = run.catch(() => undefined);
  return run;
}

const keptOf = (value: unknown, browser: boolean): Kept => {
  const text = JSON.stringify(value);
  return { value, bytes: text.length, packed: browser ? pack(text, 5) : null };
};

/** One Data Source answer worked out from a Stored Index and kept, or undefined when it cannot answer that question; `admit` is asked before a range not worked out yet costs anything, and `browser` packs it at once. */
export async function keptAnswer(db: Db, si: number, key: string, admit?: () => Promise<void>, browser = false): Promise<{ kept: Kept; stamp: string } | undefined> {
  const stamp = await stampOf(db, si);
  if (stamp === null) return undefined;
  const asked = askedKey(key);
  const hit = answers.get(`${si}@${stamp}#${asked.key}`);
  if (hit) return { kept: hit, stamp };
  if (admit && isRange(asked.params)) await admit();
  const view = await viewOf(db, si);
  if (!view) return undefined;
  const at = view.stamp ?? stamp;
  const cacheKey = `${si}@${at}#${asked.key}`;
  const kept = await inTurn(() => {
    const again = answers.get(cacheKey);
    if (again) return again;
    const value = answer(view, asked.path, asked.params) ?? undefined;
    if (value === undefined) return undefined;
    const made = keptOf(value, browser);
    answers.set(cacheKey, made);
    views.trim();
    return made;
  });
  return kept && { kept, stamp: at };
}

/** One Data Source answer worked out from a Stored Index, or undefined when it cannot answer that question. */
export async function indexAnswer(db: Db, si: number, key: string, admit?: () => Promise<void>): Promise<unknown> {
  return (await keptAnswer(db, si, key, admit))?.kept.value;
}

/** An answer read from somewhere else, a stored Report, kept beside those worked out under its own key; null when there is none. */
export async function keptEntry(cacheKey: string, read: () => Promise<unknown>, browser = false): Promise<Kept | null> {
  const hit = answers.get(cacheKey);
  if (hit) return hit;
  const value = await read();
  if (value === null || value === undefined) return null;
  const kept = keptOf(value, browser);
  answers.set(cacheKey, kept);
  return kept;
}

/** A kept answer's JSON packed for sending, packed the first time a browser asks. */
export function packedOf(kept: Kept): Promise<Packed> {
  kept.packed ??= pack(JSON.stringify(kept.value), 5);
  return packed(kept.packed);
}

const NOTHING = new Error("nothing to pack");

/** A JSON file made once under its key, packed with brotli off the main thread, and kept while there is room; null when `make` has nothing. */
export async function keptFile(key: string, make: () => unknown | Promise<unknown>): Promise<Packed | null> {
  let made = files.get(key);
  if (!made) {
    const making = async (done: (p: Packed) => void): Promise<Packed> => {
      const value = await make();
      if (value === null || value === undefined) throw NOTHING;
      const p = await packed(pack(await inTurn(() => JSON.stringify(value)), 6));
      done(p);
      files.trim();
      return p;
    };
    const entry: Made = { packed: making((p) => void (entry.done = p)), done: null };
    made = entry;
    files.set(key, made);
  }
  try {
    return await made.packed;
  } catch (e) {
    if (files.peek(key) === made) files.delete(key);
    if (e === NOTHING) return null;
    throw e;
  }
}

/** A file worked out from a Stored Index as JSON, made once per load of the index; null when there is no such Stored Index. `make` should hold the main thread only through `inTurn`. */
export async function indexFile(db: Db, si: number, name: string, make: (view: IndexView) => unknown | Promise<unknown>): Promise<{ packed: Packed; stamp: string } | null> {
  const stamp = await stampOf(db, si);
  if (stamp === null) return null;
  const made = await keptFile(`${si}@${stamp}#${name}`, async () => {
    const view = await viewOf(db, si);
    return view ? make(view) : null;
  });
  return made ? { packed: made, stamp } : null;
}

/** Reads a Stored Index into memory and works out the answers named, one at a time, letting other requests in between. */
export async function warmIndex(db: Db, si: number, keys: string[]): Promise<number> {
  forgetStamp(si);
  if (!(await viewOf(db, si))) return 0;
  let made = 0;
  for (const key of keys) {
    await yieldNow();
    if (await keptAnswer(db, si, key, undefined, true).catch(() => undefined)) made += 1;
  }
  return made;
}
