import { describe, expect, it } from "vitest";
import { DURATION, EASE, RADIUS, SPACE, TYPE, Z } from "./tokens";
import css from "./tokens.css?raw";

const value = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("design tokens", () => {
  it("keep the type scale the same in CSS and TypeScript", () => {
    for (const [name, t] of Object.entries(TYPE)) {
      expect(value(`type-${name}`)).toBe(`${t.size / 16}rem`);
      expect(value(`type-${name}-leading`)).toBe(`${t.leading / 16}rem`);
    }
  });

  it("keep spacing, radii and layers the same in CSS and TypeScript", () => {
    for (const [name, px] of Object.entries(SPACE)) expect(value(`space-${kebab(name)}`)).toBe(`${px / 16}rem`);
    for (const [name, px] of Object.entries(RADIUS)) expect(value(`radius-${name}`)).toBe(`${px}px`);
    for (const [name, z] of Object.entries(Z)) expect(value(`z-${name}`)).toBe(`${z}`);
  });

  it("keep motion timings the same in CSS and TypeScript", () => {
    for (const name of ["instant", "fast", "base", "slow", "reveal", "scene"] as const) expect(value(`duration-${name}`)).toBe(`${Math.round(DURATION[name] * 1000)}ms`);
    expect(value("ease-out")).toBe(`cubic-bezier(${EASE.out.join(", ")})`);
    expect(value("ease-in-out")).toBe(`cubic-bezier(${EASE.inOut.join(", ")})`);
    expect(value("ease-in")).toBe(`cubic-bezier(${EASE.in.join(", ")})`);
    expect(value("ease-emphasized")).toBe(`cubic-bezier(${EASE.emphasized.join(", ")})`);
  });

  it("give every colour token a light and a dark value or a reference", () => {
    const colours = [...css.matchAll(/--((?:s|heat|green|blue|orange)-?\d|brand[a-z-]*|added|removed|ink-3|on-brand):\s*([^;]+);/g)];
    expect(colours.length).toBeGreaterThan(20);
    for (const [, , v] of colours) expect(v).toMatch(/^(light-dark\(|var\()/);
  });
});
