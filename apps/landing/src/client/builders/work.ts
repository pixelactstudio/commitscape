import { BEAT, DURATION, GSAP_EASE, STAGGER } from "@commitscape/ui/motion/constants";
import { WORK } from "../../scenes/data";
import { whole } from "../../scenes/format";
import { count, point, press } from "../kit";
import type { Scene } from "../scene";

const TOTAL = WORK.reduce((n, w) => n + w.added, 0);

/** A month of merged pull requests checked off one by one, totalled, then saved as a PDF. */
export const scene: Scene = {
  build: (tl, q, root) => {
    const cursor = q("[data-cursor]")[0];
    const ticks = q("[data-tick]");
    const rows = q("[data-item]");
    const pdf = q("[data-export=PDF]")[0];
    const total = q("[data-total]")[0];
    const many = q("[data-count]")[0];
    const lines = (v: number) => `+${whole(v)}`;
    tl.addLabel("shown", 0);
    tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.3, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
    tl.addLabel("out", BEAT.long);
    tl.call(() => pdf?.toggleAttribute("data-on", false), undefined, "out");
    tl.to(ticks, { scale: 0, duration: DURATION.fast, stagger: STAGGER.tight, ease: GSAP_EASE.in }, "out");
    tl.to(rows, { opacity: 0.35, duration: DURATION.fast }, "out");
    count(tl, total, TOTAL, 0, "out", { duration: DURATION.base, format: lines, suffix: " lines" });
    count(tl, many, WORK.length, 0, "out", { duration: DURATION.base });
    tl.addLabel("in", `out+=${DURATION.base + BEAT.short}`);
    tl.to(rows, { opacity: 1, duration: DURATION.base, stagger: DURATION.slow }, "in");
    tl.fromTo(ticks, { scale: 0 }, { scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: DURATION.slow, immediateRender: false }, "in");
    count(tl, total, 0, TOTAL, "in", { duration: DURATION.slow * WORK.length, format: lines, suffix: " lines", prime: false });
    count(tl, many, 0, WORK.length, "in", { duration: DURATION.slow * WORK.length, prime: false });
    point(tl, cursor, pdf, root, `+=${BEAT.short}`);
    press(tl, cursor, pdf, ">");
    tl.call(() => pdf?.toggleAttribute("data-on", true), undefined, ">");
    tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
    tl.to({}, { duration: BEAT.hold });
  },
  options: { still: "shown", repeatDelay: 0 },
};
