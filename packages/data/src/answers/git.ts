import { FILE_BIG, FILE_BINARY, FILE_BYTES_MAX, FILE_LINK, FILE_STORED, GIT_FORMAT, isBinaryPath, languageOf, rangeOf, type GitCoupling, type GitDir, type GitLog, type GitPerson, type GitTree } from "../git";
import { authorOf, compareText, counts, DAY, isBot, isMerge, type IndexView } from "./view";

export const OWNERS_KEPT = 3;
export const COUPLED_KEPT = 6;
export const COUPLED_MIN = 3;
export const COUPLED_FILES = 30;
const PAIRS_MAX = 1_500_000;

export type Blob = { lines: number; binary: boolean };

export type TreeOf = { builtAt: number; head: string; branch: string; raw?: string | null; fileBytes?: number };

type Counts = Map<number, number>;

const bump = (m: Counts, k: number) => m.set(k, (m.get(k) ?? 0) + 1);

/** The files at HEAD, sorted by path, as positions into the view's HEAD. */
export function headOrder(v: IndexView): number[] {
  return v.head.map((_, i) => i).sort((a, b) => compareText(v.paths[v.head[a]?.file ?? 0] ?? "", v.paths[v.head[b]?.file ?? 0] ?? ""));
}

/** Builds the Code window's tree from a Stored Index: every file at HEAD with its size, language and Churn, and the same for every folder. */
export function gitTree(v: IndexView, blobs: ReadonlyMap<string, Blob>, of: TreeOf): GitTree {
  const order = headOrder(v);
  const at = new Map<number, number>();
  order.forEach((h, i) => at.set(v.head[h]?.file ?? -1, i));
  const n = order.length;
  const paths = order.map((h) => v.paths[v.head[h]?.file ?? 0] ?? "");
  const churn = new Array<number>(n).fill(0);
  const owners: Counts[] = Array.from({ length: n }, () => new Map());
  const dirStats = new Map<string, { commits: number; last: number; owners: Counts }>();
  let logged = 0;
  for (let c = 0; c < v.time.length; c++) {
    if (isMerge(v, c)) continue;
    logged++;
    if (!counts(v, c)) continue;
    const who = authorOf(v, c) ?? -1;
    const seen = new Set<string>();
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
      const k = at.get(v.file[i] ?? -1);
      if (k === undefined) continue;
      churn[k] = (churn[k] ?? 0) + 1;
      bump(owners[k] as Counts, who);
      const path = paths[k] ?? "";
      seen.add("");
      for (let s = path.indexOf("/"); s !== -1; s = path.indexOf("/", s + 1)) seen.add(path.slice(0, s + 1));
    }
    for (const d of seen) {
      const e = dirStats.get(d) ?? { commits: 0, last: 0, owners: new Map() };
      e.commits++;
      e.last = Math.max(e.last, v.time[c] ?? 0);
      bump(e.owners, who);
      dirStats.set(d, e);
    }
  }
  const people: GitPerson[] = [];
  const personAt = new Map<number, number>();
  const top = (m: Counts): number[] =>
    [...m]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, OWNERS_KEPT)
      .flatMap(([who, count]) => {
        let i = personAt.get(who);
        if (i === undefined) {
          const p = v.persons.get(who);
          i = people.length;
          people.push({ name: p?.name ?? "someone unknown", login: p?.login ?? null });
          personAt.set(who, i);
        }
        return [i, count];
      });
  const langs: string[] = [];
  const langAt = new Map<string, number>();
  const tree: GitTree = {
    v: GIT_FORMAT,
    builtAt: of.builtAt,
    head: of.head,
    branch: of.branch,
    logged,
    complete: true,
    people,
    langs,
    paths,
    size: [],
    sha: [],
    lang: [],
    flags: [],
    lines: [],
    churn,
    first: [],
    last: [],
    owners: owners.map(top),
    dirs: [],
    stored: 0,
    skipped: 0,
    raw: of.raw ?? null,
  };
  const fileBytes = of.fileBytes ?? FILE_BYTES_MAX;
  const folders = new Map<string, GitDir>();
  const dirOf = (path: string): GitDir => {
    let d = folders.get(path);
    if (!d) {
      const s = dirStats.get(path);
      d = { path, files: 0, size: 0, commits: s?.commits ?? 0, last: s?.last ?? 0, owners: s ? top(s.owners) : [] };
      folders.set(path, d);
    }
    return d;
  };
  const stored = new Set<string>();
  order.forEach((h, i) => {
    const head = v.head[h];
    const path = paths[i] ?? "";
    if (!head) return;
    const language = languageOf(path);
    let li = langAt.get(language);
    if (li === undefined) {
      li = langs.length;
      langs.push(language);
      langAt.set(language, li);
    }
    let flags = head.class === "symlink" ? FILE_LINK : 0;
    let lines: number | null = null;
    if (head.class === "binary" || isBinaryPath(path) || blobs.get(head.blob)?.binary) flags |= FILE_BINARY;
    else {
      lines = head.loc;
      if (head.bytes > fileBytes) flags |= FILE_BIG;
      else {
        flags |= FILE_STORED;
        stored.add(head.blob);
      }
    }
    if (flags & FILE_BIG) tree.skipped++;
    tree.size.push(head.bytes);
    tree.sha.push(head.blob);
    tree.lang.push(li);
    tree.flags.push(flags);
    tree.lines.push(lines);
    tree.first.push(v.known[head.file] ? (v.born[head.file] ?? 0) : 0);
    tree.last.push(v.known[head.file] ? (v.last[head.file] ?? 0) : 0);
    const root = dirOf("");
    root.files++;
    root.size += head.bytes;
    for (let s = path.indexOf("/"); s !== -1; s = path.indexOf("/", s + 1)) {
      const d = dirOf(path.slice(0, s + 1));
      d.files++;
      d.size += head.bytes;
    }
  });
  tree.stored = stored.size;
  tree.dirs = [...folders.values()].sort((a, b) => compareText(a.path, b.path));
  return tree;
}

/** The files each file at HEAD changes with, from commits of a few files that count: its tree position, how often together and a Jaccard degree in thousandths. */
export function gitCoupling(v: IndexView): GitCoupling {
  const order = headOrder(v);
  const at = new Map<number, number>();
  order.forEach((h, i) => at.set(v.head[h]?.file ?? -1, i));
  const n = order.length;
  const churn = new Array<number>(n).fill(0);
  const pairs = new Map<number, number>();
  for (let c = 0; c < v.time.length; c++) {
    if (!counts(v, c)) continue;
    const touched = new Set<number>();
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
      const k = at.get(v.file[i] ?? -1);
      if (k !== undefined) touched.add(k);
    }
    for (const k of touched) churn[k] = (churn[k] ?? 0) + 1;
    if (touched.size < 2 || touched.size > COUPLED_FILES) continue;
    const sorted = [...touched].sort((a, b) => a - b);
    for (let a = 0; a < sorted.length; a++)
      for (let b = a + 1; b < sorted.length; b++) {
        const key = (sorted[a] ?? 0) * n + (sorted[b] ?? 0);
        const had = pairs.get(key);
        if (had !== undefined) pairs.set(key, had + 1);
        else if (pairs.size < PAIRS_MAX) pairs.set(key, 1);
      }
  }
  const near = new Map<number, number[][]>();
  for (const [key, together] of pairs) {
    if (together < COUPLED_MIN) continue;
    const a = Math.floor(key / n);
    const b = key - a * n;
    const union = (churn[a] ?? 0) + (churn[b] ?? 0) - together;
    if (union <= 0) continue;
    const degree = Math.round((together * 1000) / union);
    (near.get(a) ?? near.set(a, []).get(a))?.push([b, together, degree]);
    (near.get(b) ?? near.set(b, []).get(b))?.push([a, together, degree]);
  }
  const of: Record<string, number[]> = {};
  for (const [i, rows] of near) {
    rows.sort((x, y) => (y[2] ?? 0) - (x[2] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0) || (x[0] ?? 0) - (y[0] ?? 0));
    of[String(i)] = rows.slice(0, COUPLED_KEPT).flat();
  }
  return { v: GIT_FORMAT, of };
}

/** The ids of the files at HEAD that are a path, or are in a folder and everything in it. */
export function filesUnder(v: IndexView, path: string): number[] {
  const order = headOrder(v);
  const paths = order.map((h) => v.paths[v.head[h]?.file ?? 0] ?? "");
  const [lo, hi] = path.endsWith("/") || path === "" ? rangeOf(paths, path) : [paths.indexOf(path), paths.indexOf(path) + 1];
  if (lo < 0 || hi <= lo) return [];
  const out: number[] = [];
  for (let i = lo; i < hi; i++) out.push(v.head[order[i] ?? 0]?.file ?? -1);
  return out;
}

/** The commits that touched a file at HEAD, or a folder and everything in it, newest first, Merge Commits left out. */
export function commitsUnder(v: IndexView, path: string): number[] {
  const wanted = new Set(filesUnder(v, path));
  if (wanted.size === 0) return [];
  const out: number[] = [];
  for (let c = v.time.length - 1; c >= 0; c--) {
    if (isMerge(v, c)) continue;
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++)
      if (wanted.has(v.file[i] ?? -1)) {
        out.push(c);
        break;
      }
  }
  return out;
}

export const MONTH = Math.round(30.44 * DAY);

/** How many of some commits fell in each month, counted from the first of them up to `until`, oldest month first. */
export function monthsOf(v: IndexView, commits: readonly number[], until: number): { from: number; step: number; counts: number[] } | null {
  if (commits.length === 0) return null;
  let first = Infinity;
  for (const c of commits) first = Math.min(first, v.time[c] ?? Infinity);
  const months = Math.max(1, Math.ceil((Math.max(until, first) - first) / MONTH));
  const counts = new Array<number>(months).fill(0);
  for (const c of commits) {
    const m = Math.min(months - 1, Math.max(0, Math.floor(((v.time[c] ?? first) - first) / MONTH)));
    counts[m] = (counts[m] ?? 0) + 1;
  }
  return { from: first, step: MONTH, counts };
}

/** The whole history as columns for the Universe to replay: Merge Commits left out, every path the history had, and whether each commit counts or is a Bulk Commit. */
export function gitLog(v: IndexView): GitLog {
  const used = new Map<number, number>();
  const folders: string[] = [];
  const folderAt = new Map<string, number>();
  const folder: number[] = [];
  const names: string[] = [];
  const lines: number[] = [];
  const alive: number[] = [];
  const fileAt = (f: number): number => {
    let i = used.get(f);
    if (i !== undefined) return i;
    i = names.length;
    used.set(f, i);
    const path = v.paths[f] ?? "";
    const cut = path.lastIndexOf("/");
    const dir = cut < 0 ? "" : path.slice(0, cut + 1);
    let d = folderAt.get(dir);
    if (d === undefined) {
      d = folders.length;
      folders.push(dir);
      folderAt.set(dir, d);
    }
    folder.push(d);
    names.push(path.slice(cut + 1));
    const head = v.headOf.get(f);
    lines.push(head?.loc ?? 0);
    alive.push(head ? 1 : 0);
    return i;
  };
  for (const h of v.head) fileAt(h.file);
  const people = [...v.persons.values()].sort((a, b) => b.commits - a.commits || a.id - b.id);
  const personAt = new Map(people.map((p, i) => [p.id, i]));
  const log: GitLog = {
    v: GIT_FORMAT,
    anchor: v.anchor,
    people: people.map((p) => ({ id: p.id, name: p.name, login: p.login, colour: p.colour, bot: isBot(v, p.id) })),
    folders,
    folder,
    names,
    lines,
    alive,
    gaps: [],
    who: [],
    kept: [],
    sizes: [],
    files: [],
  };
  let before = 0;
  for (let c = 0; c < v.time.length; c++) {
    if (isMerge(v, c)) continue;
    log.gaps.push((v.time[c] ?? 0) - before);
    before = v.time[c] ?? 0;
    const a = authorOf(v, c);
    log.who.push(a === null ? -1 : (personAt.get(a) ?? -1));
    log.kept.push(counts(v, c) ? 1 : 0);
    log.sizes.push((v.start[c + 1] ?? 0) - (v.start[c] ?? 0));
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) log.files.push(fileAt(v.file[i] ?? 0));
  }
  return log;
}

/** For each file and folder right inside a folder at HEAD, the newest commit that touched it, Merge Commits left out, as a commit position. */
export function lastInFolder(v: IndexView, path: string): Map<string, number> {
  const inside = new Map<number, string>();
  for (const h of v.head) {
    const p = v.paths[h.file] ?? "";
    if (!p.startsWith(path)) continue;
    const rest = p.slice(path.length);
    const cut = rest.indexOf("/");
    inside.set(h.file, cut < 0 ? rest : rest.slice(0, cut + 1));
  }
  const names = new Set(inside.values());
  const found = new Map<string, number>();
  for (let c = v.time.length - 1; c >= 0 && found.size < names.size; c--) {
    if (isMerge(v, c)) continue;
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
      const name = inside.get(v.file[i] ?? -1);
      if (name !== undefined && !found.has(name)) found.set(name, c);
    }
  }
  return found;
}
