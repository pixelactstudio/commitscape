import { describe, expect, test } from "vitest";
import { CARDS } from "./kinds";
import { ACHIEVEMENT, ARCHETYPE, HALL, PROFILE, STANDING, VERSUS, WINDOW, WRAPPED } from "./fixture";
import { renderCard } from "./render";

const DATA = { totals: PROFILE, survival: PROFILE, repositories: PROFILE, calendar: PROFILE, languages: PROFILE, preview: PROFILE, standing: STANDING, "hall-of-fame": HALL, versus: VERSUS, archetype: ARCHETYPE, achievement: ACHIEVEMENT, race: WINDOW, season: WINDOW, wrapped: WRAPPED, "wrapped-calendar": WRAPPED } as const;

describe("every Card", () => {
  for (const kind of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${kind} in ${theme}`, async () => {
        const spec = CARDS[kind] as (typeof CARDS)["totals"];
        const out = await renderCard(spec, DATA[kind] as never, theme, { images: {}, site: "commitscape.example" });
        expect(out.animated.startsWith(`<svg width="${out.width}" height="${out.height}"`)).toBe(true);
        expect(out.animated).toContain("@keyframes");
        expect(out.still).not.toContain("@keyframes");
        expect(out.still).not.toMatch(/fill="#0[123][0-9a-f]{4}"/);
        await expect(out.animated).toMatchFileSnapshot(`./__snapshots__/${kind}-${theme}.svg`);
      });
    }
  }
});
