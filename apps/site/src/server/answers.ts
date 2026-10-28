import "@tanstack/react-start/server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { askedOf, key as keyOf, type Params } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";
import { NoPack } from "./engine-service";
import { heldBy, pack, packed, type Packed } from "./packed";
import { Sized } from "./sized";
import { cacheLooked } from "./telemetry";

const { storedIndexes } = schema;

export const SENT_BYTES = 64 * 1024 ** 2;
export const ENTRY_BYTES = 16 * 1024 ** 2;
const DAY = 86_400;
const FRESH_LOAD = 120;
const FRESH_FOR = 10_000;
const KNOWN_MAX = 10_000;
const WAIT_STEP = 250;
const WAITS = 12;

export type Kept = { value: unknown; bytes: number; packed: Packed | null };

type Made = { packed: Promise<Packed>; done: Packed | null };

const sent = new Sized<Made>(SENT_BYTES, (m) => (m.done ? heldBy(m.done) : 0));
const entries = new Sized<Kept>(ENTRY_BYTES, (k) => k.bytes * 2 + (k.packed ? heldBy(k.packed) : 0));

type KnownPack = { pack: string; at: number };

const knownBy = new WeakMap<Db, Map<number, KnownPack>>();

const knownOf = (db: Db): Map<number, KnownPack> => {
  let known = knownBy.get(db);
  if (!known) knownBy.set(db, (known = new Map()));
  return known;
};

export type PackAsk = { waits?: number; after?: number | null };

/** The key of the pack the engine service answers a Stored Index's questions from, remembered for ten seconds unless read before `after` (in seconds, when the Report was last published); for a Stored Index loaded in the last two minutes and not published yet, waited for up to `waits` quarter seconds. Null when it has none. */
export async function packOf(db: Db, si: number | null, ask: PackAsk = {}): Promise<string | null> {
  if (si === null) return null;
  const known = knownOf(db);
  const memo = known.get(si);
  if (memo && Date.now() - memo.at < FRESH_FOR && (ask.after === undefined || ask.after === null || memo.at > (ask.after + 1) * 1000)) return memo.pack;
  const waits = ask.waits ?? WAITS;
  for (let tries = 0; ; tries++) {
    const [row] = await db.select({ pack: storedIndexes.pack, loadedAt: storedIndexes.loadedAt }).from(storedIndexes).where(eq(storedIndexes.id, si));
    if (!row) return null;
    if (row.pack !== null) {
      if (known.size >= KNOWN_MAX) known.clear();
      known.set(si, { pack: row.pack, at: Date.now() });
      return row.pack;
    }
    if (tries >= waits || (row.loadedAt ?? 0) < now() - FRESH_LOAD) return null;
    await sleep(WAIT_STEP);
  }
}

/** Forgets the pack remembered for a Stored Index, so the next request reads it again. */
export function forgetPack(db: Db, si: number): void {
  knownOf(db).delete(si);
}

/** Asks the engine service with a Stored Index's pack, reading the key again once when the engine no longer has that pack; undefined when the Stored Index has no pack the engine can read. */
export async function withPack<T>(db: Db, si: number | null, ask: (pack: string) => Promise<T>, after?: number | null): Promise<{ pack: string; value: T } | undefined> {
  let pack = await packOf(db, si, { after });
  for (let tries = 0; pack !== null && tries < 2; tries++) {
    try {
      return { pack, value: await ask(pack) };
    } catch (e) {
      if (!(e instanceof NoPack) || si === null) throw e;
      forgetPack(db, si);
      const again = await packOf(db, si, { waits: 0 });
      if (again === pack) return undefined;
      pack = again;
    }
  }
  return undefined;
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

const NOTHING = new Error("nothing to pack");

/** Whether a JSON text is kept packed under a key. */
export const isKept = (key: string): boolean => sent.peek(key) !== undefined;

/** A JSON text made once under its key, packed with brotli off the main thread and kept while there is room; null when `make` has nothing. Each lookup is counted, by `kind`, as kept or made. */
export async function keptText(key: string, make: () => Promise<string | null>, quality = 6, kind = "file"): Promise<Packed | null> {
  let made = sent.get(key);
  cacheLooked(made !== undefined, kind);
  if (!made) {
    const making = async (done: (p: Packed) => void): Promise<Packed> => {
      const text = await make();
      if (text === null) throw NOTHING;
      const p = await packed(pack(text, quality));
      done(p);
      sent.refresh(key);
      return p;
    };
    const entry: Made = { packed: making((p) => void (entry.done = p)), done: null };
    made = entry;
    sent.set(key, made);
  }
  try {
    return await made.packed;
  } catch (e) {
    if (sent.peek(key) === made) sent.delete(key);
    if (e === NOTHING) return null;
    throw e;
  }
}

/** A JSON file made once under its key from a value, packed and kept as `keptText` keeps texts; null when `make` has nothing. */
export function keptFile(key: string, make: () => unknown | Promise<unknown>): Promise<Packed | null> {
  return keptText(key, async () => {
    const value = await make();
    return value === null || value === undefined ? null : JSON.stringify(value);
  });
}

/** An answer read from a stored Report, kept under its own key; null when there is none. */
export async function keptEntry(cacheKey: string, read: () => Promise<unknown>, browser = false): Promise<Kept | null> {
  const hit = entries.get(cacheKey);
  cacheLooked(hit !== undefined, "report");
  if (hit) return hit;
  const value = await read();
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value);
  const kept: Kept = { value, bytes: text.length, packed: browser ? pack(text, 5) : null };
  entries.set(cacheKey, kept);
  return kept;
}

/** A kept answer's JSON packed for sending, packed the first time a browser asks. */
export function packedOf(kept: Kept): Promise<Packed> {
  kept.packed ??= pack(JSON.stringify(kept.value), 5);
  return packed(kept.packed);
}
