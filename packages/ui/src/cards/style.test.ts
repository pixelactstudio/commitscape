import { describe, expect, test } from "vitest";
import { PROFILE } from "./fixture";
import { CARDS } from "./kinds";
import { renderCard } from "./render";
import { BACKGROUNDS, CORNERS, DEFAULT_STYLE, hexOf, isOffered, lookOf, mix, parseStyle, PRESETS, randomStyle, styleKey, styleQuery, SWATCHES, turn, type PresetId } from "./style";

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
    expect(styleQuery({ preset: "forest", accent: null, background: "topo", corner: "round" })).toBe("preset=forest");
    expect(styleQuery({ preset: "forest", accent: null, background: "dots", corner: "round" })).toBe("preset=forest&bg=dots");
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
    for (const b of BACKGROUNDS) {
      if (b.id === "plain") continue;
      const look = lookOf("dark", { ...DEFAULT_STYLE, background: b.id });
      expect(look.backgroundImage).toMatch(/^url\(data:image\/(svg\+xml|png);base64,/);
      expect(look.backgroundImage?.split("url(").length).toBe(look.backgroundSize?.split(",").length ? (look.backgroundSize?.split(",").length ?? 0) + 1 : 0);
    }
    expect(lookOf("dark", { ...DEFAULT_STYLE, background: "plain" }).backgroundImage).toBeUndefined();
  });

  test("draws a background once for a style and size, and keeps it small", () => {
    const look = lookOf("light", { ...DEFAULT_STYLE, preset: "sunset", background: "mesh" });
    expect(look.backdrop(600, 236)).toBe(look.backdrop(600, 236));
    expect(look.backdrop(600, 236).backgroundImage?.length).toBeLessThan(12_000);
    expect(lookOf("light", { ...DEFAULT_STYLE, background: "topo" }).backdrop(600, 236).backgroundImage?.length).toBeLessThan(16_000);
  });

  test("gives a custom accent its own neighbouring hues", () => {
    expect(lookOf("dark", { ...DEFAULT_STYLE, accent: "#f97316" }).hues[0]).toBe(turn(lookOf("dark", { ...DEFAULT_STYLE, accent: "#f97316" }).t.accent, 38));
    expect(turn("#808080", 90)).toBe("#808080");
  });
});

describe("randomStyle", () => {
  test("always gives a valid style that survives its own address", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const style = randomStyle(random);
      expect(style.preset in PRESETS).toBe(true);
      expect(style.accent === null || SWATCHES.includes(style.accent)).toBe(true);
      expect(style.background === null || BACKGROUNDS.some((b) => b.id === style.background)).toBe(true);
      expect(style.background).not.toBe(PRESETS[style.preset].background);
      expect(style.corner === null || CORNERS.some((c) => c.id === style.corner)).toBe(true);
      expect(isOffered(style)).toBe(true);
      expect(parseStyle(new URLSearchParams(styleQuery(style)))).toEqual(style);
      seen.add(styleQuery(style));
    }
    expect(seen.size).toBeGreaterThan(150);
  });

  test("takes the edges of its random numbers", () => {
    expect(randomStyle(() => 0).preset).toBe("classic");
    expect(randomStyle(() => 0.999999).preset).toBe("gold");
  });
});

describe("old addresses", () => {
  test("still draw as the style they asked for", () => {
    for (const q of ["preset=grape&accent=f97316&bg=dots", "preset=paper&bg=glow&corner=soft", "preset=neon&bg=grid", "preset=midnight&bg=aurora&corner=square", "bg=gradient"]) {
      const style = parseStyle(new URLSearchParams(q));
      expect(new URLSearchParams(styleQuery(style)).toString()).toBe(new URLSearchParams(q).toString());
      expect(lookOf("dark", style).t.bg).toMatch(/^#[0-9a-f]{6}$/);
    }
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
    expect(out.animated).toContain("data:image/svg+xml;base64,");
    expect(out.still).not.toMatch(/fill="#0[123][0-9a-f]{4}"/);
  });
});
