import type { MapBlock } from "@commitscape/data";
import { squarify, type Rect } from "../charts/treemap";

export const WIDE = { w: 1200, h: 540 };
export const NARROW = { w: 400, h: 560 };
const HEADER = 24;

type Role = "leaf" | "head" | "bg";

export type Cell = Rect & { key: string; block: MapBlock; role: Role };

/** The blocks of a level as cells in a box: each folder with its own files and folders drawn inside it under a header, the rest as one cell each. */
export function cellsOf(children: MapBlock[], w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (const r of squarify(children, (b) => b.lines, { x: 0, y: 0, w, h })) {
    const b = r.item;
    if (!b.file && b.inside.length > 0 && r.w > 40 && r.h > HEADER + 14) {
      out.push({ key: `${b.path}:bg`, x: r.x, y: r.y, w: r.w, h: r.h, block: b, role: "bg" });
      out.push({ key: `${b.path}:head`, x: r.x, y: r.y, w: r.w, h: HEADER, block: b, role: "head" });
      for (const c of squarify(b.inside, (x) => x.lines, { x: r.x + 2, y: r.y + HEADER, w: r.w - 4, h: r.h - HEADER - 2 })) out.push({ key: c.item.path, x: c.x, y: c.y, w: c.w, h: c.h, block: c.item, role: "leaf" });
    } else out.push({ key: b.path, x: r.x, y: r.y, w: r.w, h: r.h, block: b, role: "leaf" });
  }
  return out;
}

/** Where a cell's centre is, as a share of the box. */
export function centre(cells: Cell[], path: string): { x: number; y: number } | null {
  let best: Cell | undefined;
  for (const c of cells) {
    if (c.role === "head") continue;
    const b = c.block;
    if (b.path === path || (!b.file && path.startsWith(b.path))) if (!best || b.path.length > best.block.path.length) best = c;
  }
  return best ? { x: best.x + best.w / 2, y: best.y + best.h / 2 } : null;
}

export type Dir = "up" | "down" | "left" | "right";

export function neighbour(cells: Cell[], from: Cell, dir: Dir): Cell | null {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: Cell | null = null;
  let score = Infinity;
  for (const c of cells) {
    if (c === from || c.role === "bg") continue;
    const dx = c.x + c.w / 2 - cx;
    const dy = c.y + c.h / 2 - cy;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    if (along <= 1) continue;
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const s = along + across * 2;
    if (s < score) {
      score = s;
      best = c;
    }
  }
  return best;
}


export type Scale = { bounds: number[]; step: (churn: number) => number; ranges: { step: number; low: number; high: number }[] };

/** The four steps of the log scale that colours a level by its commits when the most any block has is `most`: the step each count falls in, where each step ends, and the range of counts each one covers. */
export function activityScale(most: number): Scale {
  const top = Math.max(1, most);
  const step = (churn: number) => (churn <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((Math.log1p(churn) / Math.log1p(top)) * 4))));
  const bounds = [1, 2, 3, 4].map((s) => (s === 4 ? top : Math.floor(Math.expm1((Math.log1p(top) * s) / 4) + 1e-9)));
  const ranges: Scale["ranges"] = [];
  let low = 1;
  bounds.forEach((high, i) => {
    if (high < low) return;
    ranges.push({ step: i + 1, low, high });
    low = high + 1;
  });
  return { bounds, step, ranges };
}
