import { DURATION, EASE } from "../motion/constants";

export { DURATION, EASE };

export const TYPE = {
  "2xs": { size: 12, leading: 1.3333 },
  xs: { size: 12, leading: 1.3333 },
  sm: { size: 13, leading: 1.5385 },
  base: { size: 14, leading: 1.4286 },
  md: { size: 16, leading: 1.5 },
  lg: { size: 18, leading: 1.3333 },
  xl: { size: 24, leading: 1.25 },
  "2xl": { size: 32, leading: 1.2 },
} as const;

export const MOTION = { fast: DURATION.fast * 1000, medium: DURATION.base * 1000, slow: DURATION.slow * 1000, ratio: 0.75 } as const;

export const FRAME = {
  page: 76,
  pageNarrow: 48,
  content: 80,
  header: 3.5,
  sidebar: 15.5,
  repoBar: 3,
  screenHeader: 3.5,
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
  ink: "var(--color-text-primary)",
  ink2: "var(--color-text-secondary)",
  ink3: "var(--color-text-tertiary)",
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

export const AREA_HEAT = ["var(--heat-0)", "var(--area-heat-1)", "var(--area-heat-2)", "var(--area-heat-3)", "var(--area-heat-4)"] as const;

export const STAGE_HEAT = ["var(--stage-cell-0)", "var(--stage-cell-1)", "var(--stage-cell-2)", "var(--stage-cell-3)", "var(--stage-cell-4)"] as const;

export const MEDAL = ["var(--medal-1)", "var(--medal-2)", "var(--medal-3)"] as const;

export const FLAME = ["var(--flame-1)", "var(--flame-2)", "var(--flame-3)", "var(--flame-4)", "var(--flame-5)"] as const;

/** The colour of a contribution cell for a level from 0 (nothing) to 4 (the most). */
export function heat(level: number, on: "page" | "stage" | "area" = "page"): string {
  const scale = on === "stage" ? STAGE_HEAT : on === "area" ? AREA_HEAT : HEAT;
  return scale[Math.max(0, Math.min(4, Math.round(level)))] ?? scale[0];
}

export const CHART = {
  tick: { fontSize: TYPE.xs.size, fill: "var(--color-text-secondary)" },
  grid: "var(--line)",
  cursor: "var(--surface-sunken)",
  barRadius: RADIUS.cell,
  height: { sm: 160, md: 220, lg: 280 },
} as const;
