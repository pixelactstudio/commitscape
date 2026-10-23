import { layoutOf, type Layout } from "./layout";
import { COMMIT_FLAG, folderPath, type Atlas } from "./payload";

export const DAY_SECONDS = 86_400;
export const WEEK_SECONDS = 7 * DAY_SECONDS;
export const YEAR_SECONDS = 365 * DAY_SECONDS;
export const SLOTS = 8;

export const COLOUR = { other: 8, nobody: 9, solo: 10 } as const;

export type Moment = { at: number; from?: number | null; solo?: number | null };

export type Frame = {
  at: number;
  from: number | null;
  height: Float32Array;
  colour: Float32Array;
  touched: Float32Array;
  slots: number[];
  beacons: Beacon[];
  tallest: number;
};

export type Beacon = { slot: number; person: number; folder: number; x: number; z: number; commits: number };

export type Strike = { commit: number; time: number; person: number; colour: number; bulk: boolean; files: number[]; total: number };

export type SlotSpan = { person: number; from: number; to: number };

export type Holder = { person: number; commits: number };

export type FileFacts = {
  file: number;
  rank: number;
  folder: number;
  born: number;
  died: number | null;
  dated: boolean;
  alive: boolean;
  aliveAtHead: boolean;
  commits: number;
  touches: number;
  lastTouch: number | null;
  inYear: number;
  holder: Holder | null;
  year: Holder[];
  ever: Holder[];
  perYear: { year: number; commits: number }[];
  lines: number | null;
  role: number;
  language: string | null;
};

export type FolderFacts = {
  folder: number;
  path: string;
  files: number;
  alive: number;
  frozen: number;
  commits: number;
  holders: Holder[];
  busFactor: number | null;
  first: number;
};

export type PersonFacts = {
  person: number;
  commits: number;
  first: number | null;
  last: number | null;
  inYear: number;
  folders: { folder: number; path: string; first: number; commits: number }[];
  slot: number | null;
};

export type Described = { at: number; alive: number; frozen: number; month: number; folder: number | null; folderCommits: number; person: number | null; personCommits: number };

export type Found = { kind: "person" | "folder" | "file"; id: number; label: string; detail: string; score: number };

const upper = (a: Float64Array, lo: number, hi: number, t: number): number => {
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if ((a[m] as number) <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
};

export class AtlasEngine {
  readonly atlas: Atlas;
  readonly layout: Layout;
  readonly weeks: number;
  readonly slotsByWeek: Int32Array;
  strip: Uint32Array;
  readonly fileStart: Uint32Array;
  readonly fileCommit: Int32Array;
  readonly fileTime: Float64Array;
  private prefix: Int32Array;
  private counted: Uint8Array;
  private hideBots = true;
  names: string[] | null = null;
  private folderPaths: string[] | null = null;
  private readonly people: number;

  constructor(atlas: Atlas, layout: Layout = layoutOf(atlas)) {
    this.atlas = atlas;
    this.layout = layout;
    this.people = atlas.people.id.length;
    const n = layout.count;
    const c = atlas.commits.time.length;
    const e = atlas.changes.file.length;
    this.weeks = Math.max(1, Math.floor((atlas.newest - atlas.origin) / WEEK_SECONDS) + 1);
    const start = new Uint32Array(n + 1);
    for (let j = 0; j < e; j++) start[(atlas.changes.file[j] as number) + 1]++;
    for (let f = 0; f < n; f++) start[f + 1] = (start[f + 1] as number) + (start[f] as number);
    const fill = start.slice(0, n);
    const fileCommit = new Int32Array(e);
    const fileTime = new Float64Array(e);
    for (let i = 0; i < c; i++) {
      for (let j = atlas.commits.start[i] as number; j < (atlas.commits.start[i + 1] as number); j++) {
        const f = atlas.changes.file[j] as number;
        const at = fill[f] as number;
        fileCommit[at] = i;
        fileTime[at] = atlas.commits.time[i] as number;
        fill[f] = at + 1;
      }
    }
    this.fileStart = start;
    this.fileCommit = fileCommit;
    this.fileTime = fileTime;
    this.counted = new Uint8Array(c);
    this.prefix = new Int32Array(e + n);
    this.slotsByWeek = new Int32Array(this.weeks * SLOTS).fill(-1);
    this.strip = new Uint32Array(this.weeks * (SLOTS + 1));
    this.setBots(true);
  }

  setBots(hide: boolean): void {
    this.hideBots = hide;
    const a = this.atlas;
    const c = a.commits.time.length;
    for (let i = 0; i < c; i++) {
      const p = a.commits.person[i] as number;
      const bulk = ((a.commits.flags[i] as number) & COMMIT_FLAG.bulk) !== 0;
      this.counted[i] = !bulk && !(hide && p >= 0 && a.people.bot[p] === 1) ? 1 : 0;
    }
    const n = this.layout.count;
    for (let f = 0; f < n; f++) {
      const s = this.fileStart[f] as number;
      const end = this.fileStart[f + 1] as number;
      let run = 0;
      this.prefix[s + f] = 0;
      for (let k = s; k < end; k++) {
        run += this.counted[this.fileCommit[k] as number] as number;
        this.prefix[k + f + 1] = run;
      }
    }
    this.sweep();
  }

  get botsHidden(): boolean {
    return this.hideBots;
  }

  private holds(p: number): boolean {
    return p >= 0 && this.atlas.people.bot[p] !== 1;
  }

  private sweep(): void {
    const a = this.atlas;
    const c = a.commits.time.length;
    const counts = new Int32Array(this.people);
    const active = new Set<number>();
    const slot = new Int32Array(SLOTS).fill(-1);
    const freed = new Float64Array(SLOTS).fill(-Infinity);
    this.slotsByWeek.fill(-1);
    this.strip.fill(0);
    let enter = 0;
    let leave = 0;
    for (let w = 0; w < this.weeks; w++) {
      const end = a.origin + (w + 1) * WEEK_SECONDS;
      const weekFrom = enter;
      while (enter < c && (a.commits.time[enter] as number) < end) {
        const p = a.commits.person[enter] as number;
        if (this.counted[enter] && this.holds(p)) {
          counts[p] = (counts[p] as number) + 1;
          active.add(p);
        }
        enter++;
      }
      while (leave < enter && (a.commits.time[leave] as number) < end - YEAR_SECONDS) {
        const p = a.commits.person[leave] as number;
        if (this.counted[leave] && this.holds(p)) {
          counts[p] = (counts[p] as number) - 1;
          if (counts[p] === 0) active.delete(p);
        }
        leave++;
      }
      const top = [...active].sort((x, y) => (counts[y] as number) - (counts[x] as number) || x - y).slice(0, SLOTS);
      const keep = new Set(top);
      for (let k = 0; k < SLOTS; k++) {
        if (slot[k] !== -1 && !keep.has(slot[k] as number)) {
          slot[k] = -1;
          freed[k] = w;
        }
      }
      for (const p of top) {
        if (slot.includes(p)) continue;
        let best = -1;
        for (let k = 0; k < SLOTS; k++) if (slot[k] === -1 && (best < 0 || (freed[k] as number) < (freed[best] as number))) best = k;
        if (best >= 0) slot[best] = p;
      }
      this.slotsByWeek.set(slot, w * SLOTS);
      const base = w * (SLOTS + 1);
      for (let i = weekFrom; i < enter; i++) {
        if (!this.counted[i]) continue;
        const p = a.commits.person[i] as number;
        const k = p >= 0 ? slot.indexOf(p) : -1;
        const at = base + (k >= 0 ? k : SLOTS);
        this.strip[at] = (this.strip[at] as number) + 1;
      }
    }
  }

  weekOf(t: number): number {
    return Math.max(0, Math.min(this.weeks - 1, Math.floor((t - this.atlas.origin) / WEEK_SECONDS)));
  }

  toWeeks(t: number): number {
    return (t - this.atlas.origin) / WEEK_SECONDS;
  }

  slotsAt(t: number): number[] {
    const w = this.weekOf(t);
    return Array.from(this.slotsByWeek.subarray(w * SLOTS, w * SLOTS + SLOTS));
  }

  slotHistory(): SlotSpan[][] {
    const out: SlotSpan[][] = Array.from({ length: SLOTS }, () => []);
    for (let k = 0; k < SLOTS; k++) {
      let cur: SlotSpan | null = null;
      for (let w = 0; w < this.weeks; w++) {
        const p = this.slotsByWeek[w * SLOTS + k] as number;
        if (cur && cur.person === p) cur.to = w;
        else {
          if (cur && cur.person >= 0) out[k]?.push(cur);
          cur = { person: p, from: w, to: w };
        }
      }
      if (cur && cur.person >= 0) out[k]?.push(cur);
    }
    return out;
  }

  private rangeTop(from: number, to: number): number[] {
    const a = this.atlas;
    const lo = upper(a.commits.time, 0, a.commits.time.length, from);
    const hi = upper(a.commits.time, 0, a.commits.time.length, to);
    const counts = new Map<number, number>();
    for (let i = lo; i < hi; i++) {
      const p = a.commits.person[i] as number;
      if (this.counted[i] && this.holds(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, SLOTS).map(([p]) => p);
    while (top.length < SLOTS) top.push(-1);
    return top;
  }

  frame(m: Moment): Frame {
    const a = this.atlas;
    const L = this.layout;
    const n = L.count;
    const t = Math.min(Math.max(m.at, a.origin), a.newest);
    const from = m.from === undefined || m.from === null ? null : Math.max(a.origin - 1, Math.min(m.from, t));
    const height = new Float32Array(n);
    const colour = new Float32Array(n).fill(COLOUR.nobody);
    const touched = new Float32Array(n).fill(-1e6);
    const slots = from === null ? this.slotsAt(t) : this.rangeTop(from, t);
    const lo = upper(a.commits.time, 0, a.commits.time.length, from ?? t - YEAR_SECONDS);
    const hi = upper(a.commits.time, 0, a.commits.time.length, t);
    const P = this.people;
    const count = new Map<number, number>();
    const last = new Map<number, number>();
    const total = from === null ? null : new Int32Array(n);
    for (let i = lo; i < hi; i++) {
      if (!this.counted[i]) continue;
      const p = a.commits.person[i] as number;
      const mine = this.holds(p);
      for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
        const f = a.changes.file[j] as number;
        if (total) total[f] = (total[f] as number) + 1;
        if (!mine) continue;
        const key = f * P + p;
        count.set(key, (count.get(key) ?? 0) + 1);
        last.set(key, i);
      }
    }
    const best = new Int32Array(n);
    const bestLast = new Int32Array(n).fill(-1);
    const holder = new Int32Array(n).fill(-1);
    for (const [key, k] of count) {
      const f = Math.floor(key / P);
      const p = key - f * P;
      const l = last.get(key) as number;
      if (k > (best[f] as number) || (k === best[f] && l > (bestLast[f] as number))) {
        best[f] = k;
        bestLast[f] = l;
        holder[f] = p;
      }
    }
    let tallest = 0;
    for (let f = 0; f < n; f++) {
      const s = this.fileStart[f] as number;
      const e = this.fileStart[f + 1] as number;
      const k = upper(this.fileTime, s, e, t) - s;
      const rank = L.rank[f] as number;
      const h = total ? (total[f] as number) : (this.prefix[s + f + k] as number);
      height[rank] = h;
      if (h > tallest) tallest = h;
      if (k > 0) touched[rank] = this.toWeeks(this.fileTime[s + k - 1] as number);
      const p = holder[f] as number;
      if (p >= 0) {
        if (m.solo !== undefined && m.solo !== null) colour[rank] = p === m.solo ? COLOUR.solo : COLOUR.nobody;
        else {
          const at = slots.indexOf(p);
          colour[rank] = at >= 0 ? at : COLOUR.other;
        }
      }
    }
    return { at: t, from, height, colour, touched, slots, beacons: from === null ? this.beacons(t, slots) : [], tallest };
  }

  private beacons(t: number, slots: number[]): Beacon[] {
    const a = this.atlas;
    const L = this.layout;
    const lo = upper(a.commits.time, 0, a.commits.time.length, t - 28 * DAY_SECONDS);
    const hi = upper(a.commits.time, 0, a.commits.time.length, t);
    const out: Beacon[] = [];
    slots.forEach((p, slot) => {
      if (p < 0) return;
      const byFolder = new Map<number, number>();
      let changes = 0;
      let commits = 0;
      for (let i = lo; i < hi; i++) {
        if (a.commits.person[i] !== p || !this.counted[i]) continue;
        commits++;
        for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
          changes++;
          for (let d = a.files.folder[a.changes.file[j] as number] as number; d >= 0; d = a.folders.parent[d] as number) {
            byFolder.set(d, (byFolder.get(d) ?? 0) + 1);
            if (d === 0) break;
          }
        }
      }
      if (commits === 0) return;
      let home = 0;
      for (const [d, k] of byFolder) if (k * 2 >= changes && (L.depth[d] as number) > (L.depth[home] as number) && (L.folderFrom[d] as number) >= 0) home = d;
      out.push({ slot, person: p, folder: home, x: L.folderX[home] as number, z: L.folderZ[home] as number, commits });
    });
    return out;
  }

  strikes(after: number, upTo: number, slots: number[], limit = 240): Strike[] {
    const a = this.atlas;
    if (upTo <= after) return [];
    let lo = upper(a.commits.time, 0, a.commits.time.length, after);
    const hi = upper(a.commits.time, 0, a.commits.time.length, upTo);
    lo = Math.max(lo, hi - limit);
    const out: Strike[] = [];
    for (let i = lo; i < hi; i++) {
      const p = a.commits.person[i] as number;
      const bulk = ((a.commits.flags[i] as number) & COMMIT_FLAG.bulk) !== 0;
      if (!bulk && !this.counted[i]) continue;
      const s = a.commits.start[i] as number;
      const e = a.commits.start[i + 1] as number;
      const files: number[] = [];
      for (let j = s; j < e && files.length < (bulk ? 0 : 50); j++) files.push(this.layout.rank[a.changes.file[j] as number] as number);
      if (bulk) for (let j = s; j < e; j += Math.max(1, Math.floor((e - s) / 64))) files.push(this.layout.rank[a.changes.file[j] as number] as number);
      const k = p >= 0 ? slots.indexOf(p) : -1;
      out.push({ commit: i, time: a.commits.time[i] as number, person: p, colour: k >= 0 ? k : COLOUR.other, bulk, files, total: e - s });
    }
    return out;
  }

  file(file: number, t: number): FileFacts {
    const a = this.atlas;
    const L = this.layout;
    const s = this.fileStart[file] as number;
    const e = this.fileStart[file + 1] as number;
    const k = upper(this.fileTime, s, e, t) - s;
    const yearFrom = upper(this.fileTime, s, e, t - YEAR_SECONDS);
    const year = new Map<number, { k: number; last: number }>();
    const ever = new Map<number, number>();
    const perYear = new Map<number, number>();
    let inYear = 0;
    for (let x = s; x < s + k; x++) {
      const i = this.fileCommit[x] as number;
      if (!this.counted[i]) continue;
      const p = a.commits.person[i] as number;
      const y = new Date((a.commits.time[i] as number) * 1000).getUTCFullYear();
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
      if (p >= 0) ever.set(p, (ever.get(p) ?? 0) + 1);
      if (x >= yearFrom) {
        inYear++;
        if (this.holds(p)) {
          const h = year.get(p) ?? { k: 0, last: 0 };
          h.k++;
          h.last = i;
          year.set(p, h);
        }
      }
    }
    const ranked = [...year.entries()].sort((x, y) => y[1].k - x[1].k || y[1].last - x[1].last);
    const top = ranked[0];
    const born = L.born[file] as number;
    const died = L.died[file] as number;
    const info = a.files.info[file] as number;
    const lang = a.files.language[file] as number;
    const lines = a.files.lines[file] as number;
    return {
      file,
      rank: L.rank[file] as number,
      folder: a.files.folder[file] as number,
      born,
      died: Number.isFinite(died) ? died : null,
      dated: L.dated[file] === 1,
      alive: born <= t && t < died,
      aliveAtHead: (info & 8) !== 0,
      commits: this.prefix[s + file + k] as number,
      touches: k,
      lastTouch: k > 0 ? (this.fileTime[s + k - 1] as number) : null,
      inYear,
      holder: top ? { person: top[0], commits: top[1].k } : null,
      year: ranked.slice(0, 6).map(([person, h]) => ({ person, commits: h.k })),
      ever: [...ever.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 6).map(([person, commits]) => ({ person, commits })),
      perYear: [...perYear.entries()].sort((x, y) => x[0] - y[0]).map(([year, commits]) => ({ year, commits })),
      lines: lines >= 0 ? lines : null,
      role: info & 7,
      language: lang > 0 ? (a.languages[lang - 1] ?? null) : null,
    };
  }

  folder(folder: number, t: number): FolderFacts {
    const a = this.atlas;
    const L = this.layout;
    const lo = L.folderFrom[folder] as number;
    const hi = L.folderTo[folder] as number;
    let alive = 0;
    let frozen = 0;
    for (let r = Math.max(0, lo); r < hi; r++) {
      const f = L.order[r] as number;
      if (!((L.born[f] as number) <= t && t < (L.died[f] as number))) continue;
      alive++;
      const s = this.fileStart[f] as number;
      const k = upper(this.fileTime, s, this.fileStart[f + 1] as number, t) - s;
      if (k === 0 || (this.fileTime[s + k - 1] as number) <= t - YEAR_SECONDS) frozen++;
    }
    const from = upper(a.commits.time, 0, a.commits.time.length, t - YEAR_SECONDS);
    const to = upper(a.commits.time, 0, a.commits.time.length, t);
    const by = new Map<number, number>();
    let commits = 0;
    for (let i = from; i < to; i++) {
      if (!this.counted[i]) continue;
      let inside = false;
      for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number) && !inside; j++) {
        const r = L.rank[a.changes.file[j] as number] as number;
        if (r >= lo && r < hi) inside = true;
      }
      if (!inside) continue;
      commits++;
      const p = a.commits.person[i] as number;
      if (this.holds(p)) by.set(p, (by.get(p) ?? 0) + 1);
    }
    const holders = [...by.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([person, k]) => ({ person, commits: k }));
    const held = holders.reduce((s, h) => s + h.commits, 0);
    let busFactor: number | null = null;
    if (held > 0) {
      let run = 0;
      busFactor = 0;
      for (const h of holders) {
        run += h.commits;
        busFactor++;
        if (run > held * 0.8) break;
      }
    }
    return { folder, path: folderPath(a, folder), files: Math.max(0, hi - lo), alive, frozen, commits, holders: holders.slice(0, 8), busFactor, first: L.folderFirst[folder] as number };
  }

  person(person: number, t: number): PersonFacts {
    const a = this.atlas;
    const L = this.layout;
    const c = a.commits.time.length;
    const firstIn = new Map<number, { first: number; commits: number }>();
    let commits = 0;
    let first: number | null = null;
    let last: number | null = null;
    let inYear = 0;
    for (let i = 0; i < c; i++) {
      if (a.commits.person[i] !== person) continue;
      const time = a.commits.time[i] as number;
      commits++;
      first ??= time;
      last = time;
      if (time > t - YEAR_SECONDS && time <= t) inYear++;
      const seen = new Set<number>();
      for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
        let d = a.files.folder[a.changes.file[j] as number] as number;
        while ((L.depth[d] as number) > 2) d = a.folders.parent[d] as number;
        if (seen.has(d)) continue;
        seen.add(d);
        const was = firstIn.get(d);
        if (was) was.commits++;
        else firstIn.set(d, { first: time, commits: 1 });
      }
    }
    const folders = [...firstIn.entries()]
      .sort((x, y) => x[1].first - y[1].first || x[0] - y[0])
      .slice(0, 40)
      .map(([folder, v]) => ({ folder, path: folderPath(a, folder), first: v.first, commits: v.commits }));
    const k = this.slotsAt(t).indexOf(person);
    return { person, commits, first, last, inYear, folders, slot: k >= 0 ? k : null };
  }

  describe(t: number): Described {
    const a = this.atlas;
    const L = this.layout;
    let alive = 0;
    let frozen = 0;
    for (let f = 0; f < L.count; f++) {
      if (!((L.born[f] as number) <= t && t < (L.died[f] as number))) continue;
      alive++;
      const s = this.fileStart[f] as number;
      const k = upper(this.fileTime, s, this.fileStart[f + 1] as number, t) - s;
      if (k === 0 || (this.fileTime[s + k - 1] as number) <= t - YEAR_SECONDS) frozen++;
    }
    const lo = upper(a.commits.time, 0, a.commits.time.length, t - 30 * DAY_SECONDS);
    const hi = upper(a.commits.time, 0, a.commits.time.length, t);
    const byFolder = new Map<number, number>();
    let month = 0;
    for (let i = lo; i < hi; i++) {
      if (!this.counted[i]) continue;
      month++;
      const seen = new Set<number>();
      for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
        let d = a.files.folder[a.changes.file[j] as number] as number;
        while ((L.depth[d] as number) > 2) d = a.folders.parent[d] as number;
        if (d === 0 || seen.has(d)) continue;
        seen.add(d);
        byFolder.set(d, (byFolder.get(d) ?? 0) + 1);
      }
    }
    let folder: number | null = null;
    let folderCommits = 0;
    for (const [d, k] of byFolder) {
      if (k > folderCommits || (k === folderCommits && folder !== null && (L.depth[d] as number) > (L.depth[folder] as number))) {
        folder = d;
        folderCommits = k;
      }
    }
    let person: number | null = null;
    let personCommits = 0;
    if (folder !== null) {
      const lo2 = L.folderFrom[folder] as number;
      const hi2 = L.folderTo[folder] as number;
      const by = new Map<number, number>();
      for (let i = lo; i < hi; i++) {
        const p = a.commits.person[i] as number;
        if (!this.counted[i] || !this.holds(p)) continue;
        for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
          const r = L.rank[a.changes.file[j] as number] as number;
          if (r >= lo2 && r < hi2) {
            by.set(p, (by.get(p) ?? 0) + 1);
            break;
          }
        }
      }
      for (const [p, k] of by) if (k > personCommits) [person, personCommits] = [p, k];
    }
    return { at: t, alive, frozen, month, folder, folderCommits, person, personCommits };
  }

  pathOf(kind: "folder" | "file", id: number): string {
    if (kind === "folder") return this.folderPathOf(id);
    const dir = this.folderPathOf(this.atlas.files.folder[id] as number);
    const name = this.names?.[id] ?? `file ${id + 1}`;
    return dir ? `${dir}/${name}` : name;
  }

  private folderPathOf(folder: number): string {
    this.folderPaths ??= Array.from({ length: this.atlas.folders.parent.length }, (_, i) => folderPath(this.atlas, i));
    return this.folderPaths[folder] ?? "";
  }

  search(query: string, limit = 12): Found[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const a = this.atlas;
    const out: Found[] = [];
    const score = (text: string): number => {
      const t = text.toLowerCase();
      const at = t.indexOf(q);
      if (at < 0) return -1;
      const end = t.lastIndexOf("/") + 1;
      return (at === 0 ? 30 : 0) + (at >= end ? 20 : 0) - t.length * 0.05;
    };
    for (let p = 0; p < a.people.id.length; p++) {
      const s = Math.max(score(a.people.names[p] ?? ""), score(a.people.logins[p] ?? ""));
      if (s >= 0) out.push({ kind: "person", id: p, label: a.people.names[p] ?? "", detail: a.people.logins[p] ? `@${a.people.logins[p]}` : "", score: s + 25 - p * 0.001 });
    }
    for (let d = 1; d < a.folders.parent.length; d++) {
      if ((this.layout.folderFrom[d] as number) < 0) continue;
      const path = this.folderPathOf(d);
      const s = score(path);
      const files = (this.layout.folderTo[d] as number) - (this.layout.folderFrom[d] as number);
      if (s >= 0) out.push({ kind: "folder", id: d, label: `${path}/`, detail: `${grouped(files)} files ever`, score: s + 10 + Math.log2(1 + files) * 2 });
    }
    if (this.names) {
      for (let f = 0; f < this.names.length && out.length < 4000; f++) {
        const name = this.names[f] ?? "";
        if (!name.toLowerCase().includes(q)) continue;
        const path = this.pathOf("file", f);
        const alive = ((a.files.info[f] as number) & 8) !== 0;
        out.push({ kind: "file", id: f, label: path, detail: alive ? "at HEAD" : "deleted", score: score(path) + (alive ? 5 : 0) });
      }
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit);
  }
}

const grouped = (n: number) => n.toLocaleString("en-US");
