import { TOKENS, type CardTheme, type Tokens } from "./tokens";

export type Background = "plain" | "glow" | "gradient" | "aurora" | "grid" | "dots";
export type Corner = "square" | "soft" | "round";
export type PresetId = "classic" | "midnight" | "sunset" | "forest" | "grape" | "ocean" | "mono" | "paper" | "neon";

/** How someone chose to dress their Card: a preset, and their own accent, background and corners over it. */
export type CardStyle = { preset: PresetId; accent: string | null; background: Background | null; corner: Corner | null };

type Palette = { bg: string; text: string; muted: string; faint: string; border: string; surface: string; empty: string; accent: string };
type Preset = { label: string; background: Background; light: Palette; dark: Palette };

export const DEFAULT_STYLE: CardStyle = { preset: "classic", accent: null, background: null, corner: null };

export const BACKGROUNDS: { id: Background; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "glow", label: "Glow" },
  { id: "gradient", label: "Gradient" },
  { id: "aurora", label: "Aurora" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dots" },
];

export const CORNERS: { id: Corner; label: string; radius: number }[] = [
  { id: "square", label: "Square", radius: 0 },
  { id: "soft", label: "Soft", radius: 10 },
  { id: "round", label: "Round", radius: 20 },
];

/** Accent colours offered as swatches; any other colour can be typed. */
export const SWATCHES = ["#12b24a", "#2a78d6", "#7c5cff", "#d946ef", "#f43f5e", "#f97316", "#eab308", "#14b8a6", "#0ea5e9", "#64748b"];

const light = (bg: string, text: string, accent: string, over: Partial<Palette> = {}): Palette => ({ bg, text, muted: mix(text, bg, 0.38), faint: mix(text, bg, 0.55), border: mix(text, bg, 0.88), surface: mix(text, bg, 0.95), empty: mix(text, bg, 0.91), accent, ...over });
const dark = (bg: string, text: string, accent: string, over: Partial<Palette> = {}): Palette => ({ bg, text, muted: mix(text, bg, 0.35), faint: mix(text, bg, 0.52), border: mix(text, bg, 0.86), surface: mix(text, bg, 0.94), empty: mix(text, bg, 0.9), accent, ...over });

export const PRESETS: Record<PresetId, Preset> = {
  classic: { label: "Classic", background: "plain", light: light("#ffffff", "#141416", "#12a046"), dark: dark("#111214", "#f4f4f5", "#3ccf74") },
  midnight: { label: "Midnight", background: "glow", light: light("#f5f7ff", "#141a33", "#4f6bff"), dark: dark("#0b1020", "#e8ecff", "#8aa2ff") },
  sunset: { label: "Sunset", background: "gradient", light: light("#fff8f1", "#2a1a12", "#ea580c"), dark: dark("#1a0f0b", "#fff1e8", "#fb8a3c") },
  forest: { label: "Forest", background: "dots", light: light("#f3f8f3", "#122016", "#15803d"), dark: dark("#08130c", "#e6f4ea", "#4ade80") },
  grape: { label: "Grape", background: "aurora", light: light("#faf6ff", "#1f1233", "#9333ea"), dark: dark("#120a1f", "#f3eaff", "#c084fc") },
  ocean: { label: "Ocean", background: "glow", light: light("#f1f9ff", "#0c2233", "#0284c7"), dark: dark("#04121c", "#e2f4ff", "#38bdf8") },
  mono: { label: "Mono", background: "plain", light: light("#ffffff", "#0a0a0a", "#0a0a0a"), dark: dark("#0a0a0a", "#fafafa", "#fafafa") },
  paper: { label: "Paper", background: "grid", light: light("#f6f1e7", "#2b251d", "#b45309"), dark: dark("#1b1916", "#efe6d6", "#e2a35a") },
  neon: { label: "Neon", background: "grid", light: light("#f6fff9", "#06140d", "#00a862"), dark: dark("#050505", "#eafff3", "#00f593") },
};

const HEX = /^#?([0-9a-f]{6})$/i;

/** A colour as #rrggbb when it is one, else null. */
export function hexOf(value: string | null | undefined): string | null {
  const m = HEX.exec(value?.trim() ?? "");
  return m ? `#${m[1]?.toLowerCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Two colours mixed, `amount` of the way from the first to the second. */
export function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
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

export type Look = { t: Tokens; background: Background; radius: number; backgroundImage: string | undefined; backgroundSize: string | undefined };

/** The colours, background and corners a Card is drawn with, for a theme and a style. */
export function lookOf(theme: CardTheme, style: CardStyle = DEFAULT_STYLE): Look {
  const preset = PRESETS[style.preset] ?? PRESETS.classic;
  const p = preset[theme];
  const accent = readable(style.accent ?? p.accent, p).replace(/^#0[0-3]/, "#04");
  const base = TOKENS[theme];
  const ramp: Tokens["ramp"] = theme === "light" ? [mix(accent, p.bg, 0.6), mix(accent, p.bg, 0.3), accent, mix(accent, p.text, 0.35)] : [mix(accent, p.bg, 0.65), mix(accent, p.bg, 0.35), accent, mix(accent, p.text, 0.45)];
  const t: Tokens = { ...base, bg: p.bg, surface: p.surface, border: p.border, text: p.text, muted: p.muted, faint: p.faint, brand: accent, accent, empty: p.empty, ramp, other: p.faint };
  const background = style.background ?? preset.background;
  const radius = CORNERS.find((c) => c.id === (style.corner ?? "round"))?.radius ?? 20;
  const glow = (a: number) => `${accent}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
  const second = theme === "light" ? mix(accent, "#3b82f6", 0.6) : mix(accent, "#60a5fa", 0.6);
  const images: Record<Background, [string | undefined, string | undefined]> = {
    plain: [undefined, undefined],
    glow: [`radial-gradient(circle at 100% 0%, ${glow(theme === "light" ? 0.2 : 0.28)} 0%, ${glow(0)} 55%)`, undefined],
    gradient: [`linear-gradient(135deg, ${p.bg} 0%, ${mix(p.bg, accent, theme === "light" ? 0.14 : 0.2)} 100%)`, undefined],
    aurora: [`radial-gradient(circle at 0% 100%, ${glow(theme === "light" ? 0.22 : 0.32)} 0%, ${glow(0)} 50%), radial-gradient(circle at 100% 0%, ${second}${theme === "light" ? "33" : "4d"} 0%, ${second}00 50%)`, undefined],
    grid: [`linear-gradient(${mix(p.text, p.bg, 0.93)} 1px, transparent 1px), linear-gradient(90deg, ${mix(p.text, p.bg, 0.93)} 1px, transparent 1px)`, "24px 24px"],
    dots: [`radial-gradient(circle, ${mix(p.text, p.bg, 0.78)} 1px, transparent 1.6px)`, "16px 16px"],
  };
  const [backgroundImage, backgroundSize] = images[background];
  return { t, background, radius, backgroundImage, backgroundSize };
}
