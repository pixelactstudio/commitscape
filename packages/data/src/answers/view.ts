import { RANKING_LIMIT } from "../source";

export { RANKING_LIMIT };

export const DAY = 86_400;

export type FileClass = "source" | "prose" | "generated" | "vendored" | "binary" | "symlink";

export type Role = 0 | 1 | 2 | 3 | 4;

export const ROLE = { code: 0, dependencies: 1, test: 2, docs: 3, ci: 4 } as const;

export const FLAG = { merge: 1, blameIgnored: 2, bulk: 4 } as const;

export const TRAIT = { sameName: 1, sameAccount: 2, bot: 4, keptApart: 8 } as const;

export type HeadFile = { file: number; blob: string; loc: number; bytes: number; class: FileClass };

export type ViewPerson = { id: number; name: string; colour: number | null; login: string | null; traits: number; identities: number; commits: number };

export type ViewOptions = { max_changeset_size: number; coupling_support: number; ownership_min_commits: number };

export type ViewSnapshot = {
  commits: number;
  merges: number;
  oldest: number | null;
  newest: number | null;
  languages: { name: string; lines: number }[];
  code_age: { year: number; quarter: number; lines: number }[];
  suspects: number[][];
  releases: [string, number][];
};

export type IndexView = {
  stamp?: string;
  anchor: number;
  options: ViewOptions;
  lines: boolean;
  snapshot: ViewSnapshot;
  ids: string[];
  time: Float64Array;
  offset: Int16Array;
  authorDelta: Int32Array;
  person: Int32Array;
  flags: Uint8Array;
  kind: Uint8Array;
  start: Uint32Array;
  file: Int32Array;
  added: Int32Array;
  removed: Int32Array;
  paths: string[];
  born: Float64Array;
  last: Float64Array;
  known: Uint8Array;
  role: Uint8Array;
  language: (string | null)[];
  guessedGenerated: Uint8Array;
  lockfile: Uint8Array;
  head: HeadFile[];
  headOf: Map<number, HeadFile>;
  persons: Map<number, ViewPerson>;
  byPath: Map<string, number>;
};

export type ViewWindow = { from: number | null; to: number };

export const divEuclid = (a: number, b: number) => Math.floor(a / b);

export const remEuclid = (a: number, b: number) => a - b * Math.floor(a / b);

export const isRankable = (c: FileClass) => c === "source" || c === "prose";

export const isCode = (c: FileClass) => c === "source";

export const byPath = (v: IndexView, a: number, b: number) => compareText(v.paths[a] ?? "", v.paths[b] ?? "");

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const changesLen = (v: IndexView, c: number) => (v.start[c + 1] ?? 0) - (v.start[c] ?? 0);

export const isMerge = (v: IndexView, c: number) => ((v.flags[c] ?? 0) & FLAG.merge) !== 0;

export const landedClock = (v: IndexView, c: number) => (v.time[c] ?? 0) + (v.offset[c] ?? 0) * 60;

export const authorClock = (v: IndexView, c: number) => (v.time[c] ?? 0) + (v.authorDelta[c] ?? 0) + (v.offset[c] ?? 0) * 60;

export const landedDay = (v: IndexView, c: number) => divEuclid(landedClock(v, c), DAY);

export function authorOf(v: IndexView, c: number): number | null {
  const p = v.person[c] ?? -1;
  return p >= 0 ? p : null;
}

export const isBot = (v: IndexView, person: number) => ((v.persons.get(person)?.traits ?? 0) & TRAIT.bot) !== 0;

export function personOf(v: IndexView, c: number): number | null {
  const p = authorOf(v, c);
  return p !== null && !isBot(v, p) ? p : null;
}

export function counts(v: IndexView, c: number): boolean {
  if (isMerge(v, c)) return false;
  return !(changesLen(v, c) > v.options.max_changeset_size || ((v.flags[c] ?? 0) & FLAG.bulk) !== 0);
}

export function contains(w: ViewWindow, time: number): boolean {
  return (w.from === null || w.from <= time) && time <= w.to;
}

export function partitionPoint(time: Float64Array, below: (t: number) => boolean): number {
  let lo = 0;
  let hi = time.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (below(time[mid] ?? 0)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function top<T>(rows: T[], order: (a: T, b: T) => number): T[] {
  rows.sort(order);
  if (rows.length > RANKING_LIMIT) rows.length = RANKING_LIMIT;
  return rows;
}
