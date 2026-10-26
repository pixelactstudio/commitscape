import { BEAT, DURATION, GSAP_EASE } from "@commitscape/ui/motion/constants";
import { DAN } from "../../scenes/data";
import { compact, whole } from "../../scenes/format";
import { count } from "../kit";
import type { Scene } from "../scene";

const STATS = [
  { value: DAN.merged, format: whole },
  { value: DAN.reviews, format: whole },
  { value: DAN.lines, format: compact },
];

/** A Profile filling in: the year empties back to grey days, then the numbers count up again as it lights up week by week. */
export const scene: Scene = {
  build: (tl, q) => {
    const lit = q("[data-lit]");
    const streak = q("[data-streak]");
    const nums = q("[data-num]");
    tl.addLabel("shown", 0);
    tl.addLabel("empty", BEAT.hold);
    tl.to(lit, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in, stagger: { amount: DURATION.slow, from: "end" } }, "empty");
    nums.forEach((el, i) => {
      const s = STATS[i];
      if (s) count(tl, el, s.value, 0, "empty", { format: s.format, duration: DURATION.slow + DURATION.base });
    });
    tl.addLabel("fill", `empty+=${DURATION.slow + DURATION.base + BEAT.short}`);
    tl.fromTo(lit, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: BEAT.long }, immediateRender: false }, "fill");
    nums.forEach((el, i) => {
      const s = STATS[i];
      if (s) count(tl, el, 0, s.value, "fill", { format: s.format, duration: BEAT.long + DURATION.base, prime: false });
    });
    tl.fromTo(streak, { scale: 1 }, { scale: 1.08, duration: DURATION.fast, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut, immediateRender: false }, `fill+=${BEAT.long}`);
  },
  options: { still: "shown", repeatDelay: 0 },
};
