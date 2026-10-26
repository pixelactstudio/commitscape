import { BEAT, DURATION, GSAP_EASE, STAGGER } from "@commitscape/ui/motion/constants";
import { HOLDERS, NAV_PANE, ROW, STEPS } from "../../scenes/report";
import { count, point, press } from "../kit";
import type { Scene } from "../scene";

/** A repository's Report in five seconds: the cursor opens the Universe, a file in Code, the branches, then People again. */
export const scene: Scene = {
  build: (tl, q, root) => {
    const cursor = q("[data-cursor]")[0];
    const items = q("[data-item]");
    const pill = q("[data-pill]")[0];
    const panes = q("[data-pane]");
    const bars = q("[data-hbar]");
    const nums = q("[data-hnum]");
    const cells = q("[data-cell]");
    const lines = q("[data-line]");
    const branches = q("[data-branch]");
    tl.addLabel("shown", 0);
    tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.62, y: () => root.clientHeight * 0.9, opacity: 0 }, 0);
    let current = 1;
    STEPS.forEach((step, n) => {
      const at = n === 0 ? BEAT.long : `+=${BEAT.hold}`;
      const target = items[step];
      point(tl, cursor, target, root, at);
      press(tl, cursor, target, ">");
      tl.addLabel(`step${n}`, ">");
      tl.to(pill ?? {}, { y: step * ROW, duration: DURATION.base, ease: GSAP_EASE.out }, `step${n}`);
      tl.call(() => items.forEach((item, i) => item.toggleAttribute("data-on", i === step)), undefined, `step${n}`);
      const out = panes[NAV_PANE[current] ?? 0];
      const into = panes[NAV_PANE[step] ?? 0];
      tl.to(out ?? {}, { opacity: 0, duration: DURATION.fast, ease: GSAP_EASE.in }, `step${n}`);
      tl.to(into ?? {}, { opacity: 1, duration: DURATION.base, ease: GSAP_EASE.out }, `step${n}+=${DURATION.fast}`);
      if (step === 3) tl.fromTo(cells, { scaleY: 0 }, { scaleY: 1, duration: DURATION.slow, stagger: { each: STAGGER.tight / 2, from: "random" }, ease: GSAP_EASE.out, immediateRender: false }, `step${n}+=${DURATION.fast}`);
      if (step === 4) tl.fromTo(lines, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: DURATION.base, stagger: STAGGER.tight, ease: GSAP_EASE.out, immediateRender: false }, `step${n}+=${DURATION.fast}`);
      if (step === 5) tl.fromTo(branches, { scaleX: 0 }, { scaleX: 1, duration: DURATION.slow, stagger: STAGGER.base, ease: GSAP_EASE.out, immediateRender: false }, `step${n}+=${DURATION.fast}`);
      if (step === 1) {
        tl.fromTo(bars, { scaleX: 0 }, { scaleX: 1, duration: DURATION.slow, stagger: STAGGER.tight, ease: GSAP_EASE.out, immediateRender: false }, `step${n}+=${DURATION.fast}`);
        HOLDERS.forEach((h, i) => count(tl, nums[i], 0, h.lines, `step${n}+=${DURATION.fast}`, { duration: DURATION.slow, format: (v) => `${Math.round(v / 100) / 10}k`, prime: false }));
      }
      current = step;
    });
    tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
  },
  options: { still: "shown", repeatDelay: BEAT.short },
};
