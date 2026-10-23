import { SERIES } from "../design/tokens";

export type Rgb = [number, number, number];

type Pair = readonly [day: string, night: string];

const SKY_TOP: Pair = ["oklch(0.955 0.012 230)", "oklch(0.2 0.03 262)"];
const SKY_BOTTOM: Pair = ["oklch(0.915 0.022 228)", "oklch(0.27 0.042 255)"];
const DEEP: Pair = ["oklch(0.77 0.06 228)", "oklch(0.29 0.05 252)"];
const SHALLOW: Pair = ["oklch(0.87 0.05 205)", "oklch(0.39 0.065 228)"];
const FOAM: Pair = ["oklch(0.97 0.02 210)", "oklch(0.55 0.06 220)"];
const SEABED: Pair = ["oklch(0.8 0.05 205)", "oklch(0.47 0.045 220)"];
const SAND: Pair = ["oklch(0.885 0.032 85)", "oklch(0.47 0.022 80)"];
const SNOW: Pair = ["oklch(0.985 0.005 240)", "oklch(0.88 0.012 240)"];
const OTHER: Pair = ["oklch(0.79 0.012 269)", "oklch(0.56 0.014 267)"];
const DIM: Pair = ["oklch(0.86 0.012 240)", "oklch(0.34 0.02 255)"];
const BORDER: Pair = ["oklch(0.35 0.02 260)", "oklch(0.92 0.01 260)"];
const GLOW: Pair = ["oklch(1 0 0)", "oklch(0.86 0.14 80)"];
const KEY: Pair = ["oklch(0.95 0.03 80)", "oklch(0.8 0.03 260)"];
const GROUND: Pair = ["oklch(0.7 0.03 80)", "oklch(0.2 0.02 260)"];
const RELEASE: Pair = ["oklch(0.51 0.136 150)", "oklch(0.76 0.178 152)"];
const BULK: Pair = ["oklch(0.6 0.03 240)", "oklch(0.85 0.03 230)"];
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
  key: Rgb;
  ground: Rgb;
  release: Rgb;
  bulk: Rgb;
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
    key: rgbOf(pick(KEY)),
    ground: rgbOf(pick(GROUND)),
    release: rgbOf(pick(RELEASE)),
    bulk: rgbOf(pick(BULK)),
    slots: slotsCss.map(rgbOf),
    roles: css.roles.map(rgbOf),
    stale: css.stale.map(rgbOf),
    languages: languagesCss.map(rgbOf),
  };
}
