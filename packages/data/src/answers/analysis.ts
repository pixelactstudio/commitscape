import {
  authorClock,
  authorOf,
  byPath,
  compareText,
  counts,
  DAY,
  divEuclid,
  FLAG,
  isBot,
  isCode,
  isMerge,
  isRankable,
  landedClock,
  landedDay,
  partitionPoint,
  personOf,
  remEuclid,
  ROLE,
  top,
  type HeadFile,
  type IndexView,
  type ViewWindow,
} from "./view";

export const WORK = ["features", "fixes", "refactors", "performance", "style", "tests", "docs", "dependencies", "CI", "build", "chores", "reverts", "unclassified"] as const;

export type Work = (typeof WORK)[number];

const KIND_WORK: Work[] = ["features", "fixes", "docs", "refactors", "tests", "performance", "style", "build", "chores", "reverts", "unclassified"];

const ROLE_WORK: Partial<Record<number, Work>> = { [ROLE.test]: "tests", [ROLE.docs]: "docs", [ROLE.dependencies]: "dependencies", [ROLE.ci]: "CI" };

export type Contributor = { author: number; commits: number; active_days: number; first: number; last: number };

export type Owner = { author: number; commits: number };

export type DirectoryOwnership = { dir: string; commits: number; owners: Owner[]; bus_factor: number };

export type LinesChanged = { added: number; removed: number; counted: number; uncounted: number };

export type Streak = { first_day: number; days: number };

export type Pulse = {
  commits: number;
  first_day: number;
  days: number[];
  week: number[][];
  work: { work: Work; commits: number }[];
  active_days: number;
  longest_streak: Streak | null;
  busiest_day: [number, number] | null;
};

export type MapNode = {
  name: string;
  path: string;
  parent: number | null;
  children: number[];
  file: number | null;
  lines: number;
  files: number;
  churn: number;
  last_touched: number;
  owner: Owner | null;
};

export type CoupledPair = { first: number; second: number; both: number; jaccard: number };

export type Moment =
  | { kind: "first_commit"; time: number; author: number | null }
  | { kind: "release"; time: number; name: string }
  | { kind: "joined"; time: number; author: number }
  | { kind: "left"; time: number; author: number }
  | { kind: "busiest_day"; time: number; commits: number }
  | { kind: "cleanup"; time: number; author: number | null; removed: number }
  | { kind: "quiet"; time: number; until: number }
  | { kind: "language_shift"; time: number; from: string; to: string };

const MOMENT_RANK: Record<Moment["kind"], number> = { first_commit: 0, joined: 1, busiest_day: 2, cleanup: 3, release: 4, language_shift: 5, left: 6, quiet: 7 };

const BUS_FACTOR_LINE = 0.8;

export class Analysis {
  readonly start: number;
  readonly end: number;
  readonly churn: Uint32Array;
  private cache = new Map<string, unknown>();
  readonly v: IndexView;
  readonly window: ViewWindow;

  constructor(v: IndexView, window: ViewWindow) {
    this.v = v;
    this.window = window;
    const from = window.from;
    this.start = from === null ? 0 : partitionPoint(v.time, (t) => t < from);
    this.end = Math.max(this.start, partitionPoint(v.time, (t) => t <= window.to));
    this.churn = new Uint32Array(v.paths.length);
    for (let c = this.start; c < this.end; c++) {
      if (!counts(v, c)) continue;
      for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
        const f = v.file[i] ?? -1;
        if (f >= 0 && f < this.churn.length) this.churn[f] = (this.churn[f] ?? 0) + 1;
      }
    }
  }

  private once<T>(key: string, make: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key) as T;
  }

  churnOf(file: number): number {
    return this.churn[file] ?? 0;
  }

  ranked(): HeadFile[] {
    return this.v.head.filter((h) => isRankable(h.class));
  }

  code(): HeadFile[] {
    return this.v.head.filter((h) => isCode(h.class));
  }

  *changes(c: number): Generator<number> {
    for (let i = this.v.start[c] ?? 0; i < (this.v.start[c + 1] ?? 0); i++) yield i;
  }

  totals() {
    const v = this.v;
    const t = { commits: v.snapshot.commits, merges: v.snapshot.merges, first_commit: v.snapshot.oldest, last_commit: v.snapshot.newest, people: 0, files: 0, code_files: 0, code_lines: 0, prose_lines: 0 };
    for (const p of v.persons.values()) if (!isBot(v, p.id)) t.people += 1;
    for (const h of v.head) {
      if (!isRankable(h.class)) continue;
      t.files += 1;
      if (isCode(h.class)) {
        t.code_files += 1;
        t.code_lines += h.loc;
      } else t.prose_lines += h.loc;
    }
    return t;
  }

  churnRanking(): { file: number; commits: number }[] {
    return this.once("churn", () =>
      top(
        this.ranked()
          .map((h) => ({ file: h.file, commits: this.churnOf(h.file) }))
          .filter((c) => c.commits > 0),
        (a, b) => b.commits - a.commits || byPath(this.v, a.file, b.file),
      ),
    );
  }

  largest(): { file: number; loc: number }[] {
    return top(
      this.code().map((h) => ({ file: h.file, loc: h.loc })),
      (a, b) => b.loc - a.loc || byPath(this.v, a.file, b.file),
    );
  }

  stalest(): { file: number; days: number }[] {
    const v = this.v;
    return top(
      this.ranked()
        .filter((h) => v.known[h.file])
        .map((h) => ({ file: h.file, days: Math.max(0, Math.trunc((this.window.to - (v.last[h.file] ?? 0)) / DAY)) })),
      (a, b) => b.days - a.days || byPath(v, a.file, b.file),
    );
  }

  pulse(who: number | null): Pulse {
    return this.once(`pulse:${who}`, () => ({ ...this.pulseInTime(who), work: this.work(who) }));
  }

  private work(who: number | null): { work: Work; commits: number }[] {
    const v = this.v;
    const out = WORK.map((work) => ({ work, commits: 0 }));
    for (let c = this.start; c < this.end; c++) {
      if (isMerge(v, c) || (who !== null && authorOf(v, c) !== who)) continue;
      let w: Work | undefined;
      const s = v.start[c] ?? 0;
      const e = v.start[c + 1] ?? 0;
      if (e > s) {
        const first = v.role[v.file[s] ?? 0] ?? ROLE.code;
        let same = true;
        for (let i = s + 1; i < e; i++) if ((v.role[v.file[i] ?? 0] ?? ROLE.code) !== first) same = false;
        if (same) w = ROLE_WORK[first];
      }
      w ??= KIND_WORK[v.kind[c] ?? 10] ?? "unclassified";
      const slot = out.find((x) => x.work === w);
      if (slot) slot.commits += 1;
    }
    return out;
  }

  private pulseInTime(who: number | null): Omit<Pulse, "work"> {
    const v = this.v;
    const commits: number[] = [];
    for (let c = this.start; c < this.end; c++) if (!isMerge(v, c) && (who === null || authorOf(v, c) === who)) commits.push(c);
    let lastDay = divEuclid(this.window.to, DAY);
    for (const c of commits) lastDay = Math.max(lastDay, landedDay(v, c));
    let firstDay: number | null = this.window.from === null ? null : divEuclid(this.window.from, DAY);
    for (const c of commits) firstDay = firstDay === null ? landedDay(v, c) : Math.min(firstDay, landedDay(v, c));
    const first = firstDay ?? lastDay;
    const days = new Array<number>(Math.max(0, lastDay - first + 1)).fill(0);
    const week = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const c of commits) {
      const d = landedDay(v, c) - first;
      if (d >= 0 && d < days.length) days[d] = (days[d] ?? 0) + 1;
      const clock = authorClock(v, c);
      const weekday = remEuclid(divEuclid(clock, DAY) + 3, 7);
      const hour = Math.floor(remEuclid(clock, DAY) / 3600);
      const row = week[weekday];
      if (row) row[hour] = (row[hour] ?? 0) + 1;
    }
    let longest: Streak | null = null;
    let run = 0;
    days.forEach((n, i) => {
      run = n > 0 ? run + 1 : 0;
      if (run > (longest?.days ?? 0)) longest = { first_day: first + i + 1 - run, days: run };
    });
    let busiest: [number, number] | null = null;
    days.forEach((n, i) => {
      if (n > (busiest?.[1] ?? 0)) busiest = [first + i, n];
    });
    return { commits: commits.length, first_day: first, days, week, active_days: days.filter((n) => n > 0).length, longest_streak: longest, busiest_day: busiest };
  }

  commitsByPerson(pulse: Pulse, contributors: Contributor[], count: number) {
    const v = this.v;
    const people = contributors.slice(0, count).map((c) => c.author);
    const days = pulse.days.map(() => new Array<number>(people.length + 1).fill(0));
    for (let c = this.start; c < this.end; c++) {
      if (isMerge(v, c)) continue;
      const a = authorOf(v, c);
      const at = a === null ? -1 : people.indexOf(a);
      const column = at < 0 ? people.length : at;
      const row = days[landedDay(v, c) - pulse.first_day];
      if (row) row[column] = (row[column] ?? 0) + 1;
    }
    return { first_day: pulse.first_day, people, days };
  }

  contributors(): Contributor[] {
    return this.once("contributors", () => this.committers(false));
  }

  bots(): Contributor[] {
    return this.once("bots", () => this.committers(true));
  }

  private committers(bots: boolean): Contributor[] {
    const v = this.v;
    const made: [number, number][] = [];
    for (let c = this.start; c < this.end; c++) {
      if (isMerge(v, c)) continue;
      const a = authorOf(v, c);
      if (a === null || isBot(v, a) !== bots) continue;
      made.push([a, landedClock(v, c)]);
    }
    made.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const out: Contributor[] = [];
    let lastDay: number | null = null;
    for (const [author, clock] of made) {
      const day = divEuclid(clock, DAY);
      const last = out[out.length - 1];
      if (last && last.author === author) {
        last.commits += 1;
        last.last = clock;
        if (lastDay !== day) last.active_days += 1;
      } else out.push({ author, commits: 1, active_days: 1, first: clock, last: clock });
      lastDay = day;
    }
    return top(out, (a, b) => b.commits - a.commits || a.author - b.author);
  }

  activity(): [number, number] {
    const v = this.v;
    const people = new Set<number>();
    let commits = 0;
    for (let c = this.start; c < this.end; c++) {
      if (isMerge(v, c)) continue;
      const a = authorOf(v, c);
      if (a === null || isBot(v, a)) continue;
      commits += 1;
      people.add(a);
    }
    return [commits, people.size];
  }

  ownership(): DirectoryOwnership[] {
    return this.once("ownership", () => {
      const v = this.v;
      const written = new Uint8Array(v.paths.length);
      for (const h of this.ranked()) written[h.file] = 1;
      const dirsOf = new Map<number, string[]>();
      const perDir = new Map<string, { commits: number; stamp: number; by: Map<number, number> }>();
      for (let c = this.start; c < this.end; c++) {
        if (!counts(v, c)) continue;
        const author = personOf(v, c);
        if (author === null) continue;
        for (const i of this.changes(c)) {
          const f = v.file[i] ?? -1;
          if (!written[f]) continue;
          let dirs = dirsOf.get(f);
          if (!dirs) {
            dirs = ancestors(v.paths[f] ?? "");
            dirsOf.set(f, dirs);
          }
          for (const d of dirs) {
            let entry = perDir.get(d);
            if (!entry) {
              entry = { commits: 0, stamp: -1, by: new Map() };
              perDir.set(d, entry);
            }
            if (entry.stamp === c) continue;
            entry.stamp = c;
            entry.commits += 1;
            entry.by.set(author, (entry.by.get(author) ?? 0) + 1);
          }
        }
      }
      const out: DirectoryOwnership[] = [];
      for (const [dir, entry] of perDir) {
        if (entry.commits < v.options.ownership_min_commits) continue;
        const owners = [...entry.by].map(([author, commits]) => ({ author, commits })).sort((a, b) => b.commits - a.commits || a.author - b.author);
        out.push({ dir, commits: entry.commits, owners, bus_factor: busFactor(owners, entry.commits) });
      }
      return top(out, (a, b) => a.bus_factor - b.bus_factor || b.commits - a.commits || compareText(a.dir, b.dir));
    });
  }

  heldAlone(): DirectoryOwnership[] {
    return this.once("held", () => {
      const held = this.ownership().filter((d) => d.bus_factor === 1);
      const holder = (d: DirectoryOwnership) => d.owners[0]?.author;
      return held.filter((d) => !held.some((outer) => outer.dir.length < d.dir.length && d.dir.startsWith(outer.dir) && holder(outer) === holder(d)));
    });
  }

  linesByPerson(): Map<number, LinesChanged> {
    return this.once("lines", () => {
      const v = this.v;
      const out = new Map<number, LinesChanged>();
      for (let c = this.start; c < this.end; c++) {
        if (!counts(v, c) || ((v.flags[c] ?? 0) & FLAG.blameIgnored) !== 0) continue;
        const author = personOf(v, c);
        if (author === null) continue;
        let l = out.get(author);
        if (!l) {
          l = { added: 0, removed: 0, counted: 0, uncounted: 0 };
          out.set(author, l);
        }
        for (const i of this.changes(c)) {
          if (!writtenFile(v, v.file[i] ?? -1)) continue;
          const added = v.added[i] ?? -1;
          if (added >= 0) {
            l.added += added;
            l.removed += Math.max(0, v.removed[i] ?? 0);
            l.counted += 1;
          } else l.uncounted += 1;
        }
      }
      return out;
    });
  }

  areas(): Map<number, number> {
    const out = new Map<number, number>();
    for (const d of this.heldAlone()) {
      const o = d.owners[0];
      if (o) out.set(o.author, (out.get(o.author) ?? 0) + 1);
    }
    return out;
  }

  workOf(author: number): { file: number; commits: number }[] {
    const v = this.v;
    const written = new Uint8Array(v.paths.length);
    for (const h of this.ranked()) written[h.file] = v.role[h.file] === ROLE.dependencies ? 0 : 1;
    const commits = new Uint32Array(v.paths.length);
    for (let c = this.start; c < this.end; c++) {
      if (!counts(v, c) || authorOf(v, c) !== author) continue;
      for (const i of this.changes(c)) {
        const f = v.file[i] ?? -1;
        if (written[f]) commits[f] = (commits[f] ?? 0) + 1;
      }
    }
    return top(
      this.ranked()
        .map((h) => ({ file: h.file, commits: commits[h.file] ?? 0 }))
        .filter((x) => x.commits > 0),
      (a, b) => b.commits - a.commits || byPath(v, a.file, b.file),
    );
  }

  commitsTouching(file: number): number[] {
    const v = this.v;
    const out: number[] = [];
    for (let c = this.end - 1; c >= this.start; c--) {
      if (!counts(v, c)) continue;
      for (const i of this.changes(c))
        if (v.file[i] === file) {
          out.push(c);
          break;
        }
    }
    return out;
  }

  ownersOf(file: number): Owner[] {
    const by = new Map<number, number>();
    for (const c of this.commitsTouching(file)) {
      const p = personOf(this.v, c);
      if (p !== null) by.set(p, (by.get(p) ?? 0) + 1);
    }
    return [...by].map(([author, commits]) => ({ author, commits })).sort((a, b) => b.commits - a.commits || a.author - b.author);
  }

  codeMap(): MapNode[] {
    return this.once("map", () => {
      const v = this.v;
      const nodes: MapNode[] = [node("", "", null, null)];
      const dirs = new Map<string, number>();
      const leafOf = new Map<number, number>();
      const add = (n: MapNode) => {
        const at = nodes.length;
        if (n.parent !== null) nodes[n.parent]?.children.push(at);
        nodes.push(n);
        return at;
      };
      for (const h of this.ranked()) {
        const path = v.paths[h.file];
        if (path === undefined) continue;
        let parent = 0;
        let start = 0;
        for (let i = 0; i < path.length; i++) {
          if (path[i] !== "/") continue;
          const dir = path.slice(0, i + 1);
          let n = dirs.get(dir);
          if (n === undefined) {
            n = add(node(path.slice(start, i), dir, parent, null));
            dirs.set(dir, n);
          }
          parent = n;
          start = i + 1;
        }
        const leaf = node(path.slice(start), path, parent, h.file);
        leaf.lines = h.loc;
        leaf.files = 1;
        leaf.last_touched = v.known[h.file] ? (v.last[h.file] ?? 0) : 0;
        leafOf.set(h.file, add(leaf));
      }
      for (let i = nodes.length - 1; i >= 1; i--) {
        const child = nodes[i];
        const parent = child?.parent === null || child === undefined ? undefined : nodes[child.parent];
        if (!child || !parent) continue;
        parent.lines += child.lines;
        parent.files += child.files;
        parent.last_touched = Math.max(parent.last_touched, child.last_touched);
      }
      const countedFor = new Int32Array(nodes.length).fill(-1);
      const made = nodes.map(() => new Map<number, number>());
      for (let c = this.start; c < this.end; c++) {
        if (!counts(v, c)) continue;
        const author = personOf(v, c);
        if (author === null) continue;
        for (const i of this.changes(c)) {
          let at = leafOf.get(v.file[i] ?? -1) ?? null;
          while (at !== null) {
            if (countedFor[at] === c) break;
            countedFor[at] = c;
            const n = nodes[at];
            if (!n) break;
            n.churn += 1;
            const by = made[at];
            if (by) by.set(author, (by.get(author) ?? 0) + 1);
            at = n.parent;
          }
        }
      }
      made.forEach((by, at) => {
        let best: Owner | null = null;
        for (const author of [...by.keys()].sort((a, b) => a - b)) {
          const commits = by.get(author) ?? 0;
          if (commits > (best?.commits ?? 0)) best = { author, commits };
        }
        const n = nodes[at];
        if (n) n.owner = best;
      });
      for (const n of nodes) n.children.sort((a, b) => (nodes[b]?.lines ?? 0) - (nodes[a]?.lines ?? 0) || compareText(nodes[a]?.name ?? "", nodes[b]?.name ?? ""));
      return nodes;
    });
  }

  coupling(): CoupledPair[] {
    return this.once("coupling", () => {
      const v = this.v;
      const support = Math.max(1, v.options.coupling_support);
      const supported = new Uint8Array(v.paths.length);
      for (const h of this.ranked()) if (this.churnOf(h.file) >= support) supported[h.file] = 1;
      const together = new Map<number, number>();
      const n = v.paths.length;
      for (let c = this.start; c < this.end; c++) {
        if (!counts(v, c)) continue;
        const touched = [...new Set([...this.changes(c)].map((i) => v.file[i] ?? -1).filter((f) => supported[f]))].sort((a, b) => a - b);
        for (let i = 0; i < touched.length; i++)
          for (let j = i + 1; j < touched.length; j++) {
            const key = (touched[i] ?? 0) * n + (touched[j] ?? 0);
            together.set(key, (together.get(key) ?? 0) + 1);
          }
      }
      const pairs: CoupledPair[] = [];
      for (const [key, both] of together) {
        const a = Math.floor(key / n);
        const b = key % n;
        const [first, second] = byPath(v, a, b) > 0 ? [b, a] : [a, b];
        const either = this.churnOf(first) + this.churnOf(second) - both;
        pairs.push({ first, second, both, jaccard: either === 0 ? 0 : both / either });
      }
      return top(pairs, (a, b) => b.jaccard - a.jaccard || b.both - a.both || byPath(v, a.first, b.first) || byPath(v, a.second, b.second));
    });
  }

  health(): { maintainers: Owner[]; bus_factor: number | null } {
    const v = this.v;
    const end = this.window.to;
    const recent = end - 90 * DAY;
    const year = end - 365 * DAY;
    const lately = new Map<number, number>();
    const inYear = new Map<number, number>();
    for (let c = 0; c < v.time.length; c++) {
      const t = v.time[c] ?? 0;
      if (isMerge(v, c) || t > end) continue;
      const p = personOf(v, c);
      if (p === null) continue;
      if (t > year) inYear.set(p, (inYear.get(p) ?? 0) + 1);
      if (t > recent) lately.set(p, (lately.get(p) ?? 0) + 1);
    }
    const maintainers = [...lately]
      .filter(([, n]) => n >= 3)
      .map(([author, commits]) => ({ author, commits }))
      .sort((a, b) => b.commits - a.commits || a.author - b.author);
    const shares = [...inYear.values()].sort((a, b) => b - a);
    const total = shares.reduce((s, n) => s + n, 0);
    let busFactor: number | null = null;
    if (total > 0) {
      let held = 0;
      busFactor = 0;
      for (const n of shares) {
        held += n;
        busFactor += 1;
        if (held > 0.8 * total) break;
      }
    }
    return { maintainers, bus_factor: busFactor };
  }

  timeline(releases: [string, number][]): Moment[] {
    const v = this.v;
    const w = this.window;
    const commits: number[] = [];
    for (let c = this.start; c < this.end; c++) if (!isMerge(v, c)) commits.push(c);
    const out: Moment[] = [];
    if (commits.length === 0) return out;
    const ever = new Map<number, [number, number]>();
    let projectFirst: number | null = null;
    for (let c = 0; c < v.time.length; c++) {
      const t = v.time[c] ?? 0;
      if (isMerge(v, c) || t > w.to) continue;
      projectFirst ??= c;
      const a = personOf(v, c);
      if (a === null) continue;
      const e = ever.get(a);
      if (e) {
        e[0] = Math.min(e[0], t);
        e[1] = Math.max(e[1], t);
      } else ever.set(a, [t, t]);
    }
    const inWindow = (t: number) => w.from === null || t >= w.from;
    if (projectFirst !== null && inWindow(v.time[projectFirst] ?? 0)) out.push({ kind: "first_commit", time: v.time[projectFirst] ?? 0, author: personOf(v, projectFirst) });
    for (const [name, time] of releases) if ((w.from === null || time >= w.from) && time <= w.to) out.push({ kind: "release", time, name });
    const made = new Map<number, number>();
    for (const c of commits) {
      const a = personOf(v, c);
      if (a !== null) made.set(a, (made.get(a) ?? 0) + 1);
    }
    const total = commits.length;
    const firstAuthor = projectFirst === null ? null : personOf(v, projectFirst);
    for (const [author, n] of [...made].sort((a, b) => a[0] - b[0])) {
      const e = ever.get(author);
      if (!e || n < total * 0.05) continue;
      const [joined, last] = e;
      if (inWindow(joined) && author !== firstAuthor) out.push({ kind: "joined", time: joined, author });
      if (w.to - last >= 90 * DAY) out.push({ kind: "left", time: last, author });
    }
    const perDay = new Map<number, number>();
    for (const c of commits) perDay.set(landedDay(v, c), (perDay.get(landedDay(v, c)) ?? 0) + 1);
    let busiest: [number, number] | null = null;
    for (const [day, n] of perDay) if (!busiest || n > busiest[1] || (n === busiest[1] && day < busiest[0])) busiest = [day, n];
    if (busiest && busiest[1] >= 2) out.push({ kind: "busiest_day", time: busiest[0] * DAY, commits: busiest[1] });
    let cleanup: [number, number] | null = null;
    const added = new Map<string, number>();
    for (const c of commits) {
      let plus = 0;
      let minus = 0;
      for (const i of this.changes(c)) {
        const a = v.added[i] ?? -1;
        const f = v.file[i] ?? -1;
        if (a < 0 || !writtenFile(v, f)) continue;
        plus += a;
        minus += Math.max(0, v.removed[i] ?? 0);
        const language = v.language[f];
        if (language) {
          const key = `${quarterOf(v.time[c] ?? 0)}\u0000${language}`;
          added.set(key, (added.get(key) ?? 0) + a);
        }
      }
      const net = Math.max(0, minus - plus);
      if (net >= 500 && (cleanup === null || net > cleanup[0])) cleanup = [net, c];
    }
    if (cleanup) out.push({ kind: "cleanup", time: v.time[cleanup[1]] ?? 0, author: personOf(v, cleanup[1]), removed: cleanup[0] });
    const byQuarter = new Map<number, [string, number][]>();
    for (const [key, lines] of added) {
      const [q, language] = key.split("\u0000") as [string, string];
      const list = byQuarter.get(Number(q)) ?? [];
      list.push([language, lines]);
      byQuarter.set(Number(q), list);
    }
    let main: string | null = null;
    for (const q of [...byQuarter.keys()].sort((a, b) => a - b)) {
      let best: [string, number] | null = null;
      for (const [language, lines] of byQuarter.get(q) ?? []) {
        if (lines < 500) continue;
        if (!best || lines > best[1] || (lines === best[1] && language < best[0])) best = [language, lines];
      }
      if (!best) continue;
      if (main !== null && main !== best[0]) out.push({ kind: "language_shift", time: quarterStart(q), from: main, to: best[0] });
      main = best[0];
    }
    const gaps: [number, number][] = [];
    for (let i = 1; i < commits.length; i++) {
      const a = v.time[commits[i - 1] ?? 0] ?? 0;
      const b = v.time[commits[i] ?? 0] ?? 0;
      if (b - a >= 30 * DAY) gaps.push([a, b]);
    }
    gaps.sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
    for (const [time, until] of gaps.slice(0, 3)) out.push({ kind: "quiet", time, until });
    return out.sort((a, b) => a.time - b.time || MOMENT_RANK[a.kind] - MOMENT_RANK[b.kind]);
  }
}

function ancestors(path: string): string[] {
  const out = [""];
  for (let i = 0; i < path.length; i++) if (path[i] === "/") out.push(path.slice(0, i + 1));
  return out;
}

function busFactor(owners: Owner[], total: number): number {
  let held = 0;
  for (let i = 0; i < owners.length; i++) {
    held += owners[i]?.commits ?? 0;
    if (held > BUS_FACTOR_LINE * total) return i + 1;
  }
  return owners.length;
}

function writtenFile(v: IndexView, f: number): boolean {
  if (f < 0) return false;
  const h = v.headOf.get(f);
  const generated = h ? h.class === "generated" || h.class === "vendored" : v.guessedGenerated[f] === 1;
  return !generated && v.lockfile[f] !== 1;
}

function node(name: string, path: string, parent: number | null, file: number | null): MapNode {
  return { name, path, parent, children: [], file, lines: 0, files: 0, churn: 0, last_touched: 0, owner: null };
}

export function quarterOf(time: number): number {
  const d = new Date(time * 1000);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
}

function quarterStart(q: number): number {
  const year = Math.floor(q / 4);
  const month = remEuclid(q, 4) * 3;
  return Date.UTC(year, month, 1) / 1000;
}

