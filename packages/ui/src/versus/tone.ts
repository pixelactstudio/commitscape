import type { CSSProperties, ReactNode } from "react";

export type Side = "a" | "b";

export const TONE: Record<Side, string> = { a: "var(--side-a)", b: "var(--side-b)" };

/** The CSS variables that colour one person's side of a Versus. */
export function toneOf(side: Side): CSSProperties {
  return { "--side": TONE[side], "--side-soft": `color-mix(in oklab, ${TONE[side]} 16%, transparent)` } as CSSProperties;
}

export type Duel = { key: string; label: ReactNode; a: number | null; b: number | null; lowerWins?: boolean; format: (n: number) => string; winner?: Side | "tie" | null; note?: ReactNode };

/** Who leads one view: the higher number, or the lower where lower is better; a tie when equal; nobody when either is unknown. */
export function winnerOf(d: Pick<Duel, "a" | "b" | "lowerWins" | "winner">): Side | "tie" | null {
  if (d.a === 0 && d.b === 0) return null;
  if (d.winner !== undefined) return d.winner;
  if (d.a === null || d.b === null) return null;
  if (d.a === d.b) return "tie";
  return (d.a > d.b) !== !!d.lowerWins ? "a" : "b";
}
