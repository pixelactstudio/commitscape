/**
 * The page's colours. Each theme's series and ramps were run through the
 * palette validator against its own surface (STATE.md, Phase 19): none is
 * an automatic flip of another.
 */
import { useEffect, useState } from "react";

export const THEMES = [
  ["system", "Follow the system"],
  ["light", "Light"],
  ["dark", "Dark"],
  ["midnight", "Midnight"],
] as const;
export type Theme = (typeof THEMES)[number][0];

const STORED = "commitscape-theme";

function stored(): Theme {
  try {
    const t = localStorage.getItem(STORED);
    if (THEMES.some(([name]) => name === t)) return t as Theme;
  } catch {
    // Storage can be off, in a report opened from disk say.
  }
  return "system";
}

/** The theme chosen, kept for next time, and set on the page. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORED, theme);
    } catch {
      // As above.
    }
  }, [theme]);
  return [theme, setTheme];
}

/** A person's colour: one of eight, fixed by all-time commits, or grey. */
export function personColour(colour: number | null | undefined): string {
  return colour === null || colour === undefined ? "var(--other)" : `var(--s${colour + 1})`;
}

/** A step of a four-step ramp, weakest first. */
export function ramp(hue: "blue" | "orange", step: number): string {
  return `var(--${hue}-${Math.max(1, Math.min(4, step))})`;
}
