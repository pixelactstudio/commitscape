import { useCallback, useSyncExternalStore } from "react";
import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

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
let chosen: Mode | null = null;

function read(): Mode {
  try {
    const t = localStorage.getItem(STORED);
    if (MODES.some(([name]) => name === t)) return t as Mode;
  } catch {
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

export function useMode(): [Mode, (m: Mode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => "system" as Mode);
  const set = useCallback((m: Mode) => {
    chosen = m;
    try {
      localStorage.setItem(STORED, m);
    } catch {
    }
    for (const l of listeners) l();
  }, []);
  return [mode, set];
}

export function personColour(colour: number | null | undefined): string {
  return colour === null || colour === undefined ? "var(--other)" : `var(--s${colour + 1})`;
}

export function ramp(hue: "blue" | "orange", step: number): string {
  return `var(--${hue}-${Math.max(1, Math.min(4, step))})`;
}
