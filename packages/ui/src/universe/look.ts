import { SERIES } from "../design/tokens";

export type Rgb = [number, number, number];

type Pair = readonly [day: string, night: string];

const SKY_TOP: Pair = ["oklch(0.83 0.07 238)", "oklch(0.16 0.03 262)"];
const SKY_BOTTOM: Pair = ["oklch(0.94 0.025 222)", "oklch(0.27 0.045 255)"];
const DEEP: Pair = ["oklch(0.5 0.1 236)", "oklch(0.33 0.075 248)"];
const SHALLOW: Pair = ["oklch(0.8 0.09 195)", "oklch(0.42 0.07 215)"];
const FOAM: Pair = ["oklch(0.97 0.012 220)", "oklch(0.8 0.025 235)"];
const SEABED: Pair = ["oklch(0.62 0.045 205)", "oklch(0.45 0.05 225)"];
const SAND: Pair = ["oklch(0.885 0.032 85)", "oklch(0.47 0.022 80)"];
const FLOOR_SAND: Pair = ["oklch(0.86 0.05 88)", "oklch(0.66 0.035 200)"];
const RUIN: Pair = ["oklch(0.6 0.02 225)", "oklch(0.56 0.025 240)"];
const SUN: Pair = ["oklch(0.985 0.018 85)", "oklch(0.9 0.03 250)"];
const SKY_LIGHT: Pair = ["oklch(0.8 0.05 235)", "oklch(0.62 0.06 258)"];
const OUTLINE: Pair = ["oklch(0.99 0.02 95)", "oklch(0.97 0.04 95)"];
const SNOW: Pair = ["oklch(0.985 0.005 240)", "oklch(0.88 0.012 240)"];
const OTHER: Pair = ["oklch(0.79 0.012 269)", "oklch(0.56 0.014 267)"];
const DIM: Pair = ["oklch(0.86 0.012 240)", "oklch(0.44 0.02 255)"];
const BORDER: Pair = ["oklch(0.35 0.02 260)", "oklch(0.92 0.01 260)"];
const GLOW: Pair = ["oklch(1 0 0)", "oklch(0.86 0.14 80)"];
const GROUND: Pair = ["oklch(0.72 0.03 85)", "oklch(0.3 0.02 260)"];
const RELEASE: Pair = ["oklch(0.51 0.136 150)", "oklch(0.76 0.178 152)"];
const ROLES: readonly Pair[] = [
  ["oklch(0.66 0.1 150)", "oklch(0.58 0.11 150)"],
  ["oklch(0.6 0.03 60)", "oklch(0.5 0.03 60)"],
  ["oklch(0.78 0.1 85)", "oklch(0.68 0.11 85)"],
  ["oklch(0.9 0.03 90)", "oklch(0.78 0.03 90)"],
  ["oklch(0.62 0.08 285)", "oklch(0.56 0.1 285)"],
];
const STALE: readonly Pair[] = [
  ["oklch(0.66 0.15 150)", "oklch(0.72 0.17 152)"],
  ["oklch(0.82 0.09 120)", "oklch(0.6 0.08 140)"],
  ["oklch(0.9 0.035 225)", "oklch(0.7 0.035 232)"],
  ["oklch(0.985 0.005 240)", "oklch(0.9 0.012 240)"],
];

export const ROLE_NAMES = ["Code", "Dependencies", "Tests", "Docs", "CI"] as const;

export const STALE_NAMES = ["Touched in the last 90 days", "90 days to a year", "1 to 2 years", "Over 2 years: frozen"] as const;

export type Look = {
  night: boolean;
  css: {
    skyTop: string;
    skyBottom: string;
    sand: string;
    snow: string;
    other: string;
    seabed: string;
    roles: string[];
    stale: string[];
    languages: string[];
    slots: string[];
  };
  sky: Rgb;
  fog: Rgb;
  sun: Rgb;
  skyLight: Rgb;
  scatter: Rgb;
  absorb: Rgb;
  floor: Rgb;
  ruin: Rgb;
  outline: Rgb;
  deep: Rgb;
  shallow: Rgb;
  foam: Rgb;
  seabed: Rgb;
  sand: Rgb;
  snow: Rgb;
  other: Rgb;
  dim: Rgb;
  border: Rgb;
  glow: Rgb;
  ground: Rgb;
  release: Rgb;
  slots: Rgb[];
  roles: Rgb[];
  stale: Rgb[];
  languages: Rgb[];
};

let paint: CanvasRenderingContext2D | null = null;

function rgbOf(css: string): Rgb {
  paint ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!paint) return [0.5, 0.5, 0.5];
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = "#000";
  paint.fillStyle = css;
  paint.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = paint.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/** Works out the Atlas's look for the colour mode the page shows, reading the person colours from the design tokens as they resolve under `host`. */
export function lookOf(host: HTMLElement): Look {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  host.appendChild(probe);
  const resolve = (token: string): string => {
    probe.style.color = "";
    probe.style.color = token;
    return getComputedStyle(probe).color;
  };
  const surface = rgbOf(resolve("var(--surface)"));
  const slotsCss = SERIES.map(resolve);
  probe.remove();
  const night = surface[0] * 0.3 + surface[1] * 0.59 + surface[2] * 0.11 < 0.5;
  const pick = (p: Pair) => (night ? p[1] : p[0]);
  const languagesCss = [...slotsCss, pick(OTHER), pick(SAND)];
  const css = {
    skyTop: pick(SKY_TOP),
    skyBottom: pick(SKY_BOTTOM),
    sand: pick(SAND),
    snow: pick(SNOW),
    other: pick(OTHER),
    seabed: pick(SEABED),
    roles: ROLES.map(pick),
    stale: STALE.map(pick),
    languages: languagesCss,
    slots: slotsCss,
  };
  return {
    night,
    css,
    sky: rgbOf(pick(SKY_TOP)),
    fog: rgbOf(pick(SKY_BOTTOM)),
    sun: rgbOf(pick(SUN)),
    skyLight: rgbOf(pick(SKY_LIGHT)),
    scatter: rgbOf(pick(DEEP)),
    absorb: night ? [0.75, 0.3, 0.16] : [0.5, 0.15, 0.1],
    floor: rgbOf(pick(FLOOR_SAND)),
    ruin: rgbOf(pick(RUIN)),
    outline: rgbOf(pick(OUTLINE)),
    deep: rgbOf(pick(DEEP)),
    shallow: rgbOf(pick(SHALLOW)),
    foam: rgbOf(pick(FOAM)),
    seabed: rgbOf(pick(SEABED)),
    sand: rgbOf(pick(SAND)),
    snow: rgbOf(pick(SNOW)),
    other: rgbOf(pick(OTHER)),
    dim: rgbOf(pick(DIM)),
    border: rgbOf(pick(BORDER)),
    glow: rgbOf(pick(GLOW)),
    ground: rgbOf(pick(GROUND)),
    release: rgbOf(pick(RELEASE)),
    slots: slotsCss.map(rgbOf),
    roles: css.roles.map(rgbOf),
    stale: css.stale.map(rgbOf),
    languages: languagesCss.map(rgbOf),
  };
}
