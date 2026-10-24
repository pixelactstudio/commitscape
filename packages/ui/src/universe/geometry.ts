import * as THREE from "three";
import { SQRT3 } from "@commitscape/data/universe";

export const BEVEL = 0.09;

/** A hex tower of circumradius 1, pointy end towards z: a flat top inset by the bevel, a bevelled rim, and six walls down to the floor. `aPart` is 2 on the top, 1 on the rim and the walls' upper edge, 0 at the floor; `aDrop` is how far below the top a vertex sits. */
export function hexPrism(): THREE.BufferGeometry {
  const pos: number[] = [];
  const normal: number[] = [];
  const part: number[] = [];
  const drop: number[] = [];
  const index: number[] = [];
  const corner = (i: number, r: number): [number, number] => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const add = (x: number, z: number, p: number, d: number, n: [number, number, number]) => {
    pos.push(x, p === 0 ? 0 : 1, z);
    normal.push(...n);
    part.push(p);
    drop.push(d);
    return pos.length / 3 - 1;
  };
  const inner = 1 - BEVEL;
  const up: [number, number, number] = [0, 1, 0];
  const centre = add(0, 0, 2, 0, up);
  const tops = Array.from({ length: 6 }, (_, i) => {
    const [x, z] = corner(i, inner);
    return add(x, z, 2, 0, up);
  });
  for (let i = 0; i < 6; i++) index.push(centre, tops[(i + 1) % 6] as number, tops[i] as number);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const mid = Math.PI / 6 + ((i + 0.5) * Math.PI) / 3;
    const out: [number, number] = [Math.cos(mid), Math.sin(mid)];
    const tilt = new THREE.Vector3(out[0], 1.15, out[1]).normalize();
    const rim: [number, number, number] = [tilt.x, tilt.y, tilt.z];
    const [ax, az] = corner(i, inner);
    const [bx, bz] = corner(j, inner);
    const [cx, cz] = corner(j, 1);
    const [dx, dz] = corner(i, 1);
    const a = add(ax, az, 2, 0, rim);
    const b = add(bx, bz, 2, 0, rim);
    const c = add(cx, cz, 1, BEVEL, rim);
    const d = add(dx, dz, 1, BEVEL, rim);
    index.push(a, b, c, a, c, d);
    const side: [number, number, number] = [out[0], 0, out[1]];
    const e = add(dx, dz, 1, BEVEL, side);
    const f = add(cx, cz, 1, BEVEL, side);
    const g = add(cx, cz, 0, 0, side);
    const h = add(dx, dz, 0, 0, side);
    index.push(e, f, g, e, g, h);
  }
  const fix: number[] = [];
  const v = (k: number) => new THREE.Vector3(pos[k * 3], part[k] === 0 ? 0 : 1 - (drop[k] as number), pos[k * 3 + 2]);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] as number, index[t + 1] as number, index[t + 2] as number];
    const n = new THREE.Vector3().subVectors(v(b), v(a)).cross(new THREE.Vector3().subVectors(v(c), v(a)));
    const want = new THREE.Vector3(normal[a * 3], normal[a * 3 + 1], normal[a * 3 + 2]);
    if (n.dot(want) < 0) fix.push(a, c, b);
    else fix.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  geometry.setAttribute("aDrop", new THREE.Float32BufferAttribute(drop, 1));
  geometry.setIndex(fix);
  return geometry;
}

/** A flat grid of `cols` by `rows` quads over an area of the ground, for the seabed to bend by the land around it. */
export function groundGrid(area: [number, number, number, number], cols: number, rows: number): THREE.BufferGeometry {
  const [x0, z0, w, h] = area;
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3);
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const i = (r * (cols + 1) + c) * 3;
      pos[i] = x0 + (c / cols) * w;
      pos[i + 2] = z0 + (r / rows) * h;
    }
  const index: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(index);
  return geometry;
}

/** One triangle that covers the whole screen. */
export function screenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return geometry;
}

export const SUPER_SCALE = Math.sqrt(7);
export const SUPER_TURN = Math.atan(SQRT3 / 5);
