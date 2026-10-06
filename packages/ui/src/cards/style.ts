import { backdrop, type Backdrop } from "./backdrop";
import { TOKENS, type CardTheme, type Tokens } from "./tokens";

export type Background = "plain" | "glow" | "gradient" | "aurora" | "mesh" | "holo" | "grain" | "topo" | "rings" | "horizon" | "grid" | "dots";
export type Corner = "square" | "soft" | "round";
export type PresetId = "classic" | "midnight" | "sunset" | "forest" | "grape" | "ocean" | "mono" | "paper" | "neon" | "rose" | "arctic" | "gold";

/** How someone chose to dress their Card: a preset, and their own accent, background and corners over it. */
export type CardStyle = { preset: PresetId; accent: string | null; background: Background | null; corner: Corner | null };

type Palette = { bg: string; text: string; muted: string; faint: string; border: string; surface: string; empty: string; accent: string; hues: [string, string, string] };
type Preset = { label: string; background: Background; light: Palette; dark: Palette; foil?: boolean };

export const DEFAULT_STYLE: CardStyle = { preset: "classic", accent: null, background: null, corner: null };

export const BACKGROUNDS: { id: Background; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "glow", label: "Glow" },
  { id: "gradient", label: "Gradient" },
  { id: "aurora", label: "Aurora" },
  { id: "mesh", label: "Mesh" },
  { id: "holo", label: "Foil" },
  { id: "grain", label: "Grain" },
  { id: "topo", label: "Contours" },
  { id: "rings", label: "Ripples" },
  { id: "horizon", label: "Horizon" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dots" },
];

export const CORNERS: { id: Corner; label: string; radius: number }[] = [
  { id: "square", label: "Square", radius: 0 },
  { id: "soft", label: "Soft", radius: 12 },
  { id: "round", label: "Round", radius: 22 },
];

/** Accent colours offered as swatches; any other colour can be typed. */
export const SWATCHES = ["#12b24a", "#2a78d6", "#7c5cff", "#d946ef", "#f43f5e", "#f97316", "#eab308", "#14b8a6", "#0ea5e9", "#64748b"];

type Hues = [string, string, string];

const light = (bg: string, text: string, accent: string, hues: Hues): Palette => ({ bg, text, muted: mix(text, bg, 0.36), faint: mix(text, bg, 0.54), border: mix(text, bg, 0.87), surface: mix(text, bg, 0.955), empty: mix(text, bg, 0.92), accent, hues });
const dark = (bg: string, text: string, accent: string, hues: Hues): Palette => ({ bg, text, muted: mix(text, bg, 0.33), faint: mix(text, bg, 0.5), border: mix(text, bg, 0.85), surface: mix(text, bg, 0.94), empty: mix(text, bg, 0.89), accent, hues });

export const PRESETS: Record<PresetId, Preset> = {
  classic: { label: "Classic", background: "plain", light: light("#ffffff", "#141416", "#12a046", ["#22c55e", "#14b8a6", "#a3e635"]), dark: dark("#111214", "#f4f4f5", "#3ccf74", ["#16a34a", "#0d9488", "#65a30d"]) },
  midnight: { label: "Midnight", background: "glow", light: light("#f4f6ff", "#131a3a", "#4f6bff", ["#6366f1", "#8b5cf6", "#22d3ee"]), dark: dark("#090d1f", "#e8ecff", "#8aa2ff", ["#4f46e5", "#7c3aed", "#0891b2"]) },
  sunset: { label: "Sunset", background: "mesh", light: light("#fff7f0", "#2a1a12", "#e2560a", ["#fb923c", "#f43f5e", "#fbbf24"]), dark: dark("#170d0a", "#fff1e8", "#fb8a3c", ["#ea580c", "#e11d48", "#d97706"]) },
  forest: { label: "Forest", background: "topo", light: light("#f2f7f1", "#10200f", "#15803d", ["#22c55e", "#0d9488", "#84cc16"]), dark: dark("#07120b", "#e6f4ea", "#4ade80", ["#15803d", "#0f766e", "#4d7c0f"]) },
  grape: { label: "Grape", background: "aurora", light: light("#faf6ff", "#1f1233", "#9333ea", ["#a855f7", "#ec4899", "#6366f1"]), dark: dark("#100919", "#f3eaff", "#c084fc", ["#9333ea", "#db2777", "#4f46e5"]) },
  ocean: { label: "Ocean", background: "rings", light: light("#f0f8ff", "#0b2233", "#0273b5", ["#0ea5e9", "#14b8a6", "#6366f1"]), dark: dark("#03111b", "#e2f4ff", "#38bdf8", ["#0284c7", "#0d9488", "#4338ca"]) },
  mono: { label: "Mono", background: "dots", light: light("#ffffff", "#0a0a0a", "#0a0a0a", ["#a3a3a3", "#d4d4d4", "#737373"]), dark: dark("#0a0a0a", "#fafafa", "#fafafa", ["#525252", "#404040", "#737373"]) },
  paper: { label: "Paper", background: "grain", light: light("#f5efe3", "#2b251d", "#b45309", ["#f59e0b", "#c2410c", "#a3a35c"]), dark: dark("#1a1714", "#efe6d6", "#e2a35a", ["#b45309", "#9a3412", "#6b6b3a"]) },
  neon: { label: "Neon", background: "horizon", light: light("#f4fff8", "#06140d", "#00a862", ["#10b981", "#06b6d4", "#d946ef"]), dark: dark("#05060a", "#eafff3", "#00f593", ["#00c46f", "#06b6d4", "#c026d3"]) },
  rose: { label: "Rose", background: "glow", light: light("#fff5f7", "#2a0f18", "#e11d48", ["#fb7185", "#f97316", "#d946ef"]), dark: dark("#16080d", "#ffe8ee", "#fb7185", ["#e11d48", "#ea580c", "#c026d3"]) },
  arctic: { label: "Arctic", background: "holo", light: light("#f3f8fb", "#0d1b26", "#0884a8", ["#67e8f9", "#a5b4fc", "#6ee7b7"]), dark: dark("#071017", "#e3f3f8", "#67e8f9", ["#0e7490", "#4f46e5", "#059669"]) },
  gold: { label: "Gold", background: "holo", foil: true, light: light("#fbf8f1", "#1d1a14", "#a16207", ["#eab308", "#f59e0b", "#fde68a"]), dark: dark("#0d0c0a", "#f5efe0", "#e5b85c", ["#ca8a04", "#b45309", "#a16207"]) },
};

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T;

const RICH: Background[] = ["mesh", "mesh", "aurora", "aurora", "holo", "holo", "glow", "glow", "horizon", "topo", "rings", "grain", "gradient", "grid", "dots", "plain"];

/** A random style that looks good: any preset, often its own accent and otherwise a swatch, a background weighted toward the rich ones, and corners. */
export function randomStyle(random: () => number = Math.random): CardStyle {
  const preset = pick(Object.keys(PRESETS) as PresetId[], random);
  const accent = random() < 0.5 ? null : pick(SWATCHES.slice(0, -1), random);
  const background = pick(RICH, random);
  const corner = pick<Corner>(["square", "soft", "soft", "round", "round"], random);
  return { preset, accent, background: background === PRESETS[preset].background ? null : background, corner: corner === "round" ? null : corner };
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** A colour as #rrggbb when it is one, else null. */
export function hexOf(value: string | null | undefined): string | null {
  const m = HEX.exec(value?.trim() ?? "");
  return m ? `#${m[1]?.toLowerCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: number[]): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Two colours mixed, `amount` of the way from the first to the second. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + ((y[i] ?? v) - v) * amount));
}

/** A colour with an opacity, as CSS. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

/** A colour turned around the hue wheel by some degrees, keeping its lightness and saturation. */
export function turn(colour: string, degrees: number): string {
  const [r, g, b] = rgb(colour).map((v) => v / 255) as [number, number, number];
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
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** An accent moved toward the text colour until it reads on the background, so a pale accent on white stays visible. */
function readable(accent: string, p: Palette): string {
  let out = accent;
  for (let i = 0; i < 8 && contrast(out, p.bg) < 2.6; i++) out = mix(out, p.text, 0.18);
  return out;
}

/** The style a Card's address asks for, keeping only what is valid. */
export function parseStyle(params: URLSearchParams | Record<string, unknown>): CardStyle {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" ? v : null;
  };
  const preset = get("preset");
  const background = get("bg");
  const corner = get("corner");
  return {
    preset: preset && preset in PRESETS ? (preset as PresetId) : "classic",
    accent: hexOf(get("accent")),
    background: BACKGROUNDS.some((b) => b.id === background) ? (background as Background) : null,
    corner: CORNERS.some((c) => c.id === corner) ? (corner as Corner) : null,
  };
}

/** The style as an address's query, leaving out what is already the default. */
export function styleQuery(style: CardStyle): string {
  const q = new URLSearchParams();
  if (style.preset !== "classic") q.set("preset", style.preset);
  if (style.accent) q.set("accent", style.accent.slice(1));
  if (style.background && style.background !== PRESETS[style.preset].background) q.set("bg", style.background);
  if (style.corner && style.corner !== "round") q.set("corner", style.corner);
  return q.toString();
}

/** A short, stable name for a style, empty for the default, used to store each style's copy of a Card. */
export function styleKey(style: CardStyle): string {
  return styleQuery(style).replace(/[&=]/g, "-");
}

/** Whether a style is one of the offered ones, so its copies are worth keeping: any preset with a swatch accent or its own. */
export function isOffered(style: CardStyle): boolean {
  return !style.accent || SWATCHES.includes(style.accent);
}

export type Look = {
  t: Tokens;
  theme: CardTheme;
  background: Background;
  radius: number;
  hues: [string, string, string];
  seed: number;
  backgroundImage: string | undefined;
  backgroundSize: string | undefined;
  backdrop: (width: number, height: number) => Backdrop;
};

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The colours, background and corners a Card is drawn with, for a theme and a style. */
export function lookOf(theme: CardTheme, style: CardStyle = DEFAULT_STYLE): Look {
  const preset = PRESETS[style.preset] ?? PRESETS.classic;
  const p = preset[theme];
  const accent = readable(style.accent ?? p.accent, p).replace(/^#0[0-3]/, "#04");
  const base = TOKENS[theme];
  const ramp: Tokens["ramp"] = theme === "light" ? [mix(accent, p.bg, 0.68), mix(accent, p.bg, 0.4), accent, mix(accent, p.text, 0.35)] : [mix(accent, p.bg, 0.68), mix(accent, p.bg, 0.38), accent, mix(accent, "#ffffff", 0.45)];
  const t: Tokens = { ...base, bg: p.bg, surface: p.surface, border: p.border, text: p.text, muted: p.muted, faint: p.faint, brand: accent, accent, empty: p.empty, ramp, other: p.faint };
  const hues: [string, string, string] = style.accent && style.preset !== "mono" ? [turn(accent, 38), turn(accent, -46), turn(accent, 160)] : p.hues;
  const background = style.background ?? preset.background;
  const radius = CORNERS.find((c) => c.id === (style.corner ?? "round"))?.radius ?? 22;
  const seed = seedOf(`${style.preset}${accent}`);
  const draw = (width: number, height: number) => backdrop({ theme, background, bg: p.bg, text: p.text, accent, hues, seed, foil: !!preset.foil && !style.accent }, width, height);
  const nominal = draw(600, 300);
  return { t, theme, background, radius, hues, seed, backgroundImage: nominal.backgroundImage, backgroundSize: nominal.backgroundSize, backdrop: draw };
}
