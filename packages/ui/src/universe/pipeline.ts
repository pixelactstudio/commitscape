import * as THREE from "three";
import { BloomEffect, EffectComposer, EffectPass, Pass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import { screenTriangle } from "./geometry";
import { BLUR_FRAGMENT, SCREEN_VERTEX, WATER_FRAGMENT } from "./shaders";

export type Detail = "high" | "balanced" | "low";

export type Tier = { shadow: number; reflect: number; samples: number; bloom: boolean; fps: number; dpr: number };

export const TIERS: Record<Detail, Tier> = {
  high: { shadow: 2048, reflect: 0.5, samples: 4, bloom: true, fps: 0, dpr: 2 },
  balanced: { shadow: 1024, reflect: 0.34, samples: 0, bloom: true, fps: 0, dpr: 1.25 },
  low: { shadow: 0, reflect: 0, samples: 0, bloom: false, fps: 30, dpr: 1 },
};

export const LOWER: Record<Detail, Detail | null> = { high: "balanced", balanced: "low", low: null };

export type Variant = "main" | "reflect" | "depth" | "mask" | "pick";

export type ShadowUniforms = {
  uShadowMap: { value: THREE.Texture | null };
  uShadowMatrix: { value: THREE.Matrix4 };
  uShadowTexel: { value: number };
  uShadowBias: { value: number };
};

export type Scenes = {
  world: THREE.Scene;
  overlay: THREE.Scene;
  floor: THREE.Object3D[];
  variant: (v: Variant) => void;
};

export type Frame = { dirty: boolean; time: number; shadowCentre: THREE.Vector3; shadowHalf: number; shadowHeight: number; sun: THREE.Vector3 };

const FLIP = new THREE.Matrix4().makeScale(1, -1, 1);

class DrawPass extends Pass {
  private readonly draw: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) => void;

  constructor(draw: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) => void) {
    super("AtlasPass");
    this.draw = draw;
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    this.draw(renderer, this.renderToScreen ? null : inputBuffer);
  }
}

function target(w: number, h: number, o: THREE.RenderTargetOptions): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { depthBuffer: true, stencilBuffer: false, ...o });
}

/** The Atlas's frame from light to screen: shadows, a top-down mask of the living land, the mirrored land for the water to reflect, the land and seabed, then the water over them, bloom, tone mapping and SMAA. */
export class Pipeline {
  readonly water: THREE.ShaderMaterial;
  readonly shadow: ShadowUniforms;
  detail: Detail;
  private tier: Tier;
  private readonly gl: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scenes: Scenes;
  private readonly composer: EffectComposer;
  private effects: Pass[] = [];
  private readonly blur: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly opaque: THREE.WebGLRenderTarget;
  private reflect: THREE.WebGLRenderTarget | null = null;
  private shadowTarget: THREE.WebGLRenderTarget | null = null;
  private readonly land: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly shadowCamera = new THREE.OrthographicCamera();
  private readonly maskCamera = new THREE.OrthographicCamera();
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly size = new THREE.Vector2();
  private frame: Frame | null = null;
  private stale = true;

  constructor(o: { gl: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; scenes: Scenes; area: [number, number, number, number]; detail: Detail; water: Record<string, { value: unknown }>; shadow: ShadowUniforms }) {
    this.gl = o.gl;
    this.camera = o.camera;
    this.scenes = o.scenes;
    this.detail = o.detail;
    this.tier = TIERS[o.detail];
    this.shadow = o.shadow;
    this.mirror.matrixAutoUpdate = false;
    this.mirror.matrixWorldAutoUpdate = false;
    this.gl.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    this.opaque = target(w, h, { type: THREE.HalfFloatType, samples: this.tier.samples, depthTexture: new THREE.DepthTexture(w, h) });
    const [ax, az, aw, ah] = o.area;
    const mw = 512;
    const mh = Math.max(64, Math.round((512 * ah) / Math.max(1, aw)));
    this.land = [target(mw, mh, { depthBuffer: false }), target(mw, mh, { depthBuffer: false })];
    const hw = aw / 2;
    const hh = ah / 2;
    this.maskCamera.left = -hw;
    this.maskCamera.right = hw;
    this.maskCamera.top = hh;
    this.maskCamera.bottom = -hh;
    this.maskCamera.near = 1;
    this.maskCamera.far = 400;
    this.maskCamera.position.set(ax + hw, 200, az + hh);
    this.maskCamera.up.set(0, 0, -1);
    this.maskCamera.lookAt(ax + hw, 0, az + hh);
    this.maskCamera.updateProjectionMatrix();
    this.maskCamera.updateMatrixWorld();

    this.water = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      uniforms: {
        ...o.water,
        ...this.shadow,
        tColor: { value: this.opaque.texture },
        tDepth: { value: this.opaque.depthTexture },
        tReflect: { value: null },
        tLand: { value: this.land[0].texture },
        uInverse: { value: new THREE.Matrix4() },
        uViewProjection: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() },
        uPixel: { value: 0.001 },
        uReflect: { value: 0 },
      },
    });
    this.blur = new THREE.ShaderMaterial({ vertexShader: SCREEN_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false, uniforms: { tInput: { value: null }, uStep: { value: new THREE.Vector2() } } });
    this.quad = new THREE.Mesh(screenTriangle(), this.water);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, multisampling: 0 });
    this.composer.addPass(new DrawPass((renderer, out) => this.draw(renderer, out)));
    this.applyTier();
  }

  /** Changes how much the frame draws: shadows, reflections, multisampling and bloom. */
  setDetail(d: Detail): void {
    if (d === this.detail) return;
    this.detail = d;
    const was = this.tier;
    this.tier = TIERS[d];
    if (was.samples !== this.tier.samples) {
      this.opaque.dispose();
      this.opaque.samples = this.tier.samples;
    }
    this.applyTier();
    this.stale = true;
  }

  get landTexture(): THREE.Texture {
    return this.land[0].texture;
  }

  get shadows(): boolean {
    return this.tier.shadow > 0;
  }

  get fps(): number {
    return this.tier.fps;
  }

  private applyTier(): void {
    const t = this.tier;
    this.shadowTarget?.dispose();
    this.shadowTarget = null;
    if (t.shadow > 0) {
      const depth = new THREE.DepthTexture(t.shadow, t.shadow);
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = THREE.LinearFilter;
      depth.magFilter = THREE.LinearFilter;
      this.shadowTarget = target(t.shadow, t.shadow, { depthTexture: depth });
      this.shadow.uShadowMap.value = depth;
      this.shadow.uShadowTexel.value = 1 / t.shadow;
    } else this.shadow.uShadowMap.value = null;
    this.reflect?.dispose();
    this.reflect = null;
    if (t.reflect > 0) this.reflect = target(Math.round(this.size.x * t.reflect), Math.round(this.size.y * t.reflect), { type: THREE.HalfFloatType });
    this.water.uniforms.tReflect!.value = this.reflect?.texture ?? null;
    this.water.uniforms.uReflect!.value = this.reflect ? 1 : 0;
    for (const p of this.effects) {
      this.composer.removePass(p);
      p.dispose();
    }
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    const first = t.bloom ? new EffectPass(this.camera, new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1, luminanceSmoothing: 0.35, intensity: 0.8, radius: 0.7 }), tone) : new EffectPass(this.camera, tone);
    this.effects = [first, new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH }))];
    for (const p of this.effects) this.composer.addPass(p);
  }

  /** Follows the canvas's drawing buffer after a resize or a change of pixel ratio. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
    this.gl.getDrawingBufferSize(this.size);
    this.opaque.setSize(this.size.x, this.size.y);
    this.reflect?.setSize(Math.max(1, Math.round(this.size.x * this.tier.reflect)), Math.max(1, Math.round(this.size.y * this.tier.reflect)));
    this.stale = true;
  }

  /** Draws one frame; the land, its shadows and reflections only when something on them changed. */
  render(delta: number, f: Frame): void {
    this.frame = f;
    this.water.uniforms.uTime!.value = f.time;
    this.composer.render(delta);
  }

  private screen(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(out);
    renderer.render(this.quadScene, this.quadCamera);
  }

  private draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget | null): void {
    const f = this.frame;
    if (!f) return;
    const { world, overlay, floor, variant } = this.scenes;
    const camera = this.camera;
    const was = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    if (f.dirty || this.stale) {
      this.stale = false;
      for (const o of floor) o.visible = false;
      if (this.shadowTarget) {
        this.fitShadow(f);
        variant("depth");
        renderer.setRenderTarget(this.shadowTarget);
        renderer.clear(true, true, false);
        renderer.render(world, this.shadowCamera);
      }
      variant("mask");
      renderer.setRenderTarget(this.land[0]);
      renderer.clear(true, true, false);
      renderer.render(world, this.maskCamera);
      const blur = this.blur.uniforms;
      for (let pass = 0; pass < 3; pass++) {
        blur.tInput!.value = this.land[0].texture;
        (blur.uStep!.value as THREE.Vector2).set(1 / this.land[0].width, 0);
        this.screen(renderer, this.blur, this.land[1]);
        blur.tInput!.value = this.land[1].texture;
        (blur.uStep!.value as THREE.Vector2).set(0, 1 / this.land[0].height);
        this.screen(renderer, this.blur, this.land[0]);
      }
      if (this.reflect) {
        variant("reflect");
        const m = this.mirror;
        m.projectionMatrix.copy(camera.projectionMatrix);
        m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        m.matrixWorld.multiplyMatrices(FLIP, camera.matrixWorld);
        m.matrixWorldInverse.copy(m.matrixWorld).invert();
        renderer.setRenderTarget(this.reflect);
        renderer.clear(true, true, false);
        renderer.render(world, m);
      }
      for (const o of floor) o.visible = true;
      variant("main");
      renderer.setRenderTarget(this.opaque);
      renderer.clear(true, true, false);
      renderer.render(world, camera);
    }
    const u = this.water.uniforms;
    (u.uViewProjection!.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (u.uInverse!.value as THREE.Matrix4).copy(u.uViewProjection!.value as THREE.Matrix4).invert();
    (u.uCam!.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    u.uPixel!.value = (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180)) / Math.max(1, this.size.y);
    renderer.setRenderTarget(out);
    renderer.clear(true, true, false);
    this.screen(renderer, this.water, out);
    renderer.render(overlay, camera);
    renderer.autoClear = was;
  }

  private fitShadow(f: Frame): void {
    const c = this.shadowCamera;
    const half = f.shadowHalf;
    const reach = half * 1.6 + f.shadowHeight + 20;
    c.position.copy(f.shadowCentre).addScaledVector(f.sun, reach);
    c.up.set(0, 1, 0);
    c.lookAt(f.shadowCentre);
    c.left = -half;
    c.right = half;
    c.top = half;
    c.bottom = -half;
    c.near = 0.5;
    c.far = reach * 2;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.shadow.uShadowMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.shadow.uShadowBias.value = 0.05 / (c.far - c.near);
  }

  dispose(): void {
    this.composer.dispose();
    this.opaque.dispose();
    this.opaque.depthTexture?.dispose();
    this.reflect?.dispose();
    this.shadowTarget?.depthTexture?.dispose();
    this.shadowTarget?.dispose();
    for (const t of this.land) t.dispose();
    this.water.dispose();
    this.blur.dispose();
    this.quad.geometry.dispose();
  }
}
