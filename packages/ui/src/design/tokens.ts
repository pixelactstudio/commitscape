import { DURATION, EASE } from "../motion/constants";

export { DURATION, EASE };

export const TYPE = {
  "2xs": { size: 11, leading: 16 },
  xs: { size: 12, leading: 16 },
  sm: { size: 13, leading: 20 },
  base: { size: 14, leading: 22 },
  md: { size: 15, leading: 24 },
  lg: { size: 16, leading: 24 },
  xl: { size: 20, leading: 28 },
  "2xl": { size: 26, leading: 32 },
} as const;

export const SPACE = {
  cluster: 8,
  stack: 16,
  gutter: 16,
  panel: 20,
  pageTop: 40,
  section: 48,
  band: 96,
} as const;

export const RADIUS = {
  cell: 3,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
} as const;

export const ICON = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const Z = {
  raised: 1,
  sticky: 20,
  header: 30,
  overlay: 40,
  toast: 50,
  progress: 100,
} as const;

export const COLOR = {
  ink: "var(--ink-1)",
  ink2: "var(--ink-2)",
  ink3: "var(--ink-3)",
  surface: "var(--surface)",
  line: "var(--line)",
  lineStrong: "var(--line-strong)",
  brand: "var(--brand)",
  brandSoft: "var(--brand-soft)",
  added: "var(--added)",
  removed: "var(--removed)",
  other: "var(--other)",
  sideA: "var(--side-a)",
  sideB: "var(--side-b)",
} as const;

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"] as const;

export const HEAT = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"] as const;

export const STAGE_HEAT = ["var(--stage-cell-0)", "var(--stage-cell-1)", "var(--stage-cell-2)", "var(--stage-cell-3)", "var(--stage-cell-4)"] as const;

export const MEDAL = ["var(--medal-1)", "var(--medal-2)", "var(--medal-3)"] as const;

export const FLAME = ["var(--flame-1)", "var(--flame-2)", "var(--flame-3)", "var(--flame-4)", "var(--flame-5)"] as const;

/** The colour of a contribution cell for a level from 0 (nothing) to 4 (the most). */
export function heat(level: number, on: "page" | "stage" = "page"): string {
  const scale = on === "stage" ? STAGE_HEAT : HEAT;
  return scale[Math.max(0, Math.min(4, Math.round(level)))] ?? scale[0];
}

export const CHART = {
  tick: { fontSize: TYPE["2xs"].size, fill: "var(--ink-2)" },
  grid: "var(--line)",
  cursor: "var(--surface-sunken)",
  barRadius: RADIUS.cell,
  height: { sm: 160, md: 220, lg: 280 },
} as const;
