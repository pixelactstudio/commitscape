import { DURATION, GSAP_EASE, BEAT, STAGGER } from "@commitscape/ui/motion/constants";
import { VERSUS } from "../../scenes/data";
import { short } from "../../scenes/format";
import { count } from "../kit";
import type { Scene } from "../scene";

/** Two people's numbers race view by view; each view gets its own winner. */
export const scene: Scene = {
  build: (tl, q) => {
    const bars = q("[data-vbar]");
    const wins = q("[data-win]");
    tl.addLabel("shown", 0);
    tl.addLabel("out", BEAT.hold);
    tl.to(bars, { scaleX: 0, duration: DURATION.base, ease: GSAP_EASE.in }, "out");
    tl.to(wins, { scale: 0, opacity: 0, duration: DURATION.fast, ease: GSAP_EASE.in }, "out");
    tl.addLabel("in", `out+=${DURATION.base}`);
    q("[data-vrow]").forEach((row, i) => {
      const r = VERSUS[i];
      if (!r) return;
      const at = `in+=${i * STAGGER.loose * 2}`;
      const pair = Array.from(row.querySelectorAll("[data-vbar]"));
      const [a, b] = Array.from(row.querySelectorAll("[data-vnum]"));
      const win = row.querySelector("[data-win]");
      count(tl, a, r.a, 0, "out", { format: short, suffix: r.unit, duration: DURATION.base });
      count(tl, b, r.b, 0, "out", { format: short, suffix: r.unit, duration: DURATION.base });
      tl.fromTo(pair, { scaleX: 0 }, { scaleX: 1, duration: DURATION.scene, ease: GSAP_EASE.out, immediateRender: false }, at);
      count(tl, a, 0, r.a, at, { format: short, suffix: r.unit, duration: DURATION.scene, prime: false });
      count(tl, b, 0, r.b, at, { format: short, suffix: r.unit, duration: DURATION.scene, prime: false });
      tl.fromTo(win ?? {}, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: DURATION.base, ease: GSAP_EASE.pop, immediateRender: false }, `${at}+=${DURATION.scene - DURATION.fast}`);
    });
  },
  options: { still: "shown", repeatDelay: 0 },
};
