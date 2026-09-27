/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk): each item a
 * rectangle with area in proportion to its value, as close to square as
 * the rows allow.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function squarify<T>(items: T[], value: (t: T) => number, box: Rect): (Rect & { item: T })[] {
  const list = items
    .map((item) => ({ item, v: Math.max(0, value(item)) }))
    .filter((e) => e.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = list.reduce((n, e) => n + e.v, 0);
  const out: (Rect & { item: T })[] = [];
  if (total === 0 || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  let rest = { ...box };
  let i = 0;
  while (i < list.length) {
    const side = Math.min(rest.w, rest.h);
    const row: { item: T; a: number }[] = [];
    let worst = Infinity;
    while (i < list.length) {
      const next = list[i];
      if (!next) break;
      const candidate = [...row, { item: next.item, a: next.v * scale }];
      const w = worstRatio(candidate.map((r) => r.a), side);
      if (row.length > 0 && w > worst) break;
      row.push({ item: next.item, a: next.v * scale });
      worst = w;
      i++;
    }
    const sum = row.reduce((n, r) => n + r.a, 0);
    const thick = sum / side;
    let along = 0;
    for (const r of row) {
      const len = r.a / thick;
      if (rest.w >= rest.h) {
        out.push({ item: r.item, x: rest.x, y: rest.y + along, w: thick, h: len });
      } else {
        out.push({ item: r.item, x: rest.x + along, y: rest.y, w: len, h: thick });
      }
      along += len;
    }
    rest =
      rest.w >= rest.h
        ? { x: rest.x + thick, y: rest.y, w: rest.w - thick, h: rest.h }
        : { x: rest.x, y: rest.y + thick, w: rest.w, h: rest.h - thick };
  }
  return out;
}

function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}
