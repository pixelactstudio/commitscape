import satori from "satori";
import type { CardImages } from "@commitscape/data";
import { INTER } from "./fonts";
import { PendingCard, SiteCard } from "./Cards";
import type { CardSpec } from "./kinds";
import { animate, animatedPaint, still } from "./paint";
import type { CardStyle } from "./style";
import type { CardTheme } from "./tokens";

function bytes(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const text = atob(base64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;

function loaded() {
  fonts ??= [
    { name: "Inter", data: bytes(INTER[400]), weight: 400, style: "normal" },
    { name: "Inter", data: bytes(INTER[600]), weight: 600, style: "normal" },
    { name: "Inter", data: bytes(INTER[700]), weight: 700, style: "normal" },
  ];
  return fonts;
}

/** Draws a Card as SVG twice from one render: animated for READMEs, and still, ready to become a PNG. */
export async function renderCard<T>(spec: CardSpec<T>, data: T, theme: CardTheme, options: { images: CardImages; site: string; style?: CardStyle }): Promise<{ animated: string; still: string; width: number; height: number }> {
  const { width, height } = spec.size(data);
  const paint = animatedPaint();
  const svg = await satori(<spec.Card data={data} theme={theme} paint={paint} images={options.images} site={options.site} style={options.style} />, { width, height, fonts: loaded() });
  return { animated: animate(svg, paint.marks), still: still(svg, paint.marks), width, height };
}

/** The "being read" Card, as SVG. */
export function renderPending(login: string, theme: CardTheme, site: string, size: { width: number; height: number }): Promise<string> {
  return satori(<PendingCard login={login} theme={theme} site={site} {...size} />, { ...size, fonts: loaded() });
}

/** The Site's own link preview, as SVG. */
export function renderSite(theme: CardTheme, site: string): Promise<string> {
  return satori(<SiteCard theme={theme} site={site} />, { width: 1200, height: 630, fonts: loaded() });
}
