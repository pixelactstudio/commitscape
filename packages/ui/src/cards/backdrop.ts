import type { Background } from "./style";
import type { CardTheme } from "./tokens";

export type Backdrop = { backgroundImage: string | undefined; backgroundSize: string | undefined };

export type BackdropInput = { theme: CardTheme; background: Background; bg: string; text: string; accent: string; hues: [string, string, string]; seed: number; foil?: boolean };

const GRAINY: Background[] = ["mesh", "aurora", "holo", "grain"];
const MOVING: Background[] = ["mesh", "aurora", "glow"];

const n = (v: number) => String(Math.round(v * 10) / 10);

function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function soft(hex: string, toward: string, amount: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(toward)];
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

class Svg {
  defs: string[] = [];
  body: string[] = [];
  private next = 0;
  id() {
    return `k${this.next++}`;
  }
  radial(colour: string, opacity: number): string {
    const id = this.id();
    this.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="${opacity.toFixed(3)}"/><stop offset=".38" stop-color="${colour}" stop-opacity="${(opacity * 0.62).toFixed(3)}"/><stop offset=".7" stop-color="${colour}" stop-opacity="${(opacity * 0.2).toFixed(3)}"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`);
    return id;
  }
  linear(stops: [number, string, number][], x1 = 0, y1 = 0, x2 = 1, y2 = 1, user?: boolean): string {
    const id = this.id();
    this.defs.push(`<linearGradient id="${id}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ""}>${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a.toFixed(3)}"/>`).join("")}</linearGradient>`);
    return id;
  }
  blob(cx: number, cy: number, rx: number, ry: number, colour: string, opacity: number, rotate = 0, cls = "") {
    const id = this.radial(colour, opacity);
    this.body.push(`<ellipse${cls ? ` class="${cls}"` : ""} cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#${id})"${rotate ? ` transform="rotate(${n(rotate)} ${n(cx)} ${n(cy)})"` : ""}/>`);
  }
  done(width: number, height: number, style = ""): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${style ? `<style>${style}</style>` : ""}<defs>${this.defs.join("")}</defs>${this.body.join("")}</svg>`;
  }
}

function closed(points: [number, number][]): string {
  const p = (i: number) => points[(i + points.length) % points.length] as [number, number];
  const r = Math.round;
  let d = `M${r(p(0)[0])} ${r(p(0)[1])}`;
  for (let i = 0; i < points.length; i++) {
    const [a, b, c, e] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    d += `C${r(b[0] + (c[0] - a[0]) / 6)} ${r(b[1] + (c[1] - a[1]) / 6)} ${r(c[0] - (e[0] - b[0]) / 6)} ${r(c[1] - (e[1] - b[1]) / 6)} ${r(c[0])} ${r(c[1])}`;
  }
  return `${d}Z`;
}

function draw(input: BackdropInput, w: number, h: number): string | null {
  const { theme, background, bg, text, accent, hues, seed } = input;
  const dark = theme === "dark";
  const r = random(seed);
  const s = new Svg();
  const big = Math.max(w, h);
  const line = dark ? "#ffffff" : text;
  let style = "";
  switch (background) {
    case "plain":
      return null;
    case "glow":
      s.blob(w * 0.94, -h * 0.12, big * 0.72, h * 1.15, accent, dark ? 0.46 : 0.3, 0, "a");
      s.blob(w * 0.04, h * 1.08, big * 0.48, h * 0.75, hues[0], dark ? 0.2 : 0.16, 0, "b");
      break;
    case "gradient": {
      const g = s.linear([[0, bg, 0], [1, soft(bg, accent, dark ? 0.3 : 0.2), 1]], 0, 0, 1, 1);
      s.body.push(`<rect width="${w}" height="${h}" fill="url(#${g})"/>`);
      s.blob(w * 0.88, h * 0.95, big * 0.5, h * 0.8, hues[0], dark ? 0.2 : 0.14);
      break;
    }
    case "aurora": {
      const colours = [accent, hues[0], hues[1]];
      for (let i = 0; i < 3; i++) s.blob(w * (0.18 + 0.32 * i + (r() - 0.5) * 0.12), h * (0.08 + r() * 0.22), w * (0.34 + r() * 0.12), h * (0.2 + r() * 0.1), colours[i] ?? accent, dark ? 0.55 : 0.36, -22 + r() * 14, i % 2 ? "b" : "a");
      s.blob(w * 0.6, h * 1.05, w * 0.6, h * 0.45, hues[2], dark ? 0.22 : 0.14);
      break;
    }
    case "mesh": {
      s.body.push(`<rect width="${w}" height="${h}" fill="${soft(bg, accent, dark ? 0.1 : 0.06)}"/>`);
      const anchors: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]];
      const colours = [accent, hues[0], hues[1], hues[2], soft(accent, dark ? "#ffffff" : bg, 0.4)];
      const order = anchors.map((a, i) => ({ a, k: r(), i })).sort((x, y) => x.k - y.k);
      order.forEach(({ a }, i) => {
        const cx = (a[0] + (r() - 0.5) * 0.4) * w;
        const cy = (a[1] + (r() - 0.5) * 0.4) * h;
        s.blob(cx, cy, big * (0.42 + r() * 0.24), big * (0.32 + r() * 0.2), colours[i] ?? accent, dark ? 0.5 : 0.36, r() * 180, i % 2 ? "b" : "a");
      });
      break;
    }
    case "holo": {
      const spectrum = input.foil ? [hues[0], soft(hues[2], "#ffffff", 0.3), hues[1], accent, soft(hues[0], "#ffffff", 0.4)].map((c) => (dark ? c : soft(c, "#ffffff", 0.35))) : dark ? ["#7c3aed", "#0891b2", "#ca8a04", "#db2777", "#059669"] : ["#f9a8d4", "#a5f3fc", "#fde68a", "#c4b5fd", "#a7f3d0"];
      const at = Math.floor(r() * spectrum.length);
      const turned = [...spectrum.slice(at), ...spectrum.slice(0, at)];
      const bands = s.linear([...turned.map((c, i) => [i / (turned.length + 1), c, 1] as [number, string, number]), [1, soft(accent, dark ? bg : "#ffffff", 0.3), 1]], 0, 0.1, 1, 0.9);
      s.body.push(`<rect width="${w}" height="${h}" fill="url(#${bands})" opacity="${dark ? 0.24 : 0.55}"/>`);
      const sheen = s.linear([[0, "#ffffff", 0], [0.36, "#ffffff", 0], [0.47, "#ffffff", dark ? 0.14 : 0.75], [0.53, "#ffffff", dark ? 0.06 : 0.35], [0.62, "#ffffff", 0], [1, "#ffffff", 0]], 0, 0, 1, 1);
      s.body.push(`<rect width="${w}" height="${h}" fill="url(#${sheen})"/>`);
      const step = 6;
      const lines: string[] = [];
      for (let x = -h; x < w; x += step) lines.push(`M${n(x)} ${h}L${n(x + h)} 0`);
      s.body.push(`<path d="${lines.join("")}" stroke="${dark ? "#ffffff" : "#ffffff"}" stroke-opacity="${dark ? 0.035 : 0.35}" stroke-width=".7" fill="none"/>`);
      s.blob(w * 0.12, h * 1.0, big * 0.4, h * 0.6, accent, dark ? 0.22 : 0.16);
      break;
    }
    case "grain": {
      s.blob(w * 0.12, h * 0.05, big * 0.6, h * 0.9, dark ? hues[0] : "#ffffff", dark ? 0.12 : 0.7);
      s.blob(w * 0.95, h * 1.05, big * 0.5, h * 0.7, accent, dark ? 0.12 : 0.1);
      break;
    }
    case "topo": {
      const cx = w * (0.72 + r() * 0.3);
      const cy = h * (-0.1 + r() * 0.45);
      const phase = [r() * 6.28, r() * 6.28, r() * 6.28];
      const step = Math.max(w, h * 2) * 0.052;
      s.blob(cx, cy, step * 4, step * 3, accent, dark ? 0.3 : 0.18);
      const rings: string[] = [];
      const strong: string[] = [];
      for (let k = 1; k <= 13; k++) {
        const pts: [number, number][] = [];
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const wob = 1 + 0.11 * Math.sin(3 * a + (phase[0] ?? 0) + k * 0.18) + 0.06 * Math.sin(5 * a + (phase[1] ?? 0) - k * 0.12) + 0.03 * Math.sin(9 * a + (phase[2] ?? 0));
          const rad = step * k * wob;
          pts.push([cx + Math.cos(a) * rad * 1.25, cy + Math.sin(a) * rad]);
        }
        (k % 4 === 0 ? strong : rings).push(closed(pts));
      }
      s.body.push(`<path d="${rings.join("")}" fill="none" stroke="${line}" stroke-opacity="${dark ? 0.09 : 0.11}" stroke-width=".8"/>`);
      s.body.push(`<path d="${strong.join("")}" fill="none" stroke="${accent}" stroke-opacity="${dark ? 0.3 : 0.28}" stroke-width="1.1"/>`);
      break;
    }
    case "rings": {
      const cx = w * (0.82 + r() * 0.2);
      const cy = h * (0.85 + r() * 0.3);
      s.blob(cx, cy, big * 0.3, big * 0.3, accent, dark ? 0.4 : 0.24);
      const circles: string[] = [];
      let rad = 18;
      for (let k = 0; k < 26 && rad < big * 1.3; k++) {
        circles.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad)}" stroke-opacity="${Math.max(0.02, (dark ? 0.16 : 0.18) * (1 - rad / (big * 1.3))).toFixed(3)}"/>`);
        rad += 14 + k * 1.6;
      }
      s.body.push(`<g fill="none" stroke="${k0(dark, accent, text)}" stroke-width="1">${circles.join("")}</g>`);
      break;
    }
    case "horizon": {
      const y0 = h * 0.46;
      const vx = w * (0.38 + r() * 0.24);
      const sky = s.linear([[0, soft(bg, hues[0], dark ? 0.12 : 0.08), 1], [1, bg, 0]], 0, 0, 0, 1);
      s.body.push(`<rect width="${w}" height="${n(y0)}" fill="url(#${sky})"/>`);
      const floor = s.linear([[0, accent, 0], [1, accent, dark ? 0.14 : 0.08]], 0, y0, 0, h, true);
      s.body.push(`<rect y="${n(y0)}" width="${w}" height="${n(h - y0)}" fill="url(#${floor})"/>`);
      const fade = s.linear([[0, k0(dark, accent, text), 0], [0.35, k0(dark, accent, text), dark ? 0.12 : 0.1], [1, k0(dark, accent, text), dark ? 0.42 : 0.3]], 0, y0, 0, h, true);
      const lines: string[] = [];
      const spread = w / 9;
      for (let i = -16; i <= 16; i++) lines.push(`M${n(vx)} ${n(y0)}L${n(vx + i * spread * 2.4)} ${n(h + 40)}`);
      for (let k = 1; k <= 11; k++) {
        const y = y0 + (h + 40 - y0) * (1 / (k * 0.85 + 0.15)) * 0.95;
        if (y < h + 2) lines.push(`M0 ${n(y)}L${w} ${n(y)}`);
      }
      s.body.push(`<path d="${lines.join("")}" stroke="url(#${fade})" stroke-width="1" fill="none"/>`);
      s.blob(vx, y0, w * 0.55, h * 0.2, accent, dark ? 0.5 : 0.3);
      const edge = s.linear([[0, accent, 0], [0.5, accent, dark ? 0.7 : 0.5], [1, accent, 0]], 0, 0, 1, 0);
      s.body.push(`<rect y="${n(y0 - 0.5)}" width="${w}" height="1" fill="url(#${edge})"/>`);
      break;
    }
    case "grid":
    case "dots": {
      const id = s.id();
      const size = background === "grid" ? 24 : 14;
      const mark = background === "grid" ? `<path d="M${size} 0H0V${size}" fill="none" stroke="${line}" stroke-opacity="${dark ? 0.09 : 0.11}" stroke-width="1"/>` : `<circle cx="${size / 2}" cy="${size / 2}" r="1.1" fill="${line}" fill-opacity="${dark ? 0.26 : 0.24}"/>`;
      s.defs.push(`<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${mark}</pattern>`);
      s.body.push(`<rect width="${w}" height="${h}" fill="url(#${id})"/>`);
      const veil = s.id();
      s.defs.push(`<radialGradient id="${veil}" cx="${background === "grid" ? 0.85 : 0.15}" cy="${background === "grid" ? 0.1 : 0.9}" r="1"><stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset=".75" stop-color="${bg}" stop-opacity=".82"/><stop offset="1" stop-color="${bg}" stop-opacity="1"/></radialGradient>`);
      s.body.push(`<rect width="${w}" height="${h}" fill="url(#${veil})"/>`);
      s.blob(background === "grid" ? w * 0.85 : w * 0.15, background === "grid" ? h * 0.1 : h * 0.9, big * 0.35, h * 0.6, accent, dark ? 0.22 : 0.12);
      break;
    }
  }
  const bevel = s.linear([[0, "#ffffff", 0], [0.5, "#ffffff", dark ? 0.16 : 0.9], [1, "#ffffff", 0]], 0, 0, 1, 0);
  s.body.push(`<rect width="${w}" height="1" fill="url(#${bevel})"/>`);
  if (MOVING.includes(background)) style = `@keyframes a{50%{transform:translate(${n(w * 0.04)}px,${n(h * 0.06)}px)}}@keyframes b{50%{transform:translate(${n(-w * 0.05)}px,${n(-h * 0.05)}px)}}.a{animation:a 18s ease-in-out infinite}.b{animation:b 23s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.a,.b{animation:none}}`;
  return s.done(w, h, style);
}

function k0(dark: boolean, accent: string, text: string): string {
  return dark ? accent : soft(accent, text, 0.3);
}

const CRC = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(v: number): number[] {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

function chunk(type: string, data: number[]): number[] {
  const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat(data));
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

function stored(raw: number[]): number[] {
  const out = [0x78, 0x01];
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const part = raw.slice(i, i + 65535);
    const last = i + 65535 >= raw.length ? 1 : 0;
    out.push(last, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255, ...part);
  }
  let a = 1;
  let b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return [...out, ...u32(((b << 16) | a) >>> 0)];
}

const GRAIN = 96;

function grainPng(dark: number, light: number, seed: number): string {
  const r = random(seed);
  const raw: number[] = [];
  for (let y = 0; y < GRAIN; y++) {
    raw.push(0);
    for (let x = 0; x < GRAIN; x += 4) {
      let byte = 0;
      for (let k = 0; k < 4; k++) {
        const v = r();
        byte |= (v < 0.07 ? 0 : v > 0.93 ? 3 : 1) << (6 - 2 * k);
      }
      raw.push(byte);
    }
  }
  const png = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...u32(GRAIN), ...u32(GRAIN), 2, 3, 0, 0, 0]), ...chunk("PLTE", [0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]), ...chunk("tRNS", [dark, 0, 0, light]), ...chunk("IDAT", stored(raw)), ...chunk("IEND", [])];
  let text = "";
  for (const b of png) text += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(text)}`;
}

const tiles = new Map<string, string>();

function grainOf(theme: CardTheme, heavy: boolean): string {
  const key = `${theme}${heavy}`;
  let tile = tiles.get(key);
  if (!tile) {
    const k = heavy ? 1.8 : 1;
    tile = theme === "dark" ? grainPng(Math.round(70 * k), Math.round(26 * k), 7) : grainPng(Math.round(30 * k), Math.round(90 * k), 7);
    tiles.set(key, tile);
  }
  return tile;
}

const kept = new Map<string, Backdrop>();

/** The decoration behind a Card, for its style and size: one SVG drawn from the style's colours and seed, under a fine grain where the background has one; kept, since every Card of a style shares it. */
export function backdrop(input: BackdropInput, width: number, height: number): Backdrop {
  const key = `${input.theme}|${input.foil ? "f" : ""}|${input.background}|${input.bg}|${input.text}|${input.accent}|${input.hues.join()}|${input.seed}|${width}x${height}`;
  const found = kept.get(key);
  if (found) return found;
  const svg = draw(input, width, height);
  const layers: [string, string][] = [];
  if (GRAINY.includes(input.background)) layers.push([`url(${grainOf(input.theme, input.background === "grain")})`, `${GRAIN / 2}px ${GRAIN / 2}px`]);
  if (svg) layers.push([`url(data:image/svg+xml;base64,${btoa(svg)})`, "100% 100%"]);
  const out: Backdrop = layers.length ? { backgroundImage: layers.map((l) => l[0]).join(", "), backgroundSize: layers.map((l) => l[1]).join(", ") } : { backgroundImage: undefined, backgroundSize: undefined };
  if (kept.size > 400) kept.delete(kept.keys().next().value as string);
  kept.set(key, out);
  return out;
}
