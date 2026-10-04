export type CardTheme = "light" | "dark";

export type Tokens = {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  brand: string;
  accent: string;
  added: string;
  removed: string;
  empty: string;
  ramp: [string, string, string, string];
  series: string[];
  other: string;
};

export const TOKENS: Record<CardTheme, Tokens> = {
  light: {
    bg: "#ffffff",
    surface: "#f6f5f1",
    border: "#e4e2dc",
    text: "#1a1a19",
    muted: "#62615c",
    faint: "#8a8984",
    brand: "#00b82b",
    accent: "#2a78d6",
    added: "#1a7f37",
    removed: "#cf222e",
    empty: "#ebeae5",
    ramp: ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"],
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"],
    other: "#a3a19b",
  },
  dark: {
    bg: "#151514",
    surface: "#1f1f1d",
    border: "#33332f",
    text: "#f2f1ec",
    muted: "#a9a8a2",
    faint: "#7d7c76",
    brand: "#00dc33",
    accent: "#3987e5",
    added: "#3fb950",
    removed: "#f85149",
    empty: "#2a2a27",
    ramp: ["#1c5cab", "#3987e5", "#86b6ef", "#cfe2fa"],
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"],
    other: "#6b6a65",
  },
};
export const CARD_DESIGN = 3;
