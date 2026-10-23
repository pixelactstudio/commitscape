import * as THREE from "three";
import { SQRT3 } from "@commitscape/data/universe";
import type { Field } from "./field";

/** A hex prism of circumradius 1 from y 0 to 1, pointy end towards z, with a flag on the top face's corners. */
export function hexPrism(): THREE.BufferGeometry {
  const pos: number[] = [];
  const top: number[] = [];
  const index: number[] = [];
  const corner = (i: number): [number, number] => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return [Math.cos(a), Math.sin(a)];
  };
  const add = (x: number, y: number, z: number, t: number) => {
    pos.push(x, y, z);
    top.push(t);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number, nx: number, ny: number, nz: number) => {
    const p = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const n = new THREE.Vector3().subVectors(p(b), p(a)).cross(new THREE.Vector3().subVectors(p(c), p(a)));
    if (n.dot(new THREE.Vector3(nx, ny, nz)) < 0) index.push(a, c, b);
    else index.push(a, b, c);
  };
  const ring = Array.from({ length: 6 }, (_, i) => corner(i));
  const tops = ring.map(([x, z]) => add(x, 1, z, 1));
  for (let i = 1; i < 5; i++) tri(tops[0] as number, tops[i] as number, tops[i + 1] as number, 0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const [ax, az] = ring[i] as [number, number];
    const [bx, bz] = ring[(i + 1) % 6] as [number, number];
    const a = add(ax, 1, az, 0);
    const b = add(bx, 1, bz, 0);
    const c = add(bx, 0, bz, 0);
    const d = add(ax, 0, az, 0);
    const nx = (ax + bx) / 2;
    const nz = (az + bz) / 2;
    tri(a, b, c, nx, 0, nz);
    tri(a, c, d, nx, 0, nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aTop", new THREE.Float32BufferAttribute(top, 1));
  g.setIndex(index);
  return g;
}

/** A strip of quads along x from 0 to 1, y from -1 to 1, for drawing a beam. */
export function beamStrip(segments = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) pos.push(i / segments, -1, 0, i / segments, 1, 0);
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** A square from -1 to 1 lying on the ground. */
export function groundQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/** A distance field as a texture the sea shader reads. */
export function fieldTexture(f: Field): THREE.DataTexture {
  const texture = new THREE.DataTexture(f.data, f.cols, f.rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export const SUPER_SCALE = Math.sqrt(7);
export const SUPER_TURN = Math.atan(SQRT3 / 5);
