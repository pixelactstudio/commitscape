import { BEAT, DURATION, GSAP_EASE } from "@commitscape/ui/motion/constants";
import { STANDING_FOCUS, STANDING_PEOPLE } from "../../scenes/data";
import { compact } from "../../scenes/format";
import { FIRST, ORDINAL, ROW, share, slots } from "../../scenes/standing";
import { count, point, press } from "../kit";
import type { Scene } from "../scene";

/** A repository's people ranked view by view: the cursor picks a view and the rows trade places. */
export const scene: Scene = {
  build: (tl, q, root) => {
    const cursor = q("[data-cursor]")[0];
    const tabs = q("[data-tab]");
    const pill = q("[data-pill]")[0];
    const rows = q("[data-row]");
    const nums = q("[data-num]");
    const bars = q("[data-bar]");
    const rank = q("[data-rank]")[0];
    const focus = STANDING_PEOPLE.findIndex((p) => p.login === STANDING_FOCUS);
    const steps = [1, 2, 0];
    let from = 0;
    tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.72, y: () => root.clientHeight * 0.9, opacity: 0 }, 0);
    steps.forEach((view, n) => {
      const at = n === 0 ? BEAT.base : `+=${BEAT.hold}`;
      point(tl, cursor, tabs[view], root, at);
      press(tl, cursor, tabs[view], ">");
      tl.addLabel(`view${view}`, ">");
      tl.to(pill ?? {}, { xPercent: view * 100, duration: DURATION.base, ease: GSAP_EASE.out }, `view${view}`);
      tl.call(() => {
        tabs.forEach((t, i) => t.toggleAttribute("data-on", i === view));
        if (rank) rank.textContent = ORDINAL[slots(view)[focus] ?? 0] ?? "";
      }, undefined, `view${view}`);
      const to = slots(view);
      rows.forEach((row, i) => {
        tl.to(row, { y: ((to[i] ?? 0) - (FIRST[i] ?? 0)) * ROW, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
        const a = STANDING_PEOPLE[i]?.values[from] ?? 0;
        const b = STANDING_PEOPLE[i]?.values[view] ?? 0;
        count(tl, nums[i], a, b, `view${view}`, { format: compact, duration: DURATION.slow, prime: false });
        tl.to(bars[i] ?? {}, { width: `${share(b, view)}%`, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
      });
      from = view;
    });
    tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
  },
  options: { still: 0 },
};
