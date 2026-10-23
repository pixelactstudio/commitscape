import type { Atlas } from "./payload";

export const SQRT3 = Math.sqrt(3);

export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

const RULES: Record<"A" | "B", string> = { A: "A-B--B+A++AA+B-", B: "+A-BB--B-A++A+B" };

/** The first `n` cells of a Gosper curve (flowsnake) as axial hex coordinates: neighbours follow neighbours, and any run of the curve is one compact region. */
export function gosper(n: number): { q: Int32Array; r: Int32Array } {
  const q = new Int32Array(n);
  const r = new Int32Array(n);
  if (n === 0) return { q, r };
  let level = 0;
  while (7 ** level < n) level++;
  let cq = 0;
  let cr = 0;
  let dir = 0;
  let at = 1;
  const walk = (symbol: "A" | "B", depth: number): boolean => {
    if (at >= n) return false;
    if (depth === 0) {
      const d = DIRECTIONS[dir] as readonly [number, number];
      cq += d[0];
      cr += d[1];
      q[at] = cq;
      r[at] = cr;
      at++;
      return at < n;
    }
    for (const ch of RULES[symbol]) {
      if (ch === "+") dir = (dir + 1) % 6;
      else if (ch === "-") dir = (dir + 5) % 6;
      else if (!walk(ch as "A" | "B", depth - 1)) return false;
    }
    return true;
  };
  walk("A", level);
  return { q, r };
}

/** Where a hex's centre is on the ground, for a hex of circumradius 1. */
export function hexX(q: number, r: number): number {
  return SQRT3 * (q + r / 2);
}

export function hexZ(r: number): number {
  return 1.5 * r;
}

/** The hex a point on the ground falls in. */
export function hexAt(x: number, z: number): [number, number] {
  const fr = z / 1.5;
  const fq = x / SQRT3 - fr / 2;
  return roundAxial(fq, fr);
}

function roundAxial(fq: number, fr: number): [number, number] {
  const fs = -fq - fr;
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);
  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq || 0, rr || 0];
}

export const cellKey = (q: number, r: number) => (q + 32768) * 65536 + (r + 32768);

export type Island = { folder: number; filesOnly: boolean; from: number; to: number; x: number; z: number; radius: number };

export type Layout = {
  count: number;
  order: Int32Array;
  rank: Int32Array;
  q: Int32Array;
  r: Int32Array;
  x: Float32Array;
  z: Float32Array;
  borders: Uint16Array;
  born: Float64Array;
  died: Float64Array;
  dated: Uint8Array;
  depth: Uint8Array;
  folderFrom: Int32Array;
  folderTo: Int32Array;
  folderX: Float32Array;
  folderZ: Float32Array;
  folderRadius: Float32Array;
  folderFirst: Float64Array;
  islands: Island[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

/** When each file first changed on the default branch and when it went: the deletion that removed it (dated), or, for a file gone by HEAD with no deletion of its own on the default branch, its last change; Infinity while it lives. */
export function lifetimes(a: Atlas): { born: Float64Array; died: Float64Array; dated: Uint8Array } {
  const n = a.files.folder.length;
  const born = new Float64Array(n).fill(Infinity);
  const died = new Float64Array(n).fill(Infinity);
  const touched = new Float64Array(n);
  const dated = new Uint8Array(n);
  const c = a.commits.time.length;
  for (let i = 0; i < c; i++) {
    const t = a.commits.time[i] as number;
    for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
      const f = a.changes.file[j] as number;
      if (born[f] === Infinity) born[f] = t;
      died[f] = a.changes.kind[j] === 2 ? t : Infinity;
      touched[f] = t;
    }
  }
  for (let f = 0; f < n; f++) {
    if (born[f] === Infinity) born[f] = a.origin;
    if ((a.files.info[f] as number) & 8) died[f] = Infinity;
    else if (died[f] === Infinity) died[f] = Math.max(born[f] as number, touched[f] as number);
    else dated[f] = 1;
  }
  return { born, died, dated };
}

const ISLAND_SHARE = 0.55;
const ISLAND_SPLITS = 3;
const ASPECT = 1.45;

/** Lays the Atlas out: every file one hex, folders in depth-first order with siblings by their first commit and files by birth, each top-level folder (or, while one holds most of the code, its children) its own Gosper island, islands packed largest first around the middle. */
export function layoutOf(a: Atlas): Layout {
  const n = a.files.folder.length;
  const f = a.folders.parent.length;
  const { born, died, dated } = lifetimes(a);
  const depth = new Uint8Array(f);
  for (let i = 1; i < f; i++) depth[i] = (depth[a.folders.parent[i] as number] as number) + 1;
  const folderFirst = new Float64Array(f).fill(Infinity);
  const size = new Int32Array(f);
  for (let i = 0; i < n; i++) {
    for (let d = a.files.folder[i] as number; d >= 0; d = a.folders.parent[d] as number) {
      size[d] = (size[d] as number) + 1;
      if ((born[i] as number) < (folderFirst[d] as number)) folderFirst[d] = born[i] as number;
      if (d === 0) break;
    }
  }
  const subfolders: number[][] = Array.from({ length: f }, () => []);
  for (let i = 1; i < f; i++) if ((size[i] as number) > 0) subfolders[a.folders.parent[i] as number]?.push(i);
  const filesIn: number[][] = Array.from({ length: f }, () => []);
  for (let i = 0; i < n; i++) filesIn[a.files.folder[i] as number]?.push(i);
  const byTime = (x: number, y: number) => x - y;
  for (const list of subfolders) list.sort((x, y) => byTime(folderFirst[x] as number, folderFirst[y] as number) || x - y);
  for (const list of filesIn) list.sort((x, y) => byTime(born[x] as number, born[y] as number) || x - y);

  type Root = { folder: number; filesOnly: boolean; size: number };
  const firstOf = (x: Root) => (x.filesOnly ? Math.min(...(filesIn[x.folder] ?? []).map((i) => born[i] as number)) : (folderFirst[x.folder] as number));
  const rootsOf = (folder: number, splits: number): Root[] => {
    const kids: Root[] = (subfolders[folder] ?? []).map((s) => ({ folder: s, filesOnly: false, size: size[s] as number }));
    const own = filesIn[folder]?.length ?? 0;
    if (own > 0) kids.push({ folder, filesOnly: true, size: own });
    kids.sort((x, y) => firstOf(x) - firstOf(y) || x.folder - y.folder || Number(x.filesOnly) - Number(y.filesOnly));
    const biggest = kids.reduce<Root | null>((b, x) => (!b || x.size > b.size ? x : b), null);
    if (splits < ISLAND_SPLITS && biggest && !biggest.filesOnly && biggest.size >= n * ISLAND_SHARE && (subfolders[biggest.folder]?.length ?? 0) >= 2) {
      return kids.flatMap((k) => (k === biggest ? rootsOf(k.folder, splits + 1) : [k]));
    }
    return kids;
  };
  const roots = rootsOf(0, 0);

  const order = new Int32Array(n);
  const rank = new Int32Array(n);
  const folderFrom = new Int32Array(f).fill(-1);
  const folderTo = new Int32Array(f).fill(-1);
  let at = 0;
  const place = (folder: number, filesOnly: boolean) => {
    const start = at;
    const subs = filesOnly ? [] : (subfolders[folder] ?? []);
    const own = filesIn[folder] ?? [];
    let s = 0;
    let o = 0;
    while (s < subs.length || o < own.length) {
      const sub = subs[s];
      const file = own[o];
      if (sub !== undefined && (file === undefined || (folderFirst[sub] as number) <= (born[file] as number))) {
        place(sub, false);
        s++;
      } else if (file !== undefined) {
        order[at] = file;
        rank[file] = at;
        at++;
        o++;
      }
    }
    if (!filesOnly) {
      folderFrom[folder] = start;
      folderTo[folder] = at;
    }
  };
  const islands: Island[] = [];
  for (const root of roots) {
    const from = at;
    place(root.folder, root.filesOnly);
    islands.push({ folder: root.folder, filesOnly: root.filesOnly, from, to: at, x: 0, z: 0, radius: 0 });
  }
  for (let d = f - 1; d >= 0; d--) {
    if ((folderFrom[d] as number) >= 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of subfolders[d] ?? []) {
      if ((folderFrom[s] as number) < 0) continue;
      lo = Math.min(lo, folderFrom[s] as number);
      hi = Math.max(hi, folderTo[s] as number);
    }
    for (const file of filesIn[d] ?? []) {
      lo = Math.min(lo, rank[file] as number);
      hi = Math.max(hi, (rank[file] as number) + 1);
    }
    if (lo < hi) {
      folderFrom[d] = lo;
      folderTo[d] = hi;
    }
  }

  const q = new Int32Array(n);
  const r = new Int32Array(n);
  const local = islands.map((isl) => {
    const cells = gosper(isl.to - isl.from);
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < cells.q.length; i++) {
      sx += hexX(cells.q[i] as number, cells.r[i] as number);
      sz += hexZ(cells.r[i] as number);
    }
    const count = Math.max(1, cells.q.length);
    const [oq, or] = hexAt(sx / count, sz / count);
    let radius = 0;
    for (let i = 0; i < cells.q.length; i++) {
      cells.q[i] = (cells.q[i] as number) - oq;
      cells.r[i] = (cells.r[i] as number) - or;
      radius = Math.max(radius, Math.hypot(hexX(cells.q[i] as number, cells.r[i] as number), hexZ(cells.r[i] as number)));
    }
    isl.radius = radius + 1;
    return cells;
  });
  const taken = new Set<number>();
  const fits = (cells: { q: Int32Array; r: Int32Array }, oq: number, or: number): boolean => {
    const len = cells.q.length;
    const stride = Math.max(1, Math.floor(len / 48));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = pass === 0 ? 0 : 0; i < len; i += pass === 0 ? stride : 1) {
        const cq = (cells.q[i] as number) + oq;
        const cr = (cells.r[i] as number) + or;
        if (taken.has(cellKey(cq, cr))) return false;
        for (const [dq, dr] of DIRECTIONS) if (taken.has(cellKey(cq + dq, cr + dr))) return false;
      }
    }
    return true;
  };
  const placed: { x: number; z: number; rad: number }[] = [];
  const bySize = islands.map((_, k) => k).sort((a, b) => (islands[b] as Island).to - (islands[b] as Island).from - ((islands[a] as Island).to - (islands[a] as Island).from) || a - b);
  for (const k of bySize) {
    const isl = islands[k] as Island;
    const cells = local[k] as { q: Int32Array; r: Int32Array };
    let spot: [number, number] | null = null;
    if (placed.length === 0) spot = [0, 0];
    else {
      const candidates: [number, number, number][] = [];
      for (const p of placed) {
        for (const f of [0.5, 0.65, 0.8, 0.95, 1.1]) {
          const d = (p.rad + isl.radius) * f + 2;
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const cx = p.x + Math.cos(ang) * d;
            const cz = p.z + Math.sin(ang) * d;
            candidates.push([cx, cz, Math.hypot(cx, cz * ASPECT)]);
          }
        }
      }
      candidates.sort((a, b) => a[2] - b[2]);
      const tried = new Set<number>();
      for (const [cx, cz] of candidates) {
        const [oq, or] = hexAt(cx, cz);
        const key = cellKey(oq, or);
        if (tried.has(key)) continue;
        tried.add(key);
        if (fits(cells, oq, or)) {
          spot = [oq, or];
          break;
        }
      }
      if (!spot) {
        const far = placed.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z) + p.rad), 0) + isl.radius + 4;
        for (let ring = 0; ring < 400 && !spot; ring++) {
          const [oq, or] = hexAt(far + ring * 2, 0);
          if (fits(cells, oq, or)) spot = [oq, or];
        }
      }
    }
    const [oq, or] = spot ?? [0, 0];
    for (let i = 0; i < cells.q.length; i++) {
      const cq = (cells.q[i] as number) + oq;
      const cr = (cells.r[i] as number) + or;
      taken.add(cellKey(cq, cr));
      for (const [dq, dr] of DIRECTIONS) taken.add(cellKey(cq + dq, cr + dr));
      const file = order[isl.from + i] as number;
      q[file] = cq;
      r[file] = cr;
    }
    isl.x = hexX(oq, or);
    isl.z = hexZ(or);
    placed.push({ x: isl.x, z: isl.z, rad: isl.radius });
  }

  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const px = hexX(q[i] as number, r[i] as number);
    const pz = hexZ(r[i] as number);
    x[i] = px;
    z[i] = pz;
    bounds.minX = Math.min(bounds.minX, px);
    bounds.maxX = Math.max(bounds.maxX, px);
    bounds.minZ = Math.min(bounds.minZ, pz);
    bounds.maxZ = Math.max(bounds.maxZ, pz);
  }
  if (n === 0) Object.assign(bounds, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 });

  const folderX = new Float32Array(f);
  const folderZ = new Float32Array(f);
  const folderRadius = new Float32Array(f);
  for (let d = 0; d < f; d++) {
    const lo = folderFrom[d] as number;
    const hi = folderTo[d] as number;
    if (lo < 0 || hi <= lo) continue;
    let sx = 0;
    let sz = 0;
    for (let i = lo; i < hi; i++) {
      sx += x[order[i] as number] as number;
      sz += z[order[i] as number] as number;
    }
    const cx = sx / (hi - lo);
    const cz = sz / (hi - lo);
    let best = Infinity;
    let rad = 0;
    let ax = cx;
    let az = cz;
    for (let i = lo; i < hi; i++) {
      const fx = x[order[i] as number] as number;
      const fz = z[order[i] as number] as number;
      const dd = (fx - cx) ** 2 + (fz - cz) ** 2;
      rad = Math.max(rad, dd);
      if (dd < best) {
        best = dd;
        ax = fx;
        az = fz;
      }
    }
    folderX[d] = ax;
    folderZ[d] = az;
    folderRadius[d] = Math.sqrt(rad) + 1;
  }

  const index = new Map<number, number>();
  for (let i = 0; i < n; i++) index.set(cellKey(q[i] as number, r[i] as number), i);
  const borders = new Uint16Array(n);
  const ancestorAt = (folder: number, level: number): number => {
    let d = folder;
    while ((depth[d] as number) > level) d = a.folders.parent[d] as number;
    return d;
  };
  for (let i = 0; i < n; i++) {
    const fi = a.files.folder[i] as number;
    let mask = 0;
    for (let k = 0; k < 6; k++) {
      const dir = DIRECTIONS[k] as readonly [number, number];
      const j = index.get(cellKey((q[i] as number) + dir[0], (r[i] as number) + dir[1]));
      if (j === undefined) continue;
      const fj = a.files.folder[j] as number;
      if (fi === fj) continue;
      let level = 1;
      const deepest = Math.max(depth[fi] as number, depth[fj] as number);
      for (let l = 1; l <= deepest; l++) {
        const ai = l <= (depth[fi] as number) ? ancestorAt(fi, l) : -1 - fi;
        const aj = l <= (depth[fj] as number) ? ancestorAt(fj, l) : -1 - fj;
        if (ai !== aj) {
          level = l;
          break;
        }
      }
      const strength = level <= 1 ? 3 : level === 2 ? 2 : 1;
      mask |= strength << (k * 2);
    }
    borders[i] = mask;
  }

  return { count: n, order, rank, q, r, x, z, borders, born, died, dated, depth, folderFrom, folderTo, folderX, folderZ, folderRadius, folderFirst, islands, bounds };
}
