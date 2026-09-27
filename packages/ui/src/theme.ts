/**
 * The page's look (ADR-0018): one commitscape theme on Astryx, in light
 * and dark, plus "system". The charts' own colours (the eight series and
 * the two ramps, in `index.css`) were validated against each mode's surface
 * (STATE.md, Phase 19) and follow the same mode through `light-dark()`.
 */
import { useCallback, useSyncExternalStore } from "react";
import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

/**
 * commitscape's theme: Astryx's neutral one (its system fonts and Lucide
 * icons), seeded with the blue of the first series and warm greys.
 */
export const commitscapeTheme = defineTheme({
  name: "commitscape",
  extends: neutralTheme,
  color: { accent: ["#2a78d6", "#3987e5"], neutralStyle: "warm" },
});

export const MODES = [
  ["system", "Follow the system"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;
export type Mode = (typeof MODES)[number][0];

const STORED = "commitscape-theme";
const listeners = new Set<() => void>();
/** The mode chosen where storage is off, in a report opened from disk say. */
let chosen: Mode | null = null;

function read(): Mode {
  try {
    const t = localStorage.getItem(STORED);
    if (MODES.some(([name]) => name === t)) return t as Mode;
  } catch {
    // Storage can be off.
  }
  return chosen ?? "system";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The mode chosen, kept for next time. Astryx's Theme sets it on the page.
 * A page written ahead of time (the Site's) is drawn as "system" and then
 * switched, so what is drawn first matches what was written.
 */
export function useMode(): [Mode, (m: Mode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => "system" as Mode);
  const set = useCallback((m: Mode) => {
    chosen = m;
    try {
      localStorage.setItem(STORED, m);
    } catch {
      // As above.
    }
    for (const l of listeners) l();
  }, []);
  return [mode, set];
}

/** A person's colour: one of eight, fixed by all-time commits, or grey. */
export function personColour(colour: number | null | undefined): string {
  return colour === null || colour === undefined ? "var(--other)" : `var(--s${colour + 1})`;
}

/** A step of a four-step ramp, weakest first. */
export function ramp(hue: "blue" | "orange", step: number): string {
  return `var(--${hue}-${Math.max(1, Math.min(4, step))})`;
}
