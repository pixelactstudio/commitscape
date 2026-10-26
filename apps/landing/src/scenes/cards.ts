import type { CSSProperties } from "react";
import { DEFAULT_STYLE, lookOf, PRESETS, styleQuery, type Background, type CardStyle, type PresetId } from "@commitscape/ui/cards/style";
import { levels } from "./data";

type Theme = "light" | "dark";
export type Look = { style: CardStyle; theme: Theme };
type Step = { target: string; look: Look };

export const PRESET_IDS: PresetId[] = ["classic", "ocean", "sunset", "grape", "paper"];
export const ACCENTS = ["#12b24a", "#2a78d6", "#7c5cff", "#f43f5e", "#eab308"];
export const BACKS: Background[] = ["plain", "glow", "dots"];
const PINK = "#f43f5e";
const WEEKS = 26;
export const CELLS = levels(WEEKS * 7, 5);

export const FIRST: Look = { style: DEFAULT_STYLE, theme: "dark" };
const OCEAN: CardStyle = { ...DEFAULT_STYLE, preset: "ocean" };
const PINKED: CardStyle = { ...OCEAN, accent: PINK };
const DOTTED: CardStyle = { ...PINKED, background: "dots" };

export const FULL: Step[] = [
  { target: "[data-preset=ocean]", look: { style: OCEAN, theme: "dark" } },
  { target: `[data-accent="${PINK}"]`, look: { style: PINKED, theme: "dark" } },
  { target: "[data-back=dots]", look: { style: DOTTED, theme: "dark" } },
  { target: "[data-mode=light]", look: { style: DOTTED, theme: "light" } },
  { target: "[data-copy]", look: { style: DOTTED, theme: "light" } },
  { target: "[data-preset=classic]", look: { style: DEFAULT_STYLE, theme: "light" } },
  { target: "[data-mode=dark]", look: FIRST },
];

export const SMALL: Step[] = [
  { target: "[data-preset=ocean]", look: { style: OCEAN, theme: "dark" } },
  { target: "[data-preset=sunset]", look: { style: { ...DEFAULT_STYLE, preset: "sunset" }, theme: "dark" } },
  { target: "[data-preset=paper]", look: { style: { ...DEFAULT_STYLE, preset: "paper" }, theme: "light" } },
  { target: "[data-preset=classic]", look: FIRST },
];

/** A Card look's colours as the CSS variables the small Card reads. */
export function vars({ style, theme }: Look): Record<string, string> {
  const { t } = lookOf(theme, style);
  const ramp = t.ramp;
  return { "--c-bg": t.bg, "--c-text": t.text, "--c-muted": t.muted, "--c-accent": t.accent, "--c-border": t.border, "--c-l0": t.empty, "--c-l1": ramp[0], "--c-l2": ramp[1], "--c-l3": ramp[2], "--c-l4": ramp[3] };
}

/** A Card look's background art. */
export function art({ style, theme }: Look) {
  const look = lookOf(theme, style);
  return { backgroundImage: look.backgroundImage ?? "none", backgroundSize: look.backgroundSize ?? "auto" };
}

/** The query a Card look adds to its address. */
export function address({ style, theme }: Look) {
  const query = [theme === "dark" ? "theme=dark" : "", styleQuery(style)].filter(Boolean).join("&");
  return query ? `?${query}` : "";
}

/** A preset's swatch: its background and accent, split on the diagonal. */
export function swatch(id: PresetId): CSSProperties {
  const p = PRESETS[id].dark;
  return { background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` };
}
