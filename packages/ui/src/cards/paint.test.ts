import { expect, test } from "vitest";
import { animate, animatedPaint, still, STILL } from "./paint";

test("a marked element gets its colour back with its animation, and the still version has no animation", () => {
  const paint = animatedPaint();
  const bar = paint.mark("grow", "#2a78d6", 120);
  const text = paint.mark("rise", "#1a1a19", 0);
  expect(bar).toBe("#020000");
  expect(text).toBe("#010001");
  const svg = `<svg width="10" height="10"><path fill="${bar}" d="M0"/><path fill="${text}" d="M1"/><rect fill="#ffffff"/></svg>`;
  const moving = animate(svg, paint.marks);
  expect(moving).toContain('fill="#2a78d6" class="g" style="animation-delay:120ms"');
  expect(moving).toContain('fill="#1a1a19" class="r" style="animation-delay:0ms"');
  expect(moving).toMatch(/^<svg width="10" height="10"><style>@keyframes r/);
  expect(moving).toContain("prefers-reduced-motion");
  const frozen = still(svg, paint.marks);
  expect(frozen).not.toContain("class=");
  expect(frozen).toContain('fill="#2a78d6"');
  expect(STILL.mark("fill", "#abcdef", 10)).toBe("#abcdef");
});
