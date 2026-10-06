import { useEffect, useRef } from "react";

import type { MeshPalette } from "./mesh";

const VERTEX = `attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `precision mediump float;
uniform vec2 size;
uniform float time;
uniform float seed;
uniform vec3 c0;
uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = turn * p * 2.0 + 17.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 p = uv * vec2(size.x / size.y, 1.0) * 1.6 + seed;
  float t = time * 0.045;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 w = vec2(fbm(p + 2.2 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p + 2.2 * q + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(p + 2.6 * w);
  float a = smoothstep(0.32, 0.72, f);
  float b = smoothstep(0.42, 0.68, q.y);
  float c = smoothstep(0.5, 0.78, w.x);
  vec3 colour = mix(c0, c1, a * 0.9);
  colour = mix(colour, c2, b * 0.8);
  colour = mix(colour, c3, c * a * 0.85);
  float light = smoothstep(-0.1, 1.5, uv.x * 0.9 + (1.0 - uv.y) * 0.5);
  colour = mix(c0, colour, mix(0.45, 1.0, light));
  colour += (hash(gl_FragCoord.xy + fract(time)) - 0.5) * 0.04;
  gl_FragColor = vec4(colour, 1.0);
}`;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

type Colours = [number, number, number][];

/** A slowly flowing, domain-warped gradient drawn by a WebGL fragment shader behind its parent; still when motion is reduced, paused off screen. A new palette blends in over the old one. */
export function MeshGradient({ palette, seed = 0, className = "" }: { palette: MeshPalette; seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = palette.join();
  const wanted = useRef(key);
  const shift = useRef<((key: string) => void) | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!canvas || !gl) return;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const [size, time] = [u("size"), u("time")];
    const slots = [0, 1, 2, 3].map((i) => u(`c${i}`));
    gl.uniform1f(u("seed"), seed);
    const parse = (k: string): Colours => k.split(",").map(rgb);
    let from = parse(wanted.current);
    let to = from;
    let now = from;
    let since = 0;
    const paint = (colours: Colours) => colours.forEach((c, i) => gl.uniform3fv(slots[i] ?? null, c));
    paint(now);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now() - seed * 7000;
    let frame = 0;
    let onScreen = true;
    const blend = () => {
      if (now === to) return;
      const t = Math.min(1, (performance.now() - since) / 900);
      const e = 1 - (1 - t) ** 3;
      now = t >= 1 ? to : from.map((c, i) => c.map((v, j) => v + ((to[i]?.[j] ?? v) - v) * e) as [number, number, number]);
      paint(now);
    };
    const draw = () => {
      blend();
      gl.uniform1f(time, still ? 40 + seed * 10 : (performance.now() - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.ready = "";
    };
    const loop = () => {
      draw();
      frame = !still && onScreen && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(size, canvas.width, canvas.height);
      if (!frame) draw();
    };
    const wake = () => {
      if (!frame && !still && onScreen && !document.hidden) frame = requestAnimationFrame(loop);
    };
    shift.current = (k) => {
      from = now;
      to = parse(k);
      since = performance.now();
      if (frame) return;
      if (still || !onScreen || document.hidden) {
        now = to;
        paint(now);
        draw();
      } else wake();
    };
    const sized = new ResizeObserver(resize);
    sized.observe(canvas);
    const seen = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      wake();
    });
    seen.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    resize();
    wake();
    return () => {
      shift.current = null;
      cancelAnimationFrame(frame);
      sized.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", wake);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [seed]);
  useEffect(() => {
    if (wanted.current === key) return;
    wanted.current = key;
    shift.current?.(key);
  }, [key]);
  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 -z-20 size-full rounded-[inherit] opacity-0 transition-opacity duration-[var(--duration-reveal)] data-[ready]:opacity-100 ${className}`} />;
}
