import { createContext, useContext } from "react";
import { dataTokenDefaults, defineTheme, generateThemeCSS, type DefinedTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import type { Mode } from "./mode";

const INK = "light-dark(#0c0d0f, #f4f4f5)";
const PAPER = "light-dark(#ffffff, #0c0d0f)";

const defined = defineTheme({
  name: "commitscape",
  extends: neutralTheme,
  color: { accent: ["#0f7a37", "#3ccf74"], neutralStyle: "neutral" },
  typography: {
    scale: { base: 15, ratio: 1.25 },
    body: { family: "Inter Variable", fallbacks: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    heading: { family: "Inter Variable", fallbacks: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    code: { family: "ui-monospace", fallbacks: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" },
  },
  radius: { base: 4, multiplier: 1.25 },
  tokens: {
    "--color-background-body": ["#f6f6f4", "#08090b"],
    "--color-background-surface": ["#ffffff", "#101114"],
    "--color-background-card": ["#ffffff", "#101114"],
    "--color-background-popover": ["#ffffff", "#16181c"],
    "--color-background-muted": ["#0c0d0f0a", "#ffffff0d"],
    "--color-border": ["#0c0d0f14", "#ffffff14"],
    "--color-border-emphasized": ["#0c0d0f29", "#ffffff2b"],
    "--color-text-primary": ["#0c0d0f", "#f4f4f5"],
    "--color-text-secondary": ["#5d6068", "#9b9ea6"],
    "--color-text-disabled": ["#868990", "#7d8088"],
    "--color-skeleton": ["#0c0d0f12", "#ffffff12"],
    "--color-track": ["#0c0d0f14", "#ffffff17"],
  },
  components: {
    button: {
      "variant:primary": { backgroundColor: INK, color: PAPER },
    },
  },
});

/** The theme as written into the page by the server, so Astryx never injects it after hydration. */
export const commitscapeTheme: DefinedTheme = { ...defined, __built: true };

/** The theme's CSS, in the layers Astryx would inject it into, for a `<style>` in the page's head. */
export function themeCss(): string {
  const { prose, component } = generateThemeCSS(defined);
  const defaults = Object.entries(dataTokenDefaults)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join("\n");
  return [`@layer astryx-base {\n:root {\n${defaults}\n}\n}`, prose && `@layer reset {\n${prose}\n}`, component && `@layer astryx-theme {\n${component}\n}`]
    .filter(Boolean)
    .join("\n");
}

export { MODE_COOKIE, MODES, modeOf, type Mode } from "./mode";

export const ModeContext = createContext<[Mode, (m: Mode) => void]>(["system", () => {}]);

/** The colour mode chosen, kept in a cookie so the server draws the page in it. */
export function useMode(): [Mode, (m: Mode) => void] {
  return useContext(ModeContext);
}

export function personColour(colour: number | null | undefined): string {
  return colour === null || colour === undefined ? "var(--other)" : `var(--s${colour + 1})`;
}

export function ramp(hue: "blue" | "orange" | "green", step: number): string {
  return `var(--${hue}-${Math.max(1, Math.min(4, step))})`;
}
