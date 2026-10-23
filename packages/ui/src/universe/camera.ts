import * as THREE from "three";

export type Cam = { x: number; z: number; dist: number; az: number; el: number };

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const FOV = 32;
export const EL_MIN = (25 * Math.PI) / 180;
export const EL_MAX = (80 * Math.PI) / 180;
export const EL_TOP = (89 * Math.PI) / 180;
export const EL_REST = (52 * Math.PI) / 180;

const half = Math.tan(((FOV / 2) * Math.PI) / 180);

/** How far back the camera stands to see the whole map at a tilt, on a stage of the given aspect. */
export function fitDistance(b: Bounds, aspect: number, el: number): number {
  const w = (b.maxX - b.minX) / 2 + 3;
  const d = (b.maxZ - b.minZ) / 2 + 3;
  const across = w / (half * Math.max(0.4, aspect));
  const deep = (d * (Math.sin(el) + 0.25 * Math.cos(el))) / half;
  return Math.max(12, across, deep) * 1.04;
}

export type Insets = { top: number; right: number; bottom: number; left: number };

/** A camera moved so what was under one point of the stage is now `dx`, `dy` pixels away, as dragging does. */
export function panned(c: Cam, dx: number, dy: number, height: number): Cam {
  const unit = (2 * c.dist * half) / Math.max(1, height);
  const tilt = 1 / Math.max(0.35, Math.sin(c.el));
  return { ...c, x: c.x - Math.cos(c.az) * dx * unit - Math.sin(c.az) * dy * unit * tilt, z: c.z + Math.sin(c.az) * dx * unit - Math.cos(c.az) * dy * unit * tilt };
}

/** The camera at rest over the whole map, fitted inside the part of the stage the overlays leave free. */
export function restingCam(b: Bounds, width: number, height: number, top: boolean, inset: Insets): Cam {
  const el = top ? EL_TOP : EL_REST;
  const sw = Math.max(80, width - inset.left - inset.right);
  const sh = Math.max(80, height - inset.top - inset.bottom);
  const dist = fitDistance(b, sw / sh, el) * (height / sh);
  const turn = top && sh > sw * 1.1 && b.maxX - b.minX > (b.maxZ - b.minZ) * 1.1;
  const across = turn ? fitDistance({ minX: b.minZ, maxX: b.maxZ, minZ: b.minX, maxZ: b.maxX }, sw / sh, el) * (height / sh) : dist;
  const cam: Cam = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, dist: across, az: turn ? Math.PI / 2 : top ? 0 : 0.32, el };
  return panned(cam, (inset.left - inset.right) / 2, (inset.top - inset.bottom) / 2, height);
}

/** Keeps a camera within sane reach of the map: tilt between flat-ish and top-down, close enough to read a few files, never much farther than the whole map at rest (`far`, else twice the fit), never past its edges. */
export function clampCam(c: Cam, b: Bounds, aspect: number, top: boolean, far?: number): Cam {
  const fit = fitDistance(b, aspect, EL_REST);
  const pad = Math.max(8, 0.3 * Math.max(b.maxX - b.minX, b.maxZ - b.minZ));
  return {
    x: Math.max(b.minX - pad, Math.min(b.maxX + pad, c.x)),
    z: Math.max(b.minZ - pad, Math.min(b.maxZ + pad, c.z)),
    dist: Math.max(6, Math.min(far ?? fit * 2, c.dist)),
    az: c.az,
    el: top ? EL_TOP : Math.max(EL_MIN, Math.min(EL_MAX, c.el)),
  };
}

/** Puts a three.js camera where a Cam says. */
export function place(camera: THREE.PerspectiveCamera, c: Cam): void {
  const ce = Math.cos(c.el);
  camera.position.set(c.x + Math.sin(c.az) * ce * c.dist, Math.sin(c.el) * c.dist, c.z + Math.cos(c.az) * ce * c.dist);
  camera.up.set(0, 1, 0);
  if (c.el > 1.5) camera.up.set(-Math.sin(c.az), 0, -Math.cos(c.az));
  camera.lookAt(c.x, 0, c.z);
  camera.near = Math.max(0.5, c.dist * 0.02);
  camera.far = c.dist * 8 + 2000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function camText(c: Cam): string {
  const r = (v: number, k = 1) => Math.round(v * 10 ** k) / 10 ** k;
  return [r(c.x), r(c.z), r(c.dist), r(c.az, 2), r(c.el, 2)].join(",");
}

export function camOf(text: string | undefined): Cam | null {
  if (!text) return null;
  const v = text.split(",").map(Number);
  if (v.length !== 5 || v.some((n) => !Number.isFinite(n))) return null;
  const [x, z, dist, az, el] = v as [number, number, number, number, number];
  return { x, z, dist, az, el };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

/** Where a point of the stage lands on the ground plane. */
export function groundAt(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): THREE.Vector3 | null {
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  return ray.ray.intersectPlane(ground, hit) ? hit.clone() : null;
}

type Tween = { from: Cam; to: Cam; t: number; span: number };

export class MapCamera {
  cam: Cam;
  private tween: Tween | null = null;
  moved = false;
  changed = 0;

  private readonly bounds: () => Bounds;
  private readonly aspect: () => number;
  private readonly top: () => boolean;
  private readonly far: () => number | undefined;

  constructor(cam: Cam, bounds: () => Bounds, aspect: () => number, top: () => boolean, far: () => number | undefined = () => undefined) {
    this.cam = cam;
    this.bounds = bounds;
    this.aspect = aspect;
    this.top = top;
    this.far = far;
  }

  private clamp(c: Cam): Cam {
    return clampCam(c, this.bounds(), this.aspect(), this.top(), this.far());
  }

  set(c: Partial<Cam>): void {
    this.tween = null;
    this.cam = this.clamp({ ...this.cam, ...c });
    this.changed = performance.now();
  }

  retarget(to: Cam): void {
    const target = this.clamp(to);
    if (this.tween) this.tween.to = target;
    else this.cam = target;
    this.changed = performance.now();
  }

  fly(to: Partial<Cam>, seconds = 0.85): void {
    const target = this.clamp({ ...this.cam, ...to });
    if (seconds <= 0) {
      this.tween = null;
      this.cam = target;
    } else this.tween = { from: { ...this.cam }, to: target, t: 0, span: seconds };
    this.changed = performance.now();
  }

  get flying(): boolean {
    return this.tween !== null;
  }

  step(dt: number): boolean {
    const tw = this.tween;
    if (!tw) return false;
    tw.t = Math.min(1, tw.t + dt / tw.span);
    const k = ease(tw.t);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    let daz = tw.to.az - tw.from.az;
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    const lift = Math.sin(Math.PI * k) * 0.18 * Math.min(1, Math.hypot(tw.to.x - tw.from.x, tw.to.z - tw.from.z) / Math.max(1, tw.from.dist));
    this.cam = { x: lerp(tw.from.x, tw.to.x), z: lerp(tw.from.z, tw.to.z), dist: lerp(tw.from.dist, tw.to.dist) * (1 + lift), az: tw.from.az + daz * k, el: lerp(tw.from.el, tw.to.el) };
    if (tw.t >= 1) this.tween = null;
    this.changed = performance.now();
    return true;
  }

  pan(dx: number, dy: number, height: number): void {
    const next = panned(this.cam, dx, dy, height);
    this.set({ x: next.x, z: next.z });
  }

  orbit(dx: number, dy: number): void {
    if (this.top()) return;
    this.set({ az: this.cam.az - dx * 0.006, el: this.cam.el + dy * 0.005 });
  }

  zoom(factor: number, toward: THREE.Vector3 | null): void {
    const c = this.cam;
    const next = this.clamp({ ...c, dist: c.dist * factor });
    const k = 1 - next.dist / c.dist;
    if (toward) this.set({ dist: next.dist, x: c.x + (toward.x - c.x) * k, z: c.z + (toward.z - c.z) * k });
    else this.set({ dist: next.dist });
  }
}

/** Up to `most` of the map's cells, spread evenly through them, as x, z pairs to frame the camera by. */
export function sampleOf(x: ArrayLike<number>, z: ArrayLike<number>, most = 2400): Float32Array {
  const step = Math.max(1, Math.ceil(x.length / most));
  const out = new Float32Array(Math.ceil(x.length / step) * 2);
  for (let i = 0, k = 0; i < x.length; i += step, k += 2) {
    out[k] = x[i] as number;
    out[k + 1] = z[i] as number;
  }
  return out;
}

/** Refines a camera so the map's own cells, from the sea to `height`, fill the part of the stage the overlays leave free, centred in it. */
export function fitted(start: Cam, camera: THREE.PerspectiveCamera, cells: Float32Array, height: number, width: number, tall: number, inset: Insets): Cam {
  const probe = camera.clone();
  probe.aspect = width / Math.max(1, tall);
  const v = new THREE.Vector3();
  const sw = Math.max(80, width - inset.left - inset.right);
  const sh = Math.max(80, tall - inset.top - inset.bottom);
  const scx = inset.left + sw / 2;
  const scy = inset.top + sh / 2;
  let c = start;
  if (cells.length === 0) return c;
  for (let i = 0; i < 10; i++) {
    place(probe, c);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < cells.length; k += 2)
      for (const y of [0, height]) {
        v.set(cells[k] as number, y, cells[k + 1] as number).project(probe);
        const px = (v.x * 0.5 + 0.5) * width;
        const py = (-v.y * 0.5 + 0.5) * tall;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    const k = Math.max((x1 - x0 + 24) / sw, (y1 - y0 + 24) / sh);
    c = panned(c, scx - (x0 + x1) / 2, scy - (y0 + y1) / 2, tall);
    c = { ...c, dist: Math.max(6, c.dist * Math.max(0.6, Math.min(1.6, k))) };
  }
  return c;
}
