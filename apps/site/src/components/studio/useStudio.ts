import { useEffect, useState } from "react";
import { DEFAULT_STYLE, styleQuery, type CardStyle } from "@commitscape/ui";
import { surprise } from "./look";
import type { CardChoice, StudioState } from "./types";

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** The studio's state and what can be done to it: pick a Card or step to the next, change its style, shuffle it, reset it. */
export function useStudio(choices: CardChoice[], state: StudioState, onChange: (next: StudioState) => void) {
  const [spin, setSpin] = useState(0);
  const query = useSettled(styleQuery(state.style), 220);
  const at = Math.max(0, choices.findIndex((c) => c.id === state.card));
  return {
    choice: choices[at],
    at,
    query,
    spin,
    changed: styleQuery(state.style) !== "",
    set: (style: Partial<CardStyle>) => onChange({ ...state, style: { ...state.style, ...style } }),
    pick: (card: string) => onChange({ ...state, card }),
    step: (by: 1 | -1) => onChange({ ...state, card: choices[(at + by + choices.length) % choices.length]?.id ?? state.card }),
    mode: (mode: "light" | "dark") => onChange({ ...state, mode }),
    surprise: () => {
      onChange({ ...state, style: surprise(state.style) });
      setSpin((n) => n + 1);
    },
    reset: () => onChange({ ...state, style: DEFAULT_STYLE }),
  };
}
