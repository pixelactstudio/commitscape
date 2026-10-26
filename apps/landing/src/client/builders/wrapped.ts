import { gsap } from "gsap";
import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER } from "@commitscape/ui/motion/constants";
import { at, YEARS } from "../../scenes/wrapped";
import type { Scene } from "../scene";

/** A year's Wrapped: it opens on this year; then the counter rolls up from years back, the days light up and the highlights appear. */
export const scene: Scene = {
  build: (tl, q) => {
    const list = q("[data-years]")[0];
    const year = q("[data-year]")[0];
    const lit = q("[data-lit]");
    const chips = q("[data-chip]");
    if (list) gsap.set(list, { y: 0, yPercent: at(YEARS.length - 1) });
    tl.addLabel("shown", 0);
    tl.addLabel("out", BEAT.hold);
    tl.to(lit, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in, stagger: { amount: DURATION.base, from: "end" } }, "out");
    tl.to(chips, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.fast, ease: GSAP_EASE.in, stagger: STAGGER.tight }, "out");
    tl.to(year ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, "out");
    tl.set(list ?? {}, { yPercent: at(0) }, ">");
    tl.to(year ?? {}, { opacity: 1, duration: DURATION.base }, ">");
    YEARS.slice(1).forEach((_, i) => {
      const last = i === YEARS.length - 2;
      tl.to(list ?? {}, { yPercent: at(i + 1), duration: last ? DURATION.slow : DURATION.fast, ease: last ? GSAP_EASE.pop : GSAP_EASE.inOut }, i === 0 ? ">" : `+=${STAGGER.base}`);
    });
    tl.fromTo(year ?? {}, { scale: 1 }, { scale: 1.06, duration: DURATION.fast, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut, immediateRender: false }, ">");
    tl.fromTo(lit, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: DURATION.scene }, immediateRender: false }, "<");
    tl.fromTo(chips, { opacity: 0, y: DISTANCE.nudge }, { opacity: 1, y: 0, duration: DURATION.base, stagger: STAGGER.loose, immediateRender: false }, `-=${DURATION.slow}`);
  },
  options: { still: "shown", repeatDelay: 0 },
};
