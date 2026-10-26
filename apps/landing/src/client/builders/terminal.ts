import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER } from "@commitscape/ui/motion/constants";
import { COMMITS, RUN } from "../../scenes/terminal";
import { count, type } from "../kit";
import type { Scene } from "../scene";

/** The command line at work: a run asks before it uploads, reads the history, then prints a link and opens it. */
export const scene: Scene = {
  build: (tl, q) => {
    const runText = q("[data-run]")[0];
    const told = q("[data-told]");
    const ask = q("[data-ask]")[0];
    const read = q("[data-read]")[0];
    const done = q("[data-done]")[0];
    const out = q("[data-out]");
    const first = q("[data-first]")[0];
    const second = q("[data-second]")[0];
    tl.set(first ?? {}, { opacity: 1 }, 0);
    tl.set(second ?? {}, { opacity: 0 }, 0);
    type(tl, runText, RUN, BEAT.short);
    tl.from(told, { opacity: 0, x: -DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose }, `+=${DURATION.base}`);
    tl.from(ask ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.short}`);
    tl.from(read ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.hold}`);
    count(tl, done, 0, COMMITS, "<", { duration: DURATION.scene });
    tl.addLabel("ran", `+=${DURATION.scene}`);
    tl.to(first ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
    tl.set(second ?? {}, { opacity: 1 });
    tl.from(out, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose * 3 }, `+=${DURATION.base}`);
    tl.to(second ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
  },
  options: { still: "ran" },
};
