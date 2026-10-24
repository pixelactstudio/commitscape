import { rangeOf, type GitDir, type GitTree, type PersonRef } from "@commitscape/data";

export type Owner = { person: PersonRef; index: number; commits: number; share: number };

export type Totals = { size: number; lines: number; files: number };

const cache = new WeakMap<GitTree, Totals>();

/** What the whole repository adds up to; worked out once per tree. */
export function totalsOf(tree: GitTree): Totals {
  const hit = cache.get(tree);
  if (hit) return hit;
  let size = 0;
  let lines = 0;
  for (let i = 0; i < tree.paths.length; i++) {
    size += tree.size[i] ?? 0;
    lines += tree.lines[i] ?? 0;
  }
  const totals = { size, lines, files: tree.paths.length };
  cache.set(tree, totals);
  return totals;
}

export function personOf(tree: GitTree, index: number): PersonRef {
  const p = tree.people[index];
  return { id: index, name: p?.name ?? "someone unknown", colour: null, login: p?.login ?? null };
}

/** The people who made most of a file's or folder's commits, from the flat `[person, commits, …]` the tree keeps, with each one's share of all its commits. */
export function ownersOf(tree: GitTree, flat: readonly number[], commits: number): Owner[] {
  const out: Owner[] = [];
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const index = flat[k] as number;
    const n = flat[k + 1] as number;
    out.push({ person: personOf(tree, index), index, commits: n, share: commits > 0 ? n / commits : 0 });
  }
  return out;
}

export type Ranked = { index: number; value: number };

function top(limit: number, items: Ranked[], better: (a: Ranked, b: Ranked) => number): Ranked[] {
  return items.sort(better).slice(0, limit);
}

export type FolderStats = {
  path: string;
  files: number;
  size: number;
  lines: number;
  commits: number;
  last: number;
  languages: { lang: string; size: number; files: number }[];
  hot: Ranked[];
  cold: Ranked[];
  largest: Ranked[];
  dir: GitDir | undefined;
};

/** A folder, or the whole repository for an empty path, summed from the files in it: size, lines, languages, and the files that change most, have not changed the longest, and are largest. */
export function folderStats(tree: GitTree, path: string, dirs: ReadonlyMap<string, GitDir>, shown = 6): FolderStats {
  const [lo, hi] = path === "" ? [0, tree.paths.length] : rangeOf(tree.paths, path);
  const langs = new Map<number, { size: number; files: number }>();
  let size = 0;
  let lines = 0;
  const hot: Ranked[] = [];
  const cold: Ranked[] = [];
  const largest: Ranked[] = [];
  const keep = (list: Ranked[], item: Ranked, better: (a: Ranked, b: Ranked) => number) => {
    list.push(item);
    if (list.length > shown * 8) {
      const best = top(shown, list, better);
      list.length = 0;
      list.push(...best);
    }
  };
  const byValueDesc = (a: Ranked, b: Ranked) => b.value - a.value || a.index - b.index;
  const byValueAsc = (a: Ranked, b: Ranked) => a.value - b.value || a.index - b.index;
  for (let i = lo; i < hi; i++) {
    const s = tree.size[i] ?? 0;
    size += s;
    lines += tree.lines[i] ?? 0;
    const l = langs.get(tree.lang[i] ?? 0) ?? { size: 0, files: 0 };
    l.size += s;
    l.files++;
    langs.set(tree.lang[i] ?? 0, l);
    if ((tree.churn[i] ?? 0) > 0) keep(hot, { index: i, value: tree.churn[i] ?? 0 }, byValueDesc);
    if ((tree.last[i] ?? 0) > 0) keep(cold, { index: i, value: tree.last[i] ?? 0 }, byValueAsc);
    keep(largest, { index: i, value: s }, byValueDesc);
  }
  const dir = dirs.get(path);
  return {
    path,
    files: hi - lo,
    size,
    lines,
    commits: dir?.commits ?? 0,
    last: dir?.last ?? 0,
    languages: [...langs].map(([i, v]) => ({ lang: tree.langs[i] ?? "text", ...v })).sort((a, b) => b.size - a.size),
    hot: top(shown, hot, byValueDesc),
    cold: top(shown, cold, byValueAsc),
    largest: top(shown, largest, byValueDesc),
    dir,
  };
}

/** A byte count in the unit that reads best. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round((n / 1024) * 10) / 10} KB`;
  if (n < 1024 ** 3) return `${Math.round((n / 1024 ** 2) * 10) / 10} MB`;
  return `${Math.round((n / 1024 ** 3) * 10) / 10} GB`;
}

/** How a share of a whole reads: "<1%" for a little, never "0%" for something. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const p = (part * 100) / whole;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** 0 to 4: how often a file changes against the most of any, on a log scale, for the heat colours. */
export function heatOf(churn: number, most: number): number {
  if (churn <= 0 || most <= 0) return 0;
  return Math.max(1, Math.ceil((Math.log1p(churn) / Math.log1p(most)) * 4));
}
