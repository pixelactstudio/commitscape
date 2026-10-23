import { cellKey, hexAt } from "@commitscape/data/universe";

export type Field = { data: Uint8Array; cols: number; rows: number; area: [number, number, number, number] };

/** How far each point of the sea is from land, sampled on a grid over the map and a margin around it: 0 on the coast, 255 at `reach` units out or more. */
export function distanceField(x: Float32Array, z: Float32Array, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, pad: number, reach: number): Field {
  const minX = bounds.minX - pad;
  const minZ = bounds.minZ - pad;
  const w = bounds.maxX - bounds.minX + pad * 2;
  const h = bounds.maxZ - bounds.minZ + pad * 2;
  const cell = Math.max(0.5, Math.max(w, h) / 1024);
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const d = new Float32Array(cols * rows).fill(1e9);
  const land = new Set<number>();
  for (let i = 0; i < x.length; i++) {
    const [q, r] = hexAt(x[i] as number, z[i] as number);
    land.add(cellKey(q, r));
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const [q, r] = hexAt(minX + (col + 0.5) * cell, minZ + (row + 0.5) * cell);
      if (land.has(cellKey(q, r))) d[row * cols + col] = 0;
    }
  }
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      let v = d[i] as number;
      if (col > 0) v = Math.min(v, (d[i - 1] as number) + a);
      if (row > 0) {
        v = Math.min(v, (d[i - cols] as number) + a);
        if (col > 0) v = Math.min(v, (d[i - cols - 1] as number) + b);
        if (col < cols - 1) v = Math.min(v, (d[i - cols + 1] as number) + b);
      }
      d[i] = v;
    }
  for (let row = rows - 1; row >= 0; row--)
    for (let col = cols - 1; col >= 0; col--) {
      const i = row * cols + col;
      let v = d[i] as number;
      if (col < cols - 1) v = Math.min(v, (d[i + 1] as number) + a);
      if (row < rows - 1) {
        v = Math.min(v, (d[i + cols] as number) + a);
        if (col < cols - 1) v = Math.min(v, (d[i + cols + 1] as number) + b);
        if (col > 0) v = Math.min(v, (d[i + cols - 1] as number) + b);
      }
      d[i] = v;
    }
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < d.length; i++) data[i] = Math.round(Math.min(1, (d[i] as number) / reach) * 255);
  return { data, cols, rows, area: [minX, minZ, cols * cell, rows * cell] };
}
