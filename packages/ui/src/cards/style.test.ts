import { describe, expect, test } from "vitest";
import { PROFILE } from "./fixture";
import { CARDS } from "./kinds";
import { renderCard } from "./render";
import { DEFAULT_STYLE, hexOf, isOffered, lookOf, mix, parseStyle, PRESETS, styleKey, styleQuery, SWATCHES, type PresetId } from "./style";

describe("parseStyle", () => {
  test("keeps only valid choices", () => {
    expect(parseStyle(new URLSearchParams("preset=grape&accent=F97316&bg=dots&corner=square"))).toEqual({ preset: "grape", accent: "#f97316", background: "dots", corner: "square" });
    expect(parseStyle(new URLSearchParams("preset=nope&accent=red&bg=stars&corner=x"))).toEqual(DEFAULT_STYLE);
  });

  test("reads a plain object of search parameters", () => {
    expect(parseStyle({ preset: "ocean", accent: "#0ea5e9" })).toMatchObject({ preset: "ocean", accent: "#0ea5e9" });
  });
});

describe("styleQuery and styleKey", () => {
  test("leave out what is already the default", () => {
    expect(styleQuery(DEFAULT_STYLE)).toBe("");
    expect(styleKey(DEFAULT_STYLE)).toBe("");
    expect(styleQuery({ preset: "forest", accent: null, background: "dots", corner: "round" })).toBe("preset=forest");
  });

  test("round-trip through an address", () => {
    const style = { preset: "paper", accent: "#14b8a6", background: "glow", corner: "soft" } as const;
    expect(parseStyle(new URLSearchParams(styleQuery(style)))).toEqual(style);
    expect(styleKey(style)).toBe("preset-paper-accent-14b8a6-bg-glow-corner-soft");
  });
});

describe("lookOf", () => {
  test("darkens a pale accent until it reads on a light background", () => {
    const look = lookOf("light", { ...DEFAULT_STYLE, accent: "#fefefe" });
    expect(look.t.accent).not.toBe("#fefefe");
  });

  test("never gives an accent the colours Card animations mark elements with", () => {
    expect(lookOf("dark", { ...DEFAULT_STYLE, accent: "#02ff88" }).t.accent).not.toMatch(/^#0[0-3]/);
  });

  test("draws every preset and background", () => {
    for (const preset of Object.keys(PRESETS) as PresetId[]) for (const theme of ["light", "dark"] as const) expect(lookOf(theme, { ...DEFAULT_STYLE, preset }).t.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(lookOf("dark", { ...DEFAULT_STYLE, background: "grid" }).backgroundSize).toBe("24px 24px");
    expect(lookOf("dark", { ...DEFAULT_STYLE, background: "plain" }).backgroundImage).toBeUndefined();
  });
});

describe("helpers", () => {
  test("hexOf and mix", () => {
    expect(hexOf("abcdef")).toBe("#abcdef");
    expect(hexOf("#abc")).toBeNull();
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("only offered colours are worth keeping", () => {
    expect(isOffered(DEFAULT_STYLE)).toBe(true);
    expect(isOffered({ ...DEFAULT_STYLE, accent: SWATCHES[2] ?? null })).toBe(true);
    expect(isOffered({ ...DEFAULT_STYLE, accent: "#123456" })).toBe(false);
  });
});

describe("a styled Card", () => {
  test("is drawn in its accent and on its background", async () => {
    const out = await renderCard(CARDS.totals, PROFILE, "dark", { images: {}, site: "commitscape.example", style: { preset: "grape", accent: "#f97316", background: "aurora", corner: "square" } });
    expect(out.animated).toContain("#f97316");
    expect(out.animated).toContain("radialGradient");
    expect(out.still).not.toMatch(/fill="#0[123][0-9a-f]{4}"/);
  });
});
