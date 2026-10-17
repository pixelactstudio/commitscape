import { createContext, useContext } from "react";
import { dataTokenDefaults, defineTheme, generateThemeCSS, type DefinedTheme } from "@astryxdesign/core/theme";
import { defineSyntaxTheme } from "@astryxdesign/core/theme/syntax";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import { MOTION } from "./design/tokens";
import type { Mode } from "./mode";

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";


const syntax = defineSyntaxTheme({
  name: "commitscape",
  tokens: {
    keyword: ["oklch(0.48 0.17 295)", "oklch(0.76 0.12 300)"],
    string: ["oklch(0.47 0.08 185)", "oklch(0.8 0.1 185)"],
    comment: ["oklch(0.525 0.014 262)", "oklch(0.66 0.014 262)"],
    number: ["oklch(0.53 0.14 45)", "oklch(0.79 0.12 52)"],
    function: ["oklch(0.5 0.15 256)", "oklch(0.77 0.11 250)"],
    type: ["oklch(0.5 0.1 75)", "oklch(0.85 0.11 85)"],
    variable: "var(--color-text-primary)",
    operator: "var(--color-text-secondary)",
    constant: ["oklch(0.53 0.14 45)", "oklch(0.79 0.12 52)"],
    tag: ["oklch(0.5 0.18 340)", "oklch(0.77 0.13 340)"],
    attribute: ["oklch(0.5 0.1 75)", "oklch(0.85 0.11 85)"],
    property: ["oklch(0.5 0.1 228)", "oklch(0.83 0.08 228)"],
    punctuation: "var(--color-text-secondary)",
    background: "var(--color-bg-sunken)",
    added: "var(--color-added-subtle)",
    removed: "var(--color-removed-subtle)",
    "diff-header": "var(--color-bg-sunken)",
    "added-marker": "var(--color-added-text)",
    "removed-marker": "var(--color-removed-text)",
  },
});

const defined = defineTheme({
  name: "commitscape",
  extends: neutralTheme,
  color: { accent: ["#0f7a37", "#3ccf74"], neutralStyle: "cool" },
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: "InterVariable", fallbacks: SANS, weight: "normal" },
    heading: { family: "InterVariable", fallbacks: SANS, weight: "semibold", weights: { 1: "semibold", 2: "semibold", 3: "semibold", 4: "semibold", 5: "semibold", 6: "semibold" } },
    code: { family: "JetBrains Mono Variable", fallbacks: MONO, weight: "normal" },
  },
  motion: { ...MOTION, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  radius: { base: 4, multiplier: 1 },
  syntax,
  tokens: {
    "--color-background-body": "var(--color-bg-page)",
    "--color-background-surface": "var(--color-bg-surface)",
    "--color-background-card": "var(--color-bg-surface)",
    "--color-background-popover": "var(--color-bg-raised)",
    "--color-background-muted": "var(--color-bg-sunken)",
    "--color-background-inverted": "var(--color-bg-inverse)",
    "--color-neutral": "var(--color-bg-control)",
    "--color-overlay": "var(--color-bg-scrim)",
    "--color-overlay-hover": "var(--color-bg-tint-hover)",
    "--color-overlay-pressed": "var(--color-bg-tint-pressed)",
    "--color-border": "var(--color-border-subtle)",
    "--color-border-emphasized": "var(--color-border-strong)",
    "--color-skeleton": "var(--color-bg-skeleton)",
    "--color-track": "var(--color-bg-track)",
    "--color-accent": "var(--color-accent-solid)",
    "--color-accent-muted": "var(--color-accent-subtle)",
    "--color-text-accent": "var(--color-accent-text)",
    "--color-on-accent": "var(--color-text-on-accent)",
    "--color-icon-primary": "var(--color-text-primary)",
    "--color-icon-secondary": "var(--color-text-secondary)",
    "--color-icon-disabled": "var(--color-text-disabled)",
    "--color-icon-accent": "var(--color-accent-text)",
    "--color-success": "var(--color-added-text)",
    "--color-success-muted": "var(--color-added-subtle)",
    "--color-on-success": "var(--color-text-on-accent)",
    "--color-error": "var(--color-removed-text)",
    "--color-error-muted": "var(--color-removed-subtle)",
    "--color-on-error": ["oklch(1 0 0)", "oklch(0.2 0.05 20)"],
    "--color-background-gray": "var(--color-bg-active)",
    "--color-border-gray": "var(--color-border-default)",
    "--color-text-gray": "var(--color-text-secondary)",
    "--color-icon-gray": "var(--color-text-secondary)",
    "--color-on-light": "oklch(0.2 0.01 262)",
    "--color-on-dark": "oklch(0.985 0.002 262)",
    "--color-tint-hover": "var(--color-text-primary)",
    "--color-shadow": ["oklch(0 0 0 / 0.08)", "oklch(0 0 0 / 0.4)"],
    "--focus-outline-color": "var(--color-border-focus)",
    "--focus-outline-width": "2px",
    "--focus-outline-offset": "2px",
    "--shadow-low": "var(--shadow-sm)",
    "--shadow-med": "var(--shadow-md)",
    "--shadow-high": "var(--shadow-lg)",
    "--font-size-4xs": "0.75rem",
    "--font-size-3xs": "0.75rem",
    "--font-size-2xs": "0.75rem",
    "--font-size-xs": "0.75rem",
    "--font-size-sm": "0.8125rem",
    "--font-size-base": "0.875rem",
    "--font-size-lg": "1rem",
    "--font-size-xl": "1.125rem",
    "--font-size-2xl": "1.5rem",
    "--font-size-3xl": "2rem",
    "--font-size-4xl": "2.75rem",
    "--font-size-5xl": "4.5rem",
    "--text-heading-1-size": "var(--type-3xl)",
    "--text-heading-1-leading": "1.2",
    "--text-heading-2-size": "var(--font-size-xl)",
    "--text-heading-2-leading": "1.3",
    "--text-heading-3-size": "var(--font-size-lg)",
    "--text-heading-3-leading": "1.375",
    "--text-heading-4-size": "var(--font-size-base)",
    "--text-heading-4-leading": "1.4286",
    "--text-heading-5-size": "var(--font-size-sm)",
    "--text-heading-5-leading": "1.5385",
    "--text-heading-6-size": "var(--font-size-xs)",
    "--text-heading-6-leading": "1.3333",
    "--text-body-leading": "1.4286",
    "--text-label-leading": "1.4286",
    "--text-large-size": "var(--font-size-lg)",
    "--text-large-leading": "1.5",
    "--text-supporting-size": "var(--font-size-sm)",
    "--text-supporting-leading": "1.5385",
    "--text-code-size": "var(--font-size-sm)",
    "--text-code-leading": "1.5385",
    "--text-display-1-size": "var(--type-5xl)",
    "--text-display-1-weight": "var(--font-weight-semibold)",
    "--text-display-1-leading": "1.1",
    "--text-display-2-size": "var(--type-4xl)",
    "--text-display-2-weight": "var(--font-weight-semibold)",
    "--text-display-2-leading": "1.1",
    "--text-display-3-size": "var(--type-3xl)",
    "--text-display-3-weight": "var(--font-weight-semibold)",
    "--text-display-3-leading": "1.2",
  },
  components: {
    "top-nav": {
      base: { paddingBlock: "0", paddingInline: "var(--frame-inset)", minHeight: "calc(var(--header-height) - 1px)" },
    },
    button: {
      "variant:primary": {
        backgroundColor: "var(--color-bg-inverse)",
        color: "var(--color-text-inverse)",
        "--color-overlay-hover": "light-dark(oklch(1 0 0 / 0.14), oklch(0 0 0 / 0.08))",
        "--color-overlay-pressed": "light-dark(oklch(1 0 0 / 0.22), oklch(0 0 0 / 0.14))",
      },
    },
    kbd: {
      base: { backgroundColor: "var(--color-bg-sunken)", color: "var(--color-text-secondary)", boxShadow: "inset 0 0 0 1px var(--color-border-subtle)", fontFamily: "var(--font-family-code)" },
    },
    code: {
      base: { fontFeatureSettings: "normal", fontVariantLigatures: "none" },
    },
    "code-block": {
      base: { fontFeatureSettings: "normal", fontVariantLigatures: "none" },
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
