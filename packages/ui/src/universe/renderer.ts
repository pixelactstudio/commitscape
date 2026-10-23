import * as THREE from "three";
import { COLOUR, WEEK_SECONDS, type Beacon } from "@commitscape/data/universe";
import { avatarUrl } from "../components/avatar";
import { clampCam, EL_REST, fitDistance, fitted, FOV, groundAt, MapCamera, place, restingCam, sampleOf, type Cam, type Insets } from "./camera";
import { beamStrip, fieldTexture, groundQuad, hexPrism, SUPER_SCALE, SUPER_TURN } from "./geometry";
import type { Look, Rgb } from "./look";
import type { FrameAnswer, Region, Summary } from "./protocol";
import { HEX_FRAGMENT, HEX_VERTEX, RING_FRAGMENT, RING_VERTEX, SEA_FRAGMENT, SEA_VERTEX, STRIKE_FRAGMENT, STRIKE_VERTEX } from "./shaders";

export type StageClock = { at: number; playing: boolean; speed: number; intro: boolean };

export type StageApi = { fly: (x: number, z: number, radius: number) => void; home: () => void; zoom: (factor: number) => void; turn: (by: number) => void; tilt: (by: number) => void; pan: (dx: number, dy: number) => void; wake: () => void; intro: (seconds: number) => void; cam: () => Cam };

export type View = { lens: number; focus: [number, number] | null; roleMask: number; selected: number | null; soloSlot: number | null; top: boolean; reduced: boolean; insets: Insets };

export type Caption = { key: number; text: string; detail: string; until: number };

export type Hooks = {
  onHover: (rank: number | null, x: number, y: number) => void;
  onPick: (rank: number | null, double: boolean) => void;
  onFolder: (folder: number) => void;
  onPerson: (person: number) => void;
  onCam: (cam: Cam) => void;
  onCaption: (c: Caption) => void;
  avatars: (person: number) => { name: string; login: string | null };
};

export type Layers = { labels: HTMLDivElement; beacons: HTMLDivElement; pin: HTMLDivElement };

const STRIKES = 2048;
const CHUNK = 4096;
const SUPER_VISIBLE = 60_000;
const RINGS = 48;
const BEACON_HEIGHT = 9;

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

type BeaconState = { x: number; z: number; tx: number; tz: number; vx: number; vz: number; b: Beacon };

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
  private readonly supers: THREE.InstancedBufferGeometry | null;
  private readonly chunks: { mesh: THREE.Mesh; pick: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; count: number; sphere: THREE.Sphere }[] = [];
  private readonly hexGroup = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly nowArray: Float32Array;
  private readonly wasArray: Float32Array;
  private readonly superMesh: THREE.Mesh | null;
  private readonly sea: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly strikes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly rings: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly poles: THREE.LineSegments;
  private readonly scene = new THREE.Scene();
  private readonly pickScene = new THREE.Scene();
  private readonly superPickScene = new THREE.Scene();
  private readonly pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly materials: THREE.Material[] = [];
  private strikeNext = 0;
  private strikeUntil = -100;
  private ringNext = 0;
  private ringUntil = -100;
  private blendStart = -10;
  private flashUntil = 0;
  private lastFrame: FrameAnswer | null = null;
  private readonly beacons = new Map<number, BeaconState>();
  private readonly beaconEls = new Map<number, HTMLButtonElement>();
  private labels: { region: Region; el: HTMLButtonElement }[] = [];
  private covers: { at: number; rects: [number, number, number, number][] } = { at: -1, rects: [] };
  private readonly pointer = { x: 0, y: 0, dirty: false, inside: false };
  private hovered: number | null = null;
  private lastPick = 0;
  private captionKey = 0;
  private readonly projected = new THREE.Vector3();
  private beaconBoxes: [number, number, number, number][] = [];
  private readonly pixel = new Uint8Array(4);
  private readonly unlisten: () => void;
  private compiled = false;
  private gone = false;
  private readonly cells: Float32Array;
  private resting: boolean;
  private restDist = 0;
  private wasIntro = false;

  constructor(o: { gl: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; summary: Summary; layers: Layers; hooks: Hooks; clock: { current: StageClock }; view: View; width: number; height: number; initial: Cam | null; wake: () => void }) {
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
    this.scale = heightScaleOf(o.summary.count);
    this.cells = sampleOf(o.summary.x, o.summary.z);
    this.resting = o.initial === null;
    const s = o.summary;
    const n = s.count;

    const cell = new Float32Array(n * 4);
    const info = new Float32Array(n * 4);
    const now = new Float32Array(n * 3);
    const was = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      cell.set([s.x[i] as number, s.z[i] as number, s.born[i] as number, s.died[i] as number], i * 4);
      info.set([s.borders[i] as number, s.role[i] as number, s.language[i] as number, i], i * 4);
      now[i * 3 + 1] = COLOUR.nobody;
      now[i * 3 + 2] = -1e6;
      was[i * 2 + 1] = COLOUR.nobody;
    }
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
      this.supers = instanced(prism, k, { iCell: [sc, 4, false], iInfo: [si, 4, false], iNow: [new Float32Array(k * 3), 3, true], iWas: [new Float32Array(k * 2), 2, true] });
    } else this.supers = null;

    const u: Record<string, { value: unknown }> = {
      uNow: { value: 0 },
      uRise: { value: 0 },
      uBlend: { value: 1 },
      uHeightScale: { value: this.scale },
      uFlat: { value: 0 },
      uCellScale: { value: 0.985 },
      uRotate: { value: 0 },
      uLens: { value: 0 },
      uSlots: { value: Array.from({ length: 11 }, () => new THREE.Color()) },
      uRoles: { value: Array.from({ length: 5 }, () => new THREE.Color()) },
      uLangs: { value: Array.from({ length: 10 }, () => new THREE.Color()) },
      uStale: { value: Array.from({ length: 4 }, () => new THREE.Color()) },
      uSnow: { value: new THREE.Color() },
      uSeabed: { value: new THREE.Color() },
      uDim: { value: new THREE.Color() },
      uFrost: { value: 1 },
      uFocus: { value: new THREE.Vector2(-1, -1) },
      uRoleMask: { value: 31 },
      uHover: { value: -10 },
      uSelected: { value: -10 },
      uFlashSpan: { value: 1 },
      uFlashGain: { value: 0 },
      uNight: { value: 0 },
      uKeyDir: { value: new THREE.Vector3(-0.5, Math.SQRT1_2, 0.5).normalize() },
      uSky: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uBorder: { value: new THREE.Vector4() },
      uFog: { value: new THREE.Color() },
      uFogNear: { value: 1000 },
      uFogFar: { value: 3000 },
      uGlow: { value: new THREE.Color() },
      uMarkColour: { value: new THREE.Color() },
    };
    this.uniforms = u;
    const superU = { ...u, uCellScale: { value: SUPER_SCALE * 0.97 }, uRotate: { value: SUPER_TURN }, uHover: { value: -10 }, uSelected: { value: -10 } };
    const material = (uniforms: Record<string, { value: unknown }>, pick: boolean) => {
      const m = new THREE.ShaderMaterial({ vertexShader: HEX_VERTEX, fragmentShader: HEX_FRAGMENT, uniforms, ...(pick ? { defines: { PICK: 1 } } : {}) });
      this.materials.push(m);
      return m;
    };
    this.nowArray = now;
    this.wasArray = was;
    const hexMaterial = material(u, false);
    const pickMaterial = material(u, true);
    const top = this.scale * 6;
    for (let from = 0; from < n; from += CHUNK) {
      const to = Math.min(n, from + CHUNK);
      const geometry = instanced(prism, to - from, { iCell: [cell.subarray(from * 4, to * 4), 4, false], iInfo: [info.subarray(from * 4, to * 4), 4, false], iNow: [now.subarray(from * 3, to * 3), 3, true], iWas: [was.subarray(from * 2, to * 2), 2, true] });
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
      const sphere = new THREE.Sphere(new THREE.Vector3((minX + maxX) / 2, top / 2, (minZ + maxZ) / 2), Math.hypot(maxX - minX + 2, maxZ - minZ + 2, top) / 2);
      geometry.boundingSphere = sphere;
      const mesh = new THREE.Mesh(geometry, hexMaterial);
      const pick = new THREE.Mesh(geometry, pickMaterial);
      this.hexGroup.add(mesh);
      this.pickScene.add(pick);
      this.chunks.push({ mesh, pick, geometry, count: to - from, sphere });
    }
    if (this.supers) {
      this.superMesh = new THREE.Mesh(this.supers, material(superU, false));
      this.superMesh.frustumCulled = false;
      this.superMesh.visible = false;
      const superPick = new THREE.Mesh(this.supers, material(superU, true));
      superPick.frustumCulled = false;
      this.superPickScene.add(superPick);
    } else this.superMesh = null;

    const b = s.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const texture = fieldTexture(s.field);
    const area = s.field.area;
    const seaMaterial = new THREE.ShaderMaterial({
      vertexShader: SEA_VERTEX,
      fragmentShader: SEA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uDistance: { value: texture }, uArea: { value: new THREE.Vector4(...area) }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() }, uFog: u.uFog, uFogNear: u.uFogNear, uFogFar: u.uFogFar, uTime: { value: 0 }, uNight: u.uNight, uKeyDir: u.uKeyDir },
    });
    this.materials.push(seaMaterial);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(span * 12 + 4000, span * 12 + 4000), seaMaterial);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.sea.renderOrder = 2;

    const strikeMaterial = new THREE.ShaderMaterial({ vertexShader: STRIKE_VERTEX, fragmentShader: STRIKE_FRAGMENT, transparent: true, depthWrite: false, uniforms: { uWall: { value: 0 }, uWidth: { value: 0.12 }, uNight: u.uNight } });
    this.materials.push(strikeMaterial);
    this.strikes = new THREE.Mesh(instanced(beamStrip(8), STRIKES, { iFrom: [new Float32Array(STRIKES * 3), 3, true], iTo: [new Float32Array(STRIKES * 3), 3, true], iColour: [new Float32Array(STRIKES * 3), 3, true], iTime: [new Float32Array(STRIKES * 2).fill(-100), 2, true] }), strikeMaterial);
    this.strikes.frustumCulled = false;
    this.strikes.renderOrder = 4;

    const ringMaterial = new THREE.ShaderMaterial({ vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, uniforms: { uWall: { value: 0 }, uNight: u.uNight } });
    this.materials.push(ringMaterial);
    this.rings = new THREE.Mesh(instanced(groundQuad(), RINGS, { iRing: [new Float32Array(RINGS * 4), 4, true], iColour: [new Float32Array(RINGS * 3), 3, true], iTime: [new Float32Array(RINGS * 2).fill(-100), 2, true] }), ringMaterial);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;

    const poleGeometry = new THREE.BufferGeometry();
    poleGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(48), 3).setUsage(THREE.DynamicDrawUsage));
    poleGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(48), 3).setUsage(THREE.DynamicDrawUsage));
    poleGeometry.setDrawRange(0, 0);
    const poleMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    this.materials.push(poleMaterial);
    this.poles = new THREE.LineSegments(poleGeometry, poleMaterial);
    this.poles.frustumCulled = false;
    this.poles.renderOrder = 5;

    for (const obj of [this.hexGroup, this.superMesh, this.sea, this.rings, this.strikes, this.poles]) if (obj) this.scene.add(obj);

    const start = o.initial ? clampCam(o.initial, b, this.aspect, this.view.top) : this.rest();
    this.control = new MapCamera(start, () => b, () => this.aspect, () => this.view.top, () => (this.restDist > 0 ? Math.max(this.restDist * 1.6, fitDistance(b, this.aspect, EL_REST) * 1.2) : undefined));
    this.buildLabels();
    this.unlisten = this.listen();
    place(this.camera, this.control.cam);
    void Promise.all([o.gl.compileAsync(this.scene, this.camera), o.gl.compileAsync(this.pickScene, this.camera), this.superMesh ? o.gl.compileAsync(this.superPickScene, this.camera) : null])
      .catch(() => undefined)
      .then(() => {
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
    if (changed) this.refit();
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
    u.uSelected!.value = v.selected ?? -10;
    u.uFlat!.value = v.top ? 0.7 : 0;
    if (this.look && was.soloSlot !== v.soloSlot) this.setLook(this.look);
    const moved = was.insets.top !== v.insets.top || was.insets.bottom !== v.insets.bottom || was.insets.left !== v.insets.left || was.insets.right !== v.insets.right;
    if (this.control && was.top !== v.top) this.control.fly(this.rest(), 0);
    else if (moved) this.refit();
    this.wake();
  }

  setLook(look: Look): void {
    this.look = look;
    const u = this.uniforms;
    const slots = [...look.slots, look.other, look.sand, look.slots[this.view.soloSlot ?? 0] ?? look.other];
    const set = (name: string, list: Rgb[]) => list.forEach((c, i) => (u[name]!.value as THREE.Color[])[i]?.copy(colourOf(c)));
    set("uSlots", slots);
    set("uRoles", look.roles);
    set("uLangs", look.languages);
    set("uStale", look.stale);
    (u.uSnow!.value as THREE.Color).copy(colourOf(look.snow));
    (u.uSeabed!.value as THREE.Color).copy(colourOf(look.seabed));
    (u.uDim!.value as THREE.Color).copy(colourOf(look.dim));
    u.uNight!.value = look.night ? 1 : 0;
    (u.uSky!.value as THREE.Color).copy(colourOf(look.sky));
    (u.uGround!.value as THREE.Color).copy(colourOf(look.ground));
    const border = colourOf(look.border);
    (u.uBorder!.value as THREE.Vector4).set(border.r, border.g, border.b, look.night ? 0.42 : 0.5);
    (u.uFog!.value as THREE.Color).copy(colourOf(look.fog));
    (u.uGlow!.value as THREE.Color).copy(colourOf(look.glow));
    (u.uMarkColour!.value as THREE.Color).copy(colourOf(look.night ? [1, 1, 1] : [0.08, 0.09, 0.12]));
    const seaU = this.sea.material.uniforms;
    (seaU.uDeep!.value as THREE.Color).copy(colourOf(look.deep));
    (seaU.uShallow!.value as THREE.Color).copy(colourOf(look.shallow));
    (seaU.uFoam!.value as THREE.Color).copy(colourOf(look.foam));
    for (const m of [this.strikes.material, this.rings.material]) {
      m.blending = look.night ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.needsUpdate = true;
    }
    for (const [p, el] of this.beaconEls) {
      const s = this.beacons.get(p);
      if (s) el.style.borderColor = look.css.slots[s.b.slot] ?? "var(--line)";
    }
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
        this.hovered = null;
        this.hooks.onHover(null, 0, 0);
        this.uniforms.uHover!.value = -10;
        this.wake();
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.resting = false;
      const p = local(e);
      const at = groundAt(this.camera, (p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      this.control.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), at);
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
    const clock = this.clock.current;
    const wall = performance.now() / 1000;
    this.updateBeacons(f.beacons);
    const look = this.look;
    if (look && !this.view.reduced && clock.playing && !clock.intro && f.strikes.length > 0) this.strike(f, prev, wall, look);
    if (look && clock.playing && !clock.intro && prev && !this.view.reduced) {
      const rel = s.releases;
      for (let i = 0; i < rel.time.length; i++) {
        const t = rel.time[i] as number;
        if (t <= prev.at || t > f.at) continue;
        const b = s.bounds;
        const reach = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
        this.ring((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, reach * 0.52, look.release, wall, 2.4);
        this.ring((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, reach * 0.38, look.release, wall + 0.28, 2);
        this.hooks.onCaption({ key: ++this.captionKey, text: rel.names[i] ?? "", detail: "released", until: wall + 2.6 });
      }
    }
    if (clock.playing) this.flashUntil = wall + 0.8;
    this.wake();
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

  private strike(f: FrameAnswer, prev: FrameAnswer | null, wall: number, look: Look): void {
    const s = this.summary;
    const g = this.strikes.geometry;
    const iFrom = attr(g, "iFrom");
    const iTo = attr(g, "iTo");
    const iColour = attr(g, "iColour");
    const iTime = attr(g, "iTime");
    const span = Math.max(1, f.at - (prev?.at ?? f.at - 1));
    const perTick = Math.min(1, 320 / Math.max(1, f.strikes.reduce((n, x) => n + x.files.length, 0)));
    const tops = this.nowArray;
    for (const st of f.strikes) {
      const delay = Math.max(0, Math.min(0.9, ((st.time - (f.at - span)) / span) * 0.25));
      if (st.bulk) {
        let sx = 0;
        let sz = 0;
        let far = 0;
        for (const r of st.files) {
          sx += s.x[r] as number;
          sz += s.z[r] as number;
        }
        sx /= Math.max(1, st.files.length);
        sz /= Math.max(1, st.files.length);
        for (const r of st.files) far = Math.max(far, Math.hypot((s.x[r] as number) - sx, (s.z[r] as number) - sz));
        this.ring(sx, sz, far + 20, look.bulk, wall + delay, 2.2);
        this.hooks.onCaption({ key: ++this.captionKey, text: "Bulk Commit", detail: `${st.total.toLocaleString("en-US")} files · not counted in who holds them`, until: wall + 2.6 });
        continue;
      }
      const beacon = st.person >= 0 ? this.beacons.get(st.person) : undefined;
      const colour = st.colour < 8 ? (look.slots[st.colour] as Rgb) : look.other;
      for (const r of st.files) {
        if (Math.random() > perTick) continue;
        const i = this.strikeNext;
        this.strikeNext = (this.strikeNext + 1) % STRIKES;
        const tx = s.x[r] as number;
        const tz = s.z[r] as number;
        const h = this.scale * (0.35 + 0.42 * Math.log2(1 + (tops[r * 3] as number)));
        if (beacon) iFrom.setXYZ(i, beacon.x, BEACON_HEIGHT, beacon.z);
        else iFrom.setXYZ(i, tx + 4, 26 + Math.random() * 8, tz - 6);
        iTo.setXYZ(i, tx, h, tz);
        iColour.setXYZ(i, colour[0], colour[1], colour[2]);
        iTime.setXY(i, wall + delay, Math.random() * 100);
      }
    }
    for (const a of [iFrom, iTo, iColour, iTime]) a.needsUpdate = true;
    this.strikeUntil = wall + 1.2;
  }

  private ring(x: number, z: number, radius: number, colour: Rgb, start: number, life: number): void {
    const i = this.ringNext;
    this.ringNext = (this.ringNext + 1) % RINGS;
    const g = this.rings.geometry;
    attr(g, "iRing").setXYZW(i, x, z, radius, 0.08);
    attr(g, "iColour").setXYZ(i, colour[0], colour[1], colour[2]);
    attr(g, "iTime").setXY(i, start, life);
    for (const name of ["iRing", "iColour", "iTime"]) attr(g, name).needsUpdate = true;
    this.ringUntil = Math.max(this.ringUntil, start + life);
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
      if (k < 8) {
        const c = this.look?.slots[s.b.slot] ?? this.look?.other ?? [1, 1, 1];
        pos.setXYZ(k * 2, s.x, this.scale * 0.6, s.z);
        pos.setXYZ(k * 2 + 1, s.x, BEACON_HEIGHT, s.z);
        col.setXYZ(k * 2, c[0], c[1], c[2]);
        col.setXYZ(k * 2 + 1, c[0], c[1], c[2]);
        k++;
      }
      const el = this.beaconEls.get(person);
      if (!el) continue;
      const p = this.screen(s.x, BEACON_HEIGHT, s.z);
      const off = p.behind || p.x < -40 || p.x > this.width + 40 || p.y < -40 || p.y > this.height + 40 || this.covered([p.x - 16, p.y - 32, p.x + 16, p.y]);
      show(el, !off, `translate(${Math.round(p.x - 16)}px, ${Math.round(p.y - 32)}px)`);
      if (!off) this.beaconBoxes.push([p.x - 16, p.y - 32, p.x + 16, p.y]);
    }
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
    const h = alive ? this.scale * (0.35 + 0.42 * Math.log2(1 + (tops[r * 3] as number))) : -0.4;
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

  private pick(useSupers: boolean, wall: number, flying: boolean): void {
    const pt = this.pointer;
    const clock = this.clock.current;
    if (!pt.inside || !(pt.dirty || ((flying || clock.playing) && wall - this.lastPick > 0.15))) return;
    pt.dirty = false;
    this.lastPick = wall;
    const gl = this.gl;
    const dpr = gl.getPixelRatio();
    this.camera.setViewOffset(this.width * dpr, this.height * dpr, Math.round(pt.x * dpr), Math.round(pt.y * dpr), 1, 1);
    gl.setRenderTarget(this.pickTarget);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(useSupers && this.superMesh ? this.superPickScene : this.pickScene, this.camera);
    gl.setRenderTarget(null);
    this.camera.clearViewOffset();
    gl.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pixel);
    const id = (this.pixel[0] as number) + (this.pixel[1] as number) * 256 + (this.pixel[2] as number) * 65536 - 1;
    const rank = id >= 0 && id < this.summary.count ? id : null;
    if (rank !== this.hovered) {
      this.hovered = rank;
      this.uniforms.uHover!.value = rank ?? -10;
      gl.domElement.style.cursor = rank !== null ? "pointer" : "grab";
    }
    this.hooks.onHover(rank, pt.x, pt.y);
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
    if (this.wasIntro && !clock.intro && this.look && !this.view.reduced) {
      const b = s.bounds;
      this.ring((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.55, this.look.release, wall, 1.8);
    }
    this.wasIntro = clock.intro;
    const nowWeeks = (clock.at - s.origin) / WEEK_SECONDS;
    u.uNow!.value = nowWeeks;
    const speedWeeks = clock.speed / WEEK_SECONDS;
    const reduced = this.view.reduced;
    u.uRise!.value = reduced ? 0 : clock.playing ? Math.max(0.02, speedWeeks * 0.45) : 0;
    u.uFlashSpan!.value = Math.max(0.05, Math.min(clock.intro ? 6 : 26, speedWeeks * 0.6));
    const flashing = wall < this.flashUntil;
    u.uFlashGain!.value = reduced ? 0 : clock.playing ? (clock.intro ? 0.45 : 1) : flashing ? Math.max(0, (this.flashUntil - wall) / 0.8) : 0;
    const blend = Math.min(1, (wall - this.blendStart) / (reduced ? 0.001 : 0.22));
    u.uBlend!.value = blend;
    const fit = fitDistance(s.bounds, this.aspect, EL_REST);
    const dist = this.control.cam.dist;
    u.uFogNear!.value = dist * 1.1 + fit * 0.2;
    u.uFogFar!.value = dist * 3.2 + fit * 0.6;
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    let visible = 0;
    for (const c of this.chunks) if (this.frustum.intersectsSphere(c.sphere)) visible += c.count;
    const useSupers = !!this.superMesh && visible > SUPER_VISIBLE;
    this.hexGroup.visible = !useSupers;
    if (this.superMesh) this.superMesh.visible = useSupers;
    this.sea.material.uniforms.uTime!.value = reduced ? 0 : wall % 1000;
    this.strikes.material.uniforms.uWall!.value = wall;
    this.strikes.material.uniforms.uWidth!.value = Math.max(0.05, dist * 0.0009);
    this.rings.material.uniforms.uWall!.value = wall;
    const moving = this.placeBeacons(dt);
    this.placePin(nowWeeks);
    this.placeLabels();
    this.pick(useSupers, wall, flying);
    this.gl.setClearColor(0x000000, 0);
    this.gl.render(this.scene, this.camera);
    return flying || clock.playing || blend < 1 || flashing || wall < this.strikeUntil || wall < this.ringUntil || moving;
  }

  dispose(): void {
    this.gone = true;
    this.unlisten();
    for (const c of this.chunks) c.geometry.dispose();
    this.supers?.dispose();
    for (const m of this.materials) m.dispose();
    (this.sea.material.uniforms.uDistance?.value as THREE.Texture | undefined)?.dispose();
    this.sea.geometry.dispose();
    this.strikes.geometry.dispose();
    this.rings.geometry.dispose();
    this.poles.geometry.dispose();
    this.pickTarget.dispose();
    this.layers.labels.replaceChildren();
    this.layers.beacons.replaceChildren();
  }
}
