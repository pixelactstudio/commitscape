import { createContext, useContext } from "react";
import { dataTokenDefaults, defineTheme, generateThemeCSS, type DefinedTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import type { Mode } from "./mode";

const defined = defineTheme({
  name: "commitscape",
  extends: neutralTheme,
  color: { accent: ["#2a78d6", "#3987e5"], neutralStyle: "warm" },
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

export function ramp(hue: "blue" | "orange", step: number): string {
  return `var(--${hue}-${Math.max(1, Math.min(4, step))})`;
}
