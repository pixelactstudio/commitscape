import { lookOf, randomStyle, styleQuery, type CardStyle } from "@commitscape/ui";
import type { MeshPalette } from "@commitscape/ui/motion";

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + ((y[i] ?? v) - v) * t) as Rgb);
};

function turn(colour: string, degrees: number): string {
  const [r, g, b] = rgb(colour).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return colour;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h0 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h = (((h0 * 60 + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

/** The living backdrop a Card is shown on: the colours of its own style, deepened for dark and washed out for light. */
export function stagePalette(mode: "light" | "dark", style: CardStyle): MeshPalette {
  const { t } = lookOf(mode, style);
  const accent = t.accent;
  const other = turn(accent, 52);
  if (mode === "dark") {
    const base = mix(t.bg, "#000000", 0.4);
    return [base, mix(accent, base, 0.18), mix(other, base, 0.42), mix(mix(accent, "#ffffff", 0.4), base, 0.3)];
  }
  const base = mix(mix(t.bg, "#000000", 0.05), accent, 0.08);
  return [base, mix(accent, "#ffffff", 0.5), mix(other, "#ffffff", 0.62), mix(accent, "#ffffff", 0.78)];
}

/** A random style unlike the one shown, so Surprise me always changes something. */
export function surprise(current: CardStyle): CardStyle {
  const now = styleQuery(current);
  for (let i = 0; i < 6; i++) {
    const next = randomStyle();
    if (styleQuery(next) !== now) return next;
  }
  return randomStyle();
}
