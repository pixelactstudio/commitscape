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

/** The studio's state and what can be done to it: pick a Card, change its style, shuffle it, reset it. */
export function useStudio(choices: CardChoice[], state: StudioState, onChange: (next: StudioState) => void) {
  const [spin, setSpin] = useState(0);
  const query = useSettled(styleQuery(state.style), 220);
  return {
    choice: choices.find((c) => c.id === state.card) ?? choices[0],
    query,
    spin,
    changed: styleQuery(state.style) !== "",
    set: (style: Partial<CardStyle>) => onChange({ ...state, style: { ...state.style, ...style } }),
    pick: (card: string) => onChange({ ...state, card }),
    mode: (mode: "light" | "dark") => onChange({ ...state, mode }),
    surprise: () => {
      onChange({ ...state, style: surprise(state.style) });
      setSpin((n) => n + 1);
    },
    reset: () => onChange({ ...state, style: DEFAULT_STYLE }),
  };
}
