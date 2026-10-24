import * as THREE from "three";
import { cellKey, COLOUR, DIRECTIONS, hexAt, WEEK_SECONDS, type Beacon } from "@commitscape/data/universe";
import { avatarUrl } from "../components/avatar";
import { clampCam, EL_REST, fitDistance, fitted, FOV, groundAt, MapCamera, place, restingCam, sampleOf, type Cam, type Insets } from "./camera";
import { groundGrid, hexPrism, SUPER_SCALE, SUPER_TURN } from "./geometry";
import type { Look, Rgb } from "./look";
import { LOWER, Pipeline, type Detail, type ShadowUniforms, type Variant } from "./pipeline";
import type { FrameAnswer, Region, Summary } from "./protocol";
import { HEX_FRAGMENT, HEX_VERTEX, SEABED_FRAGMENT, SEABED_VERTEX } from "./shaders";

export type StageClock = { at: number; playing: boolean; speed: number; intro: boolean };

export type StageApi = { fly: (x: number, z: number, radius: number) => void; home: () => void; zoom: (factor: number) => void; turn: (by: number) => void; tilt: (by: number) => void; pan: (dx: number, dy: number) => void; wake: () => void; intro: (seconds: number) => void; cam: () => Cam };

export type View = { lens: number; focus: [number, number] | null; roleMask: number; selected: number | null; solo: boolean; soloSlot: number | null; top: boolean; reduced: boolean; insets: Insets };

export type Caption = { key: number; text: string; detail: string; until: number };

export type Target = { kind: "file"; rank: number } | { kind: "folder"; folder: number };

export type Hooks = {
  onHover: (target: Target | null, x: number, y: number) => void;
  onPick: (target: Target | null, double: boolean) => void;
  onFolder: (folder: number) => void;
  onPerson: (person: number) => void;
  onCam: (cam: Cam) => void;
  onCaption: (c: Caption) => void;
  onSlow: (next: Detail) => void;
  avatars: (person: number) => { name: string; login: string | null };
};

export type Layers = { labels: HTMLDivElement; beacons: HTMLDivElement; pin: HTMLDivElement };

const CHUNK = 4096;
const SUPER_VISIBLE = 60_000;
const BEACON_HEIGHT = 9;
const BEACONS = 8;
const SUN = new THREE.Vector3(-0.78, 0.6, 0.18).normalize();
const DEEP = 8;
const SWEEP_SECONDS = 1.7;
const VARIANTS: Variant[] = ["main", "reflect", "depth", "mask", "pick"];

const colourOf = (c: Rgb) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

/** How tall land stands for a map of this many hexes, so a big map still shows relief from afar. */
export function heightScaleOf(count: number): number {
  return Math.max(1, Math.min(3.2, Math.sqrt(count) / 45));
}

function instanced(base: THREE.BufferGeometry, count: number, attrs: Record<string, [Float32Array, number, boolean]>): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
  for (const [name, [array, size, dynamic]] of Object.entries(attrs)) {
    const a = new THREE.InstancedBufferAttribute(array, size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = count;
  return g;
}

const attr = (g: THREE.BufferGeometry, name: string) => g.getAttribute(name) as THREE.InstancedBufferAttribute;

const styled = new WeakMap<HTMLElement, { t: string; v: string }>();

function show(el: HTMLElement, visible: boolean, transform?: string): void {
  const was = styled.get(el) ?? { t: "", v: "" };
  const v = visible ? "visible" : "hidden";
  if (was.v !== v) el.style.visibility = v;
  if (transform !== undefined && was.t !== transform) el.style.transform = transform;
  styled.set(el, { t: transform ?? was.t, v });
}

const same = (a: Target | null, b: Target | null) => (a === null || b === null ? a === b : a.kind === b.kind && (a.kind === "file" ? a.rank === (b as { rank: number }).rank : a.folder === (b as { folder: number }).folder));

type BeaconState = { x: number; z: number; tx: number; tz: number; vx: number; vz: number; b: Beacon };

type Variants = Record<Variant, THREE.ShaderMaterial>;

export class AtlasRenderer {
  readonly api: StageApi;
  private readonly gl: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly summary: Summary;
  private readonly layers: Layers;
  private hooks: Hooks;
  private readonly clock: { current: StageClock };
  private readonly wake: () => void;
  private view: View;
  private look: Look | null = null;
  private width = 1;
  private height = 1;
  private readonly control: MapCamera;
  private readonly scale: number;
  private readonly uniforms: Record<string, { value: unknown }>;
  private readonly shared: Record<string, { value: unknown }>;
  private readonly shadow: ShadowUniforms;
  private readonly seabedUniforms: Record<string, { value: unknown }>;
  private readonly waterUniforms: Record<string, { value: unknown }>;
  private readonly supers: THREE.InstancedBufferGeometry | null;
  private readonly chunks: { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; count: number; sphere: THREE.Sphere; from: number }[] = [];
  private readonly hexGroup = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly nowArray: Float32Array;
  private readonly wasArray: Float32Array;
  private readonly edgeArray: Float32Array;
  private readonly superMesh: THREE.Mesh | null;
  private readonly floor: THREE.Mesh[];
  private readonly poles: THREE.LineSegments;
  private readonly world = new THREE.Scene();
  private readonly overlay = new THREE.Scene();
  private readonly pipeline: Pipeline;
  private readonly pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly materials: THREE.Material[] = [];
  private readonly mains: THREE.ShaderMaterial[] = [];
  private readonly variants = new Map<THREE.Mesh, Variants>();
  private blendStart = -10;
  private flashUntil = 0;
  private lastFrame: FrameAnswer | null = null;
  private readonly beacons = new Map<number, BeaconState>();
  private readonly beaconEls = new Map<number, HTMLButtonElement>();
  private labels: { region: Region; el: HTMLButtonElement }[] = [];
  private covers: { at: number; rects: [number, number, number, number][] } = { at: -1, rects: [] };
  private readonly pointer = { x: 0, y: 0, dirty: false, inside: false };
  private hovered: Target | null = null;
  private region: [number, number] | null = null;
  private regionMix = 0;
  private neighbours: Int32Array | null = null;
  private lastPick = 0;
  private captionKey = 0;
  private sweep = { start: -100, dx: 1, dz: 0, min: 0, max: 0 };
  private readonly projected = new THREE.Vector3();
  private beaconBoxes: [number, number, number, number][] = [];
  private readonly pixel = new Uint8Array(4);
  private readonly unlisten: () => void;
  private compiled = false;
  private gone = false;
  private readonly cells: Float32Array;
  private resting: boolean;
  private restDist = 0;
  private dirty = true;
  private readonly lastView = new THREE.Matrix4();
  private readonly lastProjection = new THREE.Matrix4();
  private lastDraw = 0;
  private auto: boolean;
  private slowSince = 0;
  private readonly slow: number[] = [];

  constructor(o: { gl: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; summary: Summary; layers: Layers; hooks: Hooks; clock: { current: StageClock }; view: View; width: number; height: number; initial: Cam | null; wake: () => void; detail: Detail; auto: boolean }) {
    this.gl = o.gl;
    this.camera = o.camera;
    this.summary = o.summary;
    this.layers = o.layers;
    this.hooks = o.hooks;
    this.clock = o.clock;
    this.view = o.view;
    this.wake = o.wake;
    this.width = o.width;
    this.height = o.height;
    this.auto = o.auto;
    this.scale = heightScaleOf(o.summary.count);
    this.cells = sampleOf(o.summary.x, o.summary.z);
    this.resting = o.initial === null;
    const s = o.summary;
    const n = s.count;

    const cell = new Float32Array(n * 4);
    const info = new Float32Array(n * 4);
    const now = new Float32Array(n * 3);
    const was = new Float32Array(n * 2);
    const edge = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      cell.set([s.x[i] as number, s.z[i] as number, s.born[i] as number, s.died[i] as number], i * 4);
      info.set([s.borders[i] as number, s.role[i] as number, s.language[i] as number, i], i * 4);
      now[i * 3 + 1] = COLOUR.nobody;
      now[i * 3 + 2] = -1e6;
      was[i * 2 + 1] = COLOUR.nobody;
    }
    this.nowArray = now;
    this.wasArray = was;
    this.edgeArray = edge;
    const prism = hexPrism();
    if (s.supers) {
      const k = s.supers.x.length;
      const sc = new Float32Array(k * 4);
      const si = new Float32Array(k * 4);
      for (let i = 0; i < k; i++) {
        const lo = s.supers.start[i] as number;
        const hi = s.supers.start[i + 1] as number;
        let born = Infinity;
        let died = -Infinity;
        for (let r = lo; r < hi; r++) {
          born = Math.min(born, s.born[r] as number);
          died = Math.max(died, s.died[r] as number);
        }
        sc.set([s.supers.x[i] as number, s.supers.z[i] as number, born, died], i * 4);
        si.set([0, s.role[lo] as number, s.language[lo] as number, lo], i * 4);
      }
      this.supers = instanced(prism, k, { iCell: [sc, 4, false], iInfo: [si, 4, false], iNow: [new Float32Array(k * 3), 3, true], iWas: [new Float32Array(k * 2), 2, true], iEdge: [new Float32Array(k), 1, false] });
    } else this.supers = null;

    this.shadow = { uShadowMap: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowTexel: { value: 1 / 2048 }, uShadowBias: { value: 0.0002 } };
    this.shared = {
      uSkyTop: { value: new THREE.Color() },
      uSkyHorizon: { value: new THREE.Color() },
      uSunDir: { value: SUN.clone() },
      uSun: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSkyLight: { value: new THREE.Color() },
      uAbsorb: { value: new THREE.Vector3(0.5, 0.15, 0.1) },
      uNight: { value: 0 },
      ...this.shadow,
    };
    const u: Record<string, { value: unknown }> = {
      ...this.shared,
      uNow: { value: 0 },
      uRise: { value: 0 },
      uBlend: { value: 1 },
      uHeightScale: { value: this.scale },
      uFlat: { value: 0 },
      uCellScale: { value: 0.955 },
      uRotate: { value: 0 },
      uLens: { value: 0 },
      uSlots: { value: Array.from({ length: 11 }, () => new THREE.Color()) },
      uRoles: { value: Array.from({ length: 5 }, () => new THREE.Color()) },
      uLangs: { value: Array.from({ length: 10 }, () => new THREE.Color()) },
      uStale: { value: Array.from({ length: 4 }, () => new THREE.Color()) },
      uSnow: { value: new THREE.Color() },
      uRuin: { value: new THREE.Color() },
      uDim: { value: new THREE.Color() },
      uFrost: { value: 1 },
      uFocus: { value: new THREE.Vector2(-1, -1) },
      uRegion: { value: new THREE.Vector2(-1, -1) },
      uRegionMix: { value: 0 },
      uRoleMask: { value: 31 },
      uSolo: { value: 0 },
      uHover: { value: -10 },
      uSelected: { value: -10 },
      uFlashSpan: { value: 1 },
      uFlashGain: { value: 0 },
      uBottom: { value: -DEEP - 0.5 },
      uBorder: { value: new THREE.Vector4() },
      uGlow: { value: new THREE.Color() },
      uMarkColour: { value: new THREE.Color() },
      uOutline: { value: new THREE.Color() },
      uRelease: { value: new THREE.Color() },
      uBeacons: { value: Array.from({ length: BEACONS }, () => new THREE.Vector4()) },
      uBeaconColours: { value: Array.from({ length: BEACONS }, () => new THREE.Color()) },
      uBeaconCount: { value: 0 },
      uSweep: { value: new THREE.Vector4() },
    };
    this.uniforms = u;
    const superU = { ...u, uCellScale: { value: SUPER_SCALE * 0.96 }, uRotate: { value: SUPER_TURN }, uHover: { value: -10 }, uSelected: { value: -10 } };
    const variantsOf = (uniforms: Record<string, { value: unknown }>): Variants => {
      const make = (defines: Record<string, number>, side: THREE.Side = THREE.FrontSide) => {
        const m = new THREE.ShaderMaterial({ vertexShader: HEX_VERTEX, fragmentShader: HEX_FRAGMENT, uniforms, defines, side });
        this.materials.push(m);
        return m;
      };
      const main = make({});
      this.mains.push(main);
      return { main, reflect: make({ REFLECT: 1 }, THREE.BackSide), depth: make({ DEPTH: 1 }, THREE.BackSide), mask: make({ MASK: 1 }), pick: make({ PICK: 1 }) };
    };
    const hexVariants = variantsOf(u);
    const top = this.scale * 6;
    for (let from = 0; from < n; from += CHUNK) {
      const to = Math.min(n, from + CHUNK);
      const geometry = instanced(prism, to - from, { iCell: [cell.subarray(from * 4, to * 4), 4, false], iInfo: [info.subarray(from * 4, to * 4), 4, false], iNow: [now.subarray(from * 3, to * 3), 3, true], iWas: [was.subarray(from * 2, to * 2), 2, true], iEdge: [edge.subarray(from, to), 1, true] });
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = from; i < to; i++) {
        minX = Math.min(minX, s.x[i] as number);
        maxX = Math.max(maxX, s.x[i] as number);
        minZ = Math.min(minZ, s.z[i] as number);
        maxZ = Math.max(maxZ, s.z[i] as number);
      }
      const sphere = new THREE.Sphere(new THREE.Vector3((minX + maxX) / 2, top / 2 - DEEP / 2, (minZ + maxZ) / 2), Math.hypot(maxX - minX + 2, maxZ - minZ + 2, top + DEEP) / 2);
      geometry.boundingSphere = sphere;
      const mesh = new THREE.Mesh(geometry, hexVariants.main);
      this.variants.set(mesh, hexVariants);
      this.hexGroup.add(mesh);
      this.chunks.push({ mesh, geometry, count: to - from, sphere, from });
    }
    if (this.supers) {
      this.superMesh = new THREE.Mesh(this.supers, undefined);
      const sv = variantsOf(superU);
      this.superMesh.material = sv.main;
      this.variants.set(this.superMesh, sv);
      this.superMesh.frustumCulled = false;
      this.superMesh.visible = false;
    } else this.superMesh = null;

    const b = s.bounds;
    const area = s.area;
    this.seabedUniforms = { ...this.shared, tLand: { value: null }, uArea: { value: new THREE.Vector4(...area) }, uDeep: { value: DEEP }, uSand: { value: new THREE.Color() }, uSeabed: { value: new THREE.Color() } };
    const seabed = (far: boolean) => {
      const m = new THREE.ShaderMaterial({ vertexShader: SEABED_VERTEX, fragmentShader: SEABED_FRAGMENT, uniforms: this.seabedUniforms, defines: far ? { FAR: 1 } : {} });
      this.materials.push(m);
      this.mains.push(m);
      return m;
    };
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const grid = new THREE.Mesh(groundGrid(area, 192, Math.max(16, Math.round((192 * area[3]) / Math.max(1, area[2])))), seabed(false));
    grid.frustumCulled = false;
    const outer = span * 12 + 4000;
    const far = new THREE.Mesh(groundGrid([area[0] + area[2] / 2 - outer / 2, area[1] + area[3] / 2 - outer / 2, outer, outer], 1, 1), seabed(true));
    far.frustumCulled = false;
    far.renderOrder = -1;
    this.floor = [grid, far];

    const poleGeometry = new THREE.BufferGeometry();
    poleGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEACONS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    poleGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(BEACONS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    poleGeometry.setDrawRange(0, 0);
    const poleMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
    this.materials.push(poleMaterial);
    this.poles = new THREE.LineSegments(poleGeometry, poleMaterial);
    this.poles.frustumCulled = false;

    for (const obj of [this.hexGroup, this.superMesh, grid, far]) if (obj) this.world.add(obj);
    this.overlay.add(this.poles);

    this.waterUniforms = {
      ...this.shared,
      uArea: { value: new THREE.Vector4(...area) },
      uTime: { value: 0 },
      uScatter: { value: new THREE.Color() },
      uFoam: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uFogNear: { value: 1000 },
      uFogFar: { value: 3000 },
      uCaustics: { value: 1 },
      uWaves: { value: 1 },
    };
    this.pipeline = new Pipeline({ gl: o.gl, camera: o.camera, scenes: { world: this.world, overlay: this.overlay, floor: this.floor, variant: (v) => this.variant(v) }, area, detail: o.detail, water: this.waterUniforms, shadow: this.shadow });
    this.seabedUniforms.tLand!.value = this.pipeline.landTexture;
    this.applyShadows();

    const start = o.initial ? clampCam(o.initial, b, this.aspect, this.view.top) : this.rest();
    this.control = new MapCamera(start, () => b, () => this.aspect, () => this.view.top, () => (this.restDist > 0 ? Math.max(this.restDist * 1.6, fitDistance(b, this.aspect, EL_REST) * 1.2) : undefined));
    this.buildLabels();
    this.unlisten = this.listen();
    place(this.camera, this.control.cam);
    void this.compile().then(() => {
      if (this.gone) return;
      this.compiled = true;
      this.wake();
    });
    this.setView(o.view);
    this.api = {
      fly: (x, z, radius) => {
        this.resting = false;
        const fit = fitDistance(b, this.aspect, EL_REST);
        const dist = Math.max(Math.min(45, fit * 0.6), Math.min(fit, (radius * 2.4) / Math.tan(((FOV / 2) * Math.PI) / 180) / 1.8));
        this.control.fly({ x, z: z + 1, dist }, this.view.reduced ? 0 : 0.85);
        this.wake();
      },
      home: () => {
        this.resting = true;
        this.control.fly(this.rest(), this.view.reduced ? 0 : 0.85);
        this.wake();
      },
      zoom: (factor) => {
        this.resting = false;
        this.control.zoom(factor, null);
        this.wake();
      },
      turn: (by) => {
        this.resting = false;
        this.control.set({ az: this.control.cam.az + by });
        this.wake();
      },
      tilt: (by) => {
        this.resting = false;
        this.control.set({ el: this.control.cam.el + by });
        this.wake();
      },
      pan: (dx, dy) => {
        this.resting = false;
        this.control.pan(dx, dy, this.height);
        this.wake();
      },
      wake: () => this.wake(),
      intro: (seconds) => {
        this.resting = true;
        const at = this.rest();
        this.control.fly({ ...at, el: 1.36, dist: at.dist * 1.5, az: at.az - 0.95 }, 0);
        this.control.fly(at, seconds);
        this.wake();
      },
      cam: () => this.control.cam,
    };
  }

  private async compile(): Promise<void> {
    for (const v of VARIANTS) {
      this.variant(v);
      await this.gl.compileAsync(this.world, this.camera).catch(() => undefined);
      if (this.gone) return;
    }
    this.variant("main");
  }

  private variant(v: Variant): void {
    for (const [mesh, set] of this.variants) mesh.material = set[v];
  }

  private applyShadows(): void {
    const on = this.pipeline.shadows;
    for (const m of this.mains) {
      const has = "SHADOWS" in m.defines;
      if (has === on) continue;
      if (on) m.defines.SHADOWS = 1;
      else delete m.defines.SHADOWS;
      m.needsUpdate = true;
    }
    const w = this.pipeline.water;
    if ("SHADOWS" in w.defines !== on) {
      if (on) w.defines.SHADOWS = 1;
      else delete w.defines.SHADOWS;
      w.needsUpdate = true;
    }
  }

  /** Changes how much each frame draws; `auto` lets the renderer step down by itself when frames come too slowly. */
  setDetail(d: Detail, auto: boolean): void {
    this.auto = auto;
    this.slow.length = 0;
    this.slowSince = performance.now() / 1000;
    this.pipeline.setDetail(d);
    this.applyShadows();
    this.dirty = true;
    this.wake();
  }

  private get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  private rest(): Cam {
    const c = fitted(restingCam(this.summary.bounds, this.width, this.height, this.view.top, this.view.insets), this.camera, this.cells, this.scale * 1.6, this.width, this.height, this.view.insets);
    this.restDist = c.dist;
    return c;
  }

  private refit(): void {
    if (!this.control || !this.resting) return;
    this.control.retarget(this.rest());
  }

  setHooks(h: Hooks): void {
    this.hooks = h;
  }

  setSize(width: number, height: number): void {
    const changed = Math.abs(this.width - width) > 0.5 || Math.abs(this.height - height) > 0.5;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pipeline.setSize(this.width, this.height);
    if (changed) this.refit();
    this.dirty = true;
    this.wake();
  }

  setView(v: View): void {
    const was = this.view;
    this.view = v;
    const u = this.uniforms;
    u.uLens!.value = v.lens;
    u.uFrost!.value = v.lens === 0 ? 1 : 0;
    (u.uFocus!.value as THREE.Vector2).set(v.focus ? v.focus[0] : -1, v.focus ? v.focus[1] : -1);
    u.uRoleMask!.value = v.roleMask;
    u.uSolo!.value = v.solo ? 1 : 0;
    u.uSelected!.value = v.selected ?? -10;
    u.uFlat!.value = v.top ? 0.7 : 0;
    if (this.look && was.soloSlot !== v.soloSlot) this.setLook(this.look);
    const moved = was.insets.top !== v.insets.top || was.insets.bottom !== v.insets.bottom || was.insets.left !== v.insets.left || was.insets.right !== v.insets.right;
    if (this.control && was.top !== v.top) this.control.fly(this.rest(), 0);
    else if (moved) this.refit();
    if (was.focus?.[0] !== v.focus?.[0] || was.focus?.[1] !== v.focus?.[1]) this.pointer.dirty = true;
    this.dirty = true;
    this.wake();
  }

  setLook(look: Look): void {
    this.look = look;
    const u = this.uniforms;
    const night = look.night;
    const slots = [...look.slots, look.other, look.sand, look.slots[this.view.soloSlot ?? 0] ?? look.other];
    const set = (name: string, list: Rgb[]) => list.forEach((c, i) => (u[name]!.value as THREE.Color[])[i]?.copy(colourOf(c)));
    const colour = (target: { value: unknown }, c: Rgb, k = 1) => (target.value as THREE.Color).copy(colourOf(c)).multiplyScalar(k);
    set("uSlots", slots);
    set("uRoles", look.roles);
    set("uLangs", look.languages);
    set("uStale", look.stale);
    const sh = this.shared;
    colour(sh.uSkyTop!, look.sky);
    colour(sh.uSkyHorizon!, look.fog);
    colour(sh.uSun!, look.sun, night ? 1.15 : 1.08);
    colour(sh.uSkyLight!, look.skyLight, night ? 0.75 : 0.46);
    colour(sh.uGround!, look.ground, night ? 0.22 : 0.2);
    (sh.uAbsorb!.value as THREE.Vector3).set(...look.absorb);
    sh.uNight!.value = night ? 1 : 0;
    colour(u.uSnow!, look.snow);
    colour(u.uRuin!, look.ruin);
    colour(u.uDim!, look.dim);
    const border = colourOf(look.border);
    (u.uBorder!.value as THREE.Vector4).set(border.r, border.g, border.b, night ? 0.4 : 0.42);
    colour(u.uGlow!, look.glow);
    colour(u.uMarkColour!, night ? [1, 1, 1] : [0.08, 0.09, 0.12]);
    colour(u.uOutline!, look.outline);
    colour(u.uRelease!, look.release);
    colour(this.seabedUniforms.uSand!, look.floor);
    colour(this.seabedUniforms.uSeabed!, look.seabed);
    const w = this.waterUniforms;
    colour(w.uScatter!, look.scatter);
    colour(w.uFoam!, look.foam);
    colour(w.uFog!, look.fog);
    w.uCaustics!.value = night ? 0.55 : 1;
    for (const [p, el] of this.beaconEls) {
      const s = this.beacons.get(p);
      if (s) el.style.borderColor = look.css.slots[s.b.slot] ?? "var(--line)";
    }
    this.dirty = true;
    this.wake();
  }

  private buildLabels(): void {
    const layer = this.layers.labels;
    layer.replaceChildren();
    const regions = [...this.summary.regions].sort((a, b) => Number(b.island) - Number(a.island) || b.files - a.files);
    this.labels = regions.map((region) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pointer-events-auto absolute top-0 left-0 max-w-48 cursor-pointer truncate rounded-full border-0 whitespace-nowrap will-change-transform ${region.island ? "bg-surface/85 px-2.5 py-0.5 type-label text-primary shadow-(--shadow-sm) backdrop-blur-sm" : "bg-surface/60 px-2 py-px type-caption text-primary backdrop-blur-sm"}`;
      el.textContent = region.name;
      el.title = `${region.path}/ · ${region.files.toLocaleString("en-US")} files ever`;
      el.setAttribute("aria-label", `${region.path || region.name}: ${region.files.toLocaleString("en-US")} files ever. Fly there.`);
      el.style.visibility = "hidden";
      el.tabIndex = region.island ? 0 : -1;
      el.addEventListener("click", () => this.hooks.onFolder(region.folder));
      el.addEventListener("focus", () => {
        show(el, true);
        this.wake();
      });
      layer.appendChild(el);
      return { region, el };
    });
  }

  private listen(): () => void {
    const el = this.gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "pan" | "orbit" = "pan";
    let travelled = 0;
    let pinch = 0;
    let angle = 0;
    let lastClick = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      travelled = 0;
      mode = e.button === 2 || e.ctrlKey || e.altKey ? "orbit" : "pan";
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        angle = Math.atan2(b.y - a.y, b.x - a.x);
      }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.dirty = true;
      this.pointer.inside = true;
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        this.wake();
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > 3) this.resting = false;
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (pinch > 0) this.control.zoom(pinch / Math.max(1, gap), null);
        this.control.set({ az: this.control.cam.az - (ang - angle) });
        pinch = gap;
        angle = ang;
        this.control.pan(dx / 2, dy / 2, p.h);
      } else if (mode === "orbit") this.control.orbit(dx, dy);
      else this.control.pan(dx, dy, p.h);
      this.wake();
    };
    const up = (e: PointerEvent) => {
      const was = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (was && travelled < 5 && e.button === 0) {
        const now = performance.now();
        const double = now - lastClick < 320;
        lastClick = now;
        this.hooks.onPick(this.hovered, double);
      }
      if (pointers.size === 0) this.hooks.onCam(this.control.cam);
    };
    const leave = () => {
      this.pointer.inside = false;
      if (this.hovered !== null) {
        this.setHovered(null);
        this.hooks.onHover(null, 0, 0);
        this.wake();
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.resting = false;
      const p = local(e);
      const at = groundAt(this.camera, (p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      this.control.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), at);
      this.pointer.dirty = true;
      this.wake();
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => this.hooks.onCam(this.control.cam), 400);
    };
    const menu = (e: Event) => e.preventDefault();
    const lost = (e: Event) => e.preventDefault();
    const on: [string, EventListener, AddEventListenerOptions?][] = [
      ["pointerdown", down as EventListener],
      ["pointermove", move as EventListener],
      ["pointerup", up as EventListener],
      ["pointercancel", up as EventListener],
      ["pointerleave", leave],
      ["wheel", wheel as EventListener, { passive: false }],
      ["contextmenu", menu],
      ["webglcontextlost", lost],
    ];
    for (const [name, fn, opts] of on) el.addEventListener(name, fn, opts);
    return () => {
      for (const [name, fn] of on) el.removeEventListener(name, fn);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }

  applyFrame(f: FrameAnswer | null): void {
    if (!f || f === this.lastFrame) return;
    const s = this.summary;
    const prev = this.lastFrame;
    this.lastFrame = f;
    const n = s.count;
    const now = this.nowArray;
    const was = this.wasArray;
    for (let i = 0; i < n; i++) {
      was[i * 2] = prev ? (now[i * 3] as number) : (f.height[i] as number);
      was[i * 2 + 1] = prev ? (now[i * 3 + 1] as number) : (f.colour[i] as number);
      now[i * 3] = f.height[i] as number;
      now[i * 3 + 1] = f.colour[i] as number;
      now[i * 3 + 2] = f.touched[i] as number;
    }
    for (const c of this.chunks) {
      attr(c.geometry, "iNow").needsUpdate = true;
      attr(c.geometry, "iWas").needsUpdate = true;
    }
    if (this.supers && s.supers) this.applySupers(f, !prev);
    this.blendStart = performance.now() / 1000;
    const nowW = (f.at - s.origin) / WEEK_SECONDS;
    for (const { region, el } of this.labels) {
      let born = false;
      let alive = false;
      for (let r = region.from; r < region.to && !alive; r++) {
        if ((s.born[r] as number) <= nowW) {
          born = true;
          if (nowW < (s.died[r] as number)) alive = true;
        }
      }
      el.dataset.state = alive ? "" : born ? "sunk" : "unborn";
      el.style.opacity = alive ? "" : "0.72";
    }
    if (this.region) this.outline(this.region, this.region, nowW);
    const clock = this.clock.current;
    const wall = performance.now() / 1000;
    this.updateBeacons(f.beacons);
    if (clock.playing && prev && !this.view.reduced && wall > this.sweep.start + SWEEP_SECONDS * 0.8) {
      const rel = s.releases;
      let last = -1;
      for (let i = 0; i < rel.time.length; i++) {
        const t = rel.time[i] as number;
        if (t > prev.at && t <= f.at) last = i;
      }
      if (last >= 0) {
        this.startSweep(wall);
        this.hooks.onCaption({ key: ++this.captionKey, text: rel.names[last] ?? "", detail: "released", until: wall + 2.4 });
      }
    }
    if (clock.playing) this.flashUntil = wall + 0.8;
    this.dirty = true;
    this.wake();
  }

  private startSweep(wall: number): void {
    const az = this.control.cam.az;
    const dx = Math.cos(az);
    const dz = -Math.sin(az);
    const b = this.summary.bounds;
    const ps = [b.minX * dx + b.minZ * dz, b.maxX * dx + b.minZ * dz, b.minX * dx + b.maxZ * dz, b.maxX * dx + b.maxZ * dz];
    this.sweep = { start: wall, dx, dz, min: Math.min(...ps), max: Math.max(...ps) };
  }

  private applySupers(f: FrameAnswer, first: boolean): void {
    const s = this.summary.supers;
    const g = this.supers;
    if (!s || !g) return;
    const k = s.x.length;
    const sn = attr(g, "iNow").array as Float32Array;
    const sw = attr(g, "iWas").array as Float32Array;
    const tally = new Float32Array(12);
    for (let i = 0; i < k; i++) {
      let h = 0;
      let t = -1e6;
      tally.fill(0);
      for (let r = s.start[i] as number; r < (s.start[i + 1] as number); r++) {
        h = Math.max(h, f.height[r] as number);
        t = Math.max(t, f.touched[r] as number);
        const c = f.colour[r] as number;
        tally[c] = (tally[c] as number) + (c === COLOUR.nobody ? 0.5 : 1);
      }
      let best: number = COLOUR.nobody;
      for (let c = 0; c < 11; c++) if ((tally[c] as number) > (tally[best] as number)) best = c;
      sw[i * 2] = first ? h : (sn[i * 3] as number);
      sw[i * 2 + 1] = first ? best : (sn[i * 3 + 1] as number);
      sn[i * 3] = h;
      sn[i * 3 + 1] = best;
      sn[i * 3 + 2] = t;
    }
    attr(g, "iNow").needsUpdate = true;
    attr(g, "iWas").needsUpdate = true;
  }

  private updateBeacons(list: Beacon[]): void {
    const live = new Set<number>();
    for (const b of list) {
      live.add(b.person);
      const was = this.beacons.get(b.person);
      if (was) {
        was.tx = b.x;
        was.tz = b.z;
        was.b = b;
        if (this.view.reduced) [was.x, was.z] = [b.x, b.z];
      } else this.beacons.set(b.person, { x: b.x, z: b.z, tx: b.x, tz: b.z, vx: 0, vz: 0, b });
    }
    for (const p of [...this.beacons.keys()]) if (!live.has(p)) this.beacons.delete(p);
    for (const [p, el] of this.beaconEls) {
      if (live.has(p)) continue;
      el.remove();
      this.beaconEls.delete(p);
    }
    for (const [p, s] of this.beacons) {
      let el = this.beaconEls.get(p);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "pointer-events-auto absolute top-0 left-0 flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 bg-surface p-0 type-caption font-semibold text-primary shadow-(--shadow-md) will-change-transform";
        const who = this.hooks.avatars(p);
        el.setAttribute("aria-label", `${who.name}: show only the files they hold`);
        el.title = who.name;
        el.textContent = who.name
          .split(/\s+/)
          .map((w) => w[0] ?? "")
          .join("")
          .slice(0, 2)
          .toUpperCase();
        if (who.login) {
          const img = document.createElement("img");
          img.alt = "";
          img.width = 32;
          img.height = 32;
          img.className = "absolute inset-0 size-full object-cover";
          img.loading = "lazy";
          img.src = avatarUrl(who.login, 32);
          img.onerror = () => img.remove();
          el.appendChild(img);
        }
        el.addEventListener("click", () => this.hooks.onPerson(p));
        this.layers.beacons.appendChild(el);
        this.beaconEls.set(p, el);
      }
      el.style.borderColor = this.look?.css.slots[s.b.slot] ?? "var(--line)";
    }
  }

  private ensureNeighbours(): Int32Array {
    if (this.neighbours) return this.neighbours;
    const s = this.summary;
    const n = s.count;
    const at = new Map<number, number>();
    const qs = new Int32Array(n);
    const rs = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const [q, r] = hexAt(s.x[i] as number, s.z[i] as number);
      qs[i] = q;
      rs[i] = r;
      at.set(cellKey(q, r), i);
    }
    const out = new Int32Array(n * 6).fill(-1);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 6; k++) {
        const [dq, dr] = DIRECTIONS[k] as readonly [number, number];
        out[i * 6 + k] = at.get(cellKey((qs[i] as number) + dq, (rs[i] as number) + dr)) ?? -1;
      }
    this.neighbours = out;
    return out;
  }

  private outline(was: [number, number] | null, next: [number, number] | null, nowW: number): void {
    const e = this.edgeArray;
    if (was) e.fill(0, was[0], was[1]);
    if (next) {
      const s = this.summary;
      const nb = this.ensureNeighbours();
      const [from, to] = next;
      const alive = (r: number) => (s.born[r] as number) <= nowW && nowW < (s.died[r] as number);
      for (let r = from; r < to; r++) {
        if (!alive(r)) continue;
        let bits = 0;
        for (let k = 0; k < 6; k++) {
          const o = nb[r * 6 + k] as number;
          if (o < from || o >= to || !alive(o)) bits |= 1 << k;
        }
        e[r] = 64 + bits;
      }
    }
    const lo = Math.min(was?.[0] ?? Infinity, next?.[0] ?? Infinity);
    const hi = Math.max(was?.[1] ?? -Infinity, next?.[1] ?? -Infinity);
    for (const c of this.chunks) if (c.from < hi && c.from + c.count > lo) attr(c.geometry, "iEdge").needsUpdate = true;
  }

  private setHovered(t: Target | null): void {
    if (same(t, this.hovered)) return;
    this.hovered = t;
    const u = this.uniforms;
    u.uHover!.value = t?.kind === "file" ? t.rank : -10;
    const f = this.summary.folders;
    const next: [number, number] | null = t?.kind === "folder" ? [f.from[t.folder] as number, f.to[t.folder] as number] : null;
    if (next || this.region) {
      this.outline(this.region, next, u.uNow!.value as number);
      if (next) {
        this.region = next;
        (u.uRegion!.value as THREE.Vector2).set(next[0], next[1]);
        this.regionMix = 0;
      } else this.region = null;
    }
    this.gl.domElement.style.cursor = t ? "pointer" : "grab";
    this.dirty = true;
  }

  /** What the pointer means over this file at this zoom: from afar the folder it belongs to at a size worth taking in at once, close up the file itself. */
  private targetOf(rank: number): Target {
    const s = this.summary;
    const unit = this.height / (2 * this.control.cam.dist * Math.tan(((FOV / 2) * Math.PI) / 180));
    if (Math.sqrt(3) * unit >= 22) return { kind: "file", rank };
    const f = s.folders;
    const chain: number[] = [];
    for (let d = s.fileFolder[rank] as number; d > 0; d = f.parent[d] as number) chain.push(d);
    const limit = 0.3 * Math.min(this.width, this.height);
    const focus = this.view.focus;
    for (let i = chain.length - 1; i >= 0; i--) {
      const d = chain[i] as number;
      const from = f.from[d] as number;
      const to = f.to[d] as number;
      if (from < 0 || to - from < 2) continue;
      if (focus && from <= focus[0] && to >= focus[1]) continue;
      if ((f.radius[d] as number) * unit <= limit) return { kind: "folder", folder: d };
    }
    const deepest = chain.find((d) => (f.to[d] as number) - (f.from[d] as number) >= 2 && !(focus && (f.from[d] as number) <= focus[0] && (f.to[d] as number) >= focus[1]));
    return deepest === undefined ? { kind: "file", rank } : { kind: "folder", folder: deepest };
  }

  private measureCovers(wall: number): void {
    if (wall - this.covers.at <= 0.3) return;
    const root = this.gl.domElement.closest("section");
    const base = this.gl.domElement.getBoundingClientRect();
    this.covers = {
      at: wall,
      rects: root
        ? [...root.querySelectorAll("[data-atlas-cover]")].map((e) => {
            const r = e.getBoundingClientRect();
            return [r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top] as [number, number, number, number];
          })
        : [],
    };
  }

  private covered(b: [number, number, number, number]): boolean {
    return this.covers.rects.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  }

  private screen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    this.projected.set(x, y, z).project(this.camera);
    return { x: (this.projected.x * 0.5 + 0.5) * this.width, y: (-this.projected.y * 0.5 + 0.5) * this.height, behind: this.projected.z > 1 };
  }

  private placeBeacons(dt: number): boolean {
    const pos = this.poles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.poles.geometry.getAttribute("color") as THREE.BufferAttribute;
    const u = this.uniforms;
    const spots = u.uBeacons!.value as THREE.Vector4[];
    const tints = u.uBeaconColours!.value as THREE.Color[];
    const b = this.summary.bounds;
    const reach = Math.max(4.5, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.025);
    const night = this.look?.night ?? false;
    let k = 0;
    let moving = false;
    const stiffness = 30;
    this.beaconBoxes = [];
    for (const [person, s] of this.beacons) {
      const ax = (s.tx - s.x) * stiffness - s.vx * 2 * Math.sqrt(stiffness);
      const az = (s.tz - s.z) * stiffness - s.vz * 2 * Math.sqrt(stiffness);
      s.vx += ax * dt;
      s.vz += az * dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      if (Math.hypot(s.tx - s.x, s.tz - s.z) > 0.05) moving = true;
      if (k < BEACONS) {
        const c = this.look?.slots[s.b.slot] ?? this.look?.other ?? [1, 1, 1];
        pos.setXYZ(k * 2, s.x, this.scale * 0.6, s.z);
        pos.setXYZ(k * 2 + 1, s.x, BEACON_HEIGHT, s.z);
        col.setXYZ(k * 2, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4);
        col.setXYZ(k * 2 + 1, c[0], c[1], c[2]);
        spots[k]?.set(s.x, s.z, reach, (0.3 + 0.45 * Math.min(1, Math.log2(1 + s.b.commits) / 6)) * (night ? 1.5 : 1));
        tints[k]?.copy(colourOf(c));
        k++;
      }
      const el = this.beaconEls.get(person);
      if (!el) continue;
      const p = this.screen(s.x, BEACON_HEIGHT, s.z);
      const off = p.behind || p.x < -40 || p.x > this.width + 40 || p.y < -40 || p.y > this.height + 40 || this.covered([p.x - 16, p.y - 32, p.x + 16, p.y]);
      show(el, !off, `translate(${Math.round(p.x - 16)}px, ${Math.round(p.y - 32)}px)`);
      if (!off) this.beaconBoxes.push([p.x - 16, p.y - 32, p.x + 16, p.y]);
    }
    u.uBeaconCount!.value = k;
    this.poles.geometry.setDrawRange(0, k * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    return moving;
  }

  private placePin(nowWeeks: number): void {
    const el = this.layers.pin;
    const r = this.view.selected;
    const s = this.summary;
    if (r === null || r < 0 || r >= s.count) {
      el.style.display = "none";
      return;
    }
    const tops = this.nowArray;
    const alive = (s.born[r] as number) <= nowWeeks && nowWeeks < (s.died[r] as number);
    const h = alive ? this.scale * (0.35 + 0.42 * Math.log2(1 + (tops[r * 3] as number))) : -0.3;
    const p = this.screen(s.x[r] as number, h, s.z[r] as number);
    el.style.display = p.behind ? "none" : "block";
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  private placeLabels(): void {
    const placed: [number, number, number, number][] = [...this.covers.rects, ...this.beaconBoxes];
    const pxPerUnit = this.height / (2 * this.control.cam.dist * Math.tan(((FOV / 2) * Math.PI) / 180));
    let shown = 0;
    for (const { region, el } of this.labels) {
      const focused = document.activeElement === el;
      const radiusPx = region.radius * pxPerUnit;
      const wanted = el.dataset.state !== "unborn" && (region.island ? radiusPx > 18 : radiusPx > 70 && region.depth <= 4 && el.dataset.state !== "sunk");
      if (!focused && (!wanted || shown > 60)) {
        show(el, false);
        continue;
      }
      const p = this.screen(region.x, 0.7 * this.scale, region.z);
      if (p.behind) {
        show(el, false);
        continue;
      }
      const w = Math.min(192, (region.island ? 9 : 7) * (el.textContent?.length ?? 4) + 16);
      const h = region.island ? 22 : 18;
      const box: [number, number, number, number] = [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
      const clash = box[0] < 4 || box[2] > this.width - 4 || box[1] < 4 || box[3] > this.height - 4 || placed.some((o) => box[0] < o[2] + 4 && box[2] > o[0] - 4 && box[1] < o[3] + 2 && box[3] > o[1] - 2);
      if (clash && !focused) {
        show(el, false);
        continue;
      }
      placed.push(box);
      shown++;
      show(el, true, `translate(${Math.round(box[0])}px, ${Math.round(box[1])}px)`);
    }
  }

  private pick(wall: number, flying: boolean): void {
    const pt = this.pointer;
    const clock = this.clock.current;
    if (!pt.inside || !(pt.dirty || ((flying || clock.playing) && wall - this.lastPick > 0.15))) return;
    pt.dirty = false;
    this.lastPick = wall;
    const gl = this.gl;
    const dpr = gl.getPixelRatio();
    this.variant("pick");
    for (const o of this.floor) o.visible = false;
    this.camera.setViewOffset(this.width * dpr, this.height * dpr, Math.round(pt.x * dpr), Math.round(pt.y * dpr), 1, 1);
    gl.setRenderTarget(this.pickTarget);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(this.world, this.camera);
    gl.setRenderTarget(null);
    this.camera.clearViewOffset();
    for (const o of this.floor) o.visible = true;
    this.variant("main");
    gl.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pixel);
    const id = (this.pixel[0] as number) + (this.pixel[1] as number) * 256 + (this.pixel[2] as number) * 65536 - 1;
    const rank = id >= 0 && id < this.summary.count ? id : null;
    const target = rank === null ? null : this.targetOf(rank);
    this.setHovered(target);
    this.hooks.onHover(target, pt.x, pt.y);
  }

  private watch(dt: number, wall: number): void {
    if (!this.auto || this.view.reduced || wall - this.slowSince < 3) return;
    this.slow.push(dt);
    if (this.slow.length < 90) return;
    const mean = this.slow.reduce((a, b) => a + b, 0) / this.slow.length;
    this.slow.length = 0;
    const next = LOWER[this.pipeline.detail];
    if (mean > 1 / 28 && next) {
      this.slowSince = wall;
      this.hooks.onSlow(next);
    }
  }

  frame(delta: number): boolean {
    if (!this.compiled) return false;
    const wall = performance.now() / 1000;
    const dt = Math.min(0.1, delta);
    const u = this.uniforms;
    const flying = this.control.step(dt);
    if (flying && !this.control.flying) this.hooks.onCam(this.control.cam);
    place(this.camera, this.control.cam);
    this.measureCovers(wall);
    const clock = this.clock.current;
    const s = this.summary;
    const nowWeeks = (clock.at - s.origin) / WEEK_SECONDS;
    const changedNow = u.uNow!.value !== nowWeeks;
    u.uNow!.value = nowWeeks;
    const speedWeeks = clock.speed / WEEK_SECONDS;
    const reduced = this.view.reduced;
    u.uRise!.value = reduced ? 0 : clock.playing ? Math.max(0.02, speedWeeks * 0.45) : 0;
    u.uFlashSpan!.value = Math.max(0.05, Math.min(26, speedWeeks * 0.6));
    const flashing = wall < this.flashUntil;
    u.uFlashGain!.value = reduced ? 0 : clock.playing ? 1 : flashing ? Math.max(0, (this.flashUntil - wall) / 0.8) : 0;
    const blend = Math.min(1, (wall - this.blendStart) / (reduced ? 0.001 : 0.22));
    u.uBlend!.value = blend;
    const regionTarget = this.region ? 1 : 0;
    const regionMoving = this.regionMix !== regionTarget;
    this.regionMix = reduced ? regionTarget : regionTarget > this.regionMix ? Math.min(1, this.regionMix + dt * 7) : Math.max(0, this.regionMix - dt * 7);
    u.uRegionMix!.value = this.regionMix;
    const sweepAt = (wall - this.sweep.start) / SWEEP_SECONDS;
    const sweeping = sweepAt >= 0 && sweepAt < 1;
    const sw = u.uSweep!.value as THREE.Vector4;
    if (sweeping) {
      const width = Math.max(5, (this.sweep.max - this.sweep.min) * 0.05);
      sw.set(this.sweep.min - width * 2 + (this.sweep.max - this.sweep.min + width * 4) * sweepAt, this.sweep.dx, this.sweep.dz, width);
    } else sw.w = 0;
    const fit = fitDistance(s.bounds, this.aspect, EL_REST);
    const dist = this.control.cam.dist;
    this.waterUniforms.uFogNear!.value = dist * 1.1 + fit * 0.2;
    this.waterUniforms.uFogFar!.value = dist * 3.2 + fit * 0.6;
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    let visible = 0;
    for (const c of this.chunks) if (this.frustum.intersectsSphere(c.sphere)) visible += c.count;
    const useSupers = !!this.superMesh && visible > SUPER_VISIBLE;
    if (this.hexGroup.visible === useSupers) this.dirty = true;
    this.hexGroup.visible = !useSupers;
    if (this.superMesh) this.superMesh.visible = useSupers;
    const moving = this.placeBeacons(dt);
    this.placePin(nowWeeks);
    this.placeLabels();
    this.pick(wall, flying);
    const camMoved = !this.lastView.equals(this.camera.matrixWorld) || !this.lastProjection.equals(this.camera.projectionMatrix);
    this.lastView.copy(this.camera.matrixWorld);
    this.lastProjection.copy(this.camera.projectionMatrix);
    const animating = flying || clock.playing || blend < 1 || flashing || sweeping || moving || regionMoving || changedNow;
    const dirty = this.dirty || camMoved || animating;
    const fps = this.pipeline.fps;
    if (!dirty && fps > 0 && wall - this.lastDraw < 1 / fps) return true;
    const b = s.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const whole = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
    const half = Math.min(whole, Math.max(16, dist * 0.85));
    const centre = half >= whole ? new THREE.Vector3(cx, 0, cz) : new THREE.Vector3(this.control.cam.x, 0, this.control.cam.z);
    this.pipeline.render(dt, { dirty, time: reduced ? 0 : wall % 3600, shadowCentre: centre, shadowHalf: half, shadowHeight: this.scale * 6, sun: SUN });
    this.dirty = false;
    this.lastDraw = wall;
    this.watch(dt, wall);
    return !reduced || animating;
  }

  dispose(): void {
    this.gone = true;
    this.unlisten();
    for (const c of this.chunks) c.geometry.dispose();
    this.supers?.dispose();
    for (const m of this.materials) m.dispose();
    for (const f of this.floor) f.geometry.dispose();
    this.poles.geometry.dispose();
    this.pickTarget.dispose();
    this.pipeline.dispose();
    this.layers.labels.replaceChildren();
    this.layers.beacons.replaceChildren();
  }
}
