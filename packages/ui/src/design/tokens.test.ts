import { describe, expect, it } from "vitest";
import { DURATION, EASE, FRAME, MOTION, RADIUS, SPACE, TYPE, Z } from "./tokens";
import css from "./tokens.css?raw";

const value = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function hexOf(oklch: string): string {
  const [l, c, h] = (oklch.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)?.slice(1) ?? []).map(Number) as [number, number, number];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return `#${linear.map((x) => Math.round(Math.max(0, Math.min(1, gamma(x))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const pair = (name: string) => value(name)?.match(/^light-dark\((oklch\([^)]*\)), (oklch\([^)]*\))\)$/)?.slice(1);

describe("design tokens", () => {
  it("keep the type scale the same in CSS and TypeScript, with unitless line heights", () => {
    for (const [name, t] of Object.entries(TYPE)) {
      expect(value(`type-${name}`)).toBe(`${t.size / 16}rem`);
      expect(value(`type-${name}-leading`)).toBe(String(t.leading));
    }
  });

  it("never set text below 12px", () => {
    for (const t of Object.values(TYPE)) expect(t.size).toBeGreaterThanOrEqual(12);
  });

  it("keep spacing, radii, layers and chrome the same in CSS and TypeScript", () => {
    for (const [name, px] of Object.entries(SPACE)) expect(value(`space-${kebab(name)}`)).toBe(`${px / 16}rem`);
    for (const [name, px] of Object.entries(RADIUS)) expect(value(`radius-${name}`)).toBe(`${px}px`);
    for (const [name, z] of Object.entries(Z)) expect(value(`z-${name}`)).toBe(`${z}`);
    expect(value("page")).toBe(`${FRAME.page}rem`);
    expect(value("page-narrow")).toBe(`${FRAME.pageNarrow}rem`);
    expect(value("content")).toBe(`${FRAME.content}rem`);
    expect(value("header-height")).toBe(`${FRAME.header}rem`);
    expect(value("sidebar-width")).toBe(`${FRAME.sidebar}rem`);
    expect(value("repo-bar-height")).toBe(`${FRAME.repoBar}rem`);
    expect(value("screen-header-height")).toBe(`${FRAME.screenHeader}rem`);
  });

  it("keep motion timings the same in CSS, TypeScript and the Astryx theme", () => {
    for (const name of ["instant", "exit", "base", "reveal", "scene"] as const) expect(value(`duration-${name}`)).toBe(`${Math.round(DURATION[name] * 1000)}ms`);
    for (const name of ["fast", "medium", "slow"]) expect(value(`duration-${name}`)).toBeUndefined();
    expect(MOTION.fast).toBe(DURATION.fast * 1000);
    expect(MOTION.slow).toBe(DURATION.slow * 1000);
    expect(DURATION.instant).toBeLessThanOrEqual(0.15);
    expect(DURATION.fast).toBeLessThanOrEqual(0.15);
    expect(value("ease-out")).toBe(`cubic-bezier(${EASE.out.join(", ")})`);
    expect(value("ease-in-out")).toBe(`cubic-bezier(${EASE.inOut.join(", ")})`);
    expect(value("ease-in")).toBe(`cubic-bezier(${EASE.in.join(", ")})`);
    expect(value("ease-emphasized")).toBe(`cubic-bezier(${EASE.emphasized.join(", ")})`);
  });

  it("give every colour token a light and a dark value or a reference", () => {
    const colours = [...css.matchAll(/--((?:s|heat|green|blue|orange)-?\d|brand[a-z-]*|added|removed|on-brand|color-(?:bg|text|border|accent|added|removed)-[a-z-]+):\s*([^;]+);/g)];
    expect(colours.length).toBeGreaterThan(50);
    for (const [, , v] of colours) expect(v).toMatch(/^(light-dark\(|var\()/);
  });

  it("keep every surface and text colour solid, on the one neutral hue", () => {
    const solid = ["bg-page", "bg-surface", "bg-raised", "bg-sunken", "bg-hover", "bg-active", "bg-inverse", "text-primary", "text-secondary", "text-tertiary", "text-disabled", "text-inverse", "border-subtle", "border-default", "border-strong"];
    for (const name of solid) {
      const both = pair(`color-${name}`);
      expect(both, name).toBeDefined();
      for (const c of both ?? []) {
        expect(c, name).not.toContain("/");
        const [, , chroma, hue] = c.match(/oklch\(([\d.]+) ([\d.]+)(?: ([\d.]+))?\)/) ?? [];
        if (Number(chroma) > 0) expect(Number(hue), name).toBe(262);
      }
    }
  });

  it("pin the brand to its exact greens", () => {
    expect(pair("color-accent-solid")?.map(hexOf)).toEqual(["#0f7a37", "#3ccf74"]);
    expect(value("color-border-focus")).toBe("var(--color-accent-solid)");
    expect(value("brand")).toBe("var(--color-accent-solid)");
  });

  it("drop the retired tokens", () => {
    for (const name of ["ink-quiet", "page-wide", "surface-2"]) expect(value(name)).toBeUndefined();
  });
});
