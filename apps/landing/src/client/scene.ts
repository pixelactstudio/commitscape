import type { gsap as Gsap } from "gsap";
import { GSAP_EASE } from "@commitscape/ui/motion/constants";

export type SceneOptions = {
  loop?: boolean;
  repeatDelay?: number;
  amount?: number;
  still?: number | string;
};

export type SceneBuilder = (tl: gsap.core.Timeline, q: (selector: string) => Element[], root: HTMLElement) => void;

export type Scene = { build: SceneBuilder; options?: SceneOptions };

let defaulted = false;

/**
 * Runs a scene's GSAP timeline on markup the server drew, as the Site's `useScene` does: played while the scene is on
 * screen and paused when it leaves, looped if asked. With reduced motion it shows one still frame: `still` (a time or
 * label) when given, else the last frame.
 */
export function runScene(gsap: typeof Gsap, root: HTMLElement, { build, options = {} }: Scene): void {
  const { loop = true, repeatDelay = 1.6, amount = 0.35, still } = options;
  if (!defaulted) {
    gsap.defaults({ ease: GSAP_EASE.out, duration: 0.5 });
    defaulted = true;
  }
  const q = gsap.utils.selector(root) as (selector: string) => Element[];
  const tl = gsap.timeline({ paused: true, repeat: loop ? -1 : 0, repeatDelay });
  build(tl, q, root);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (still === undefined) tl.progress(1).pause();
    else tl.seek(still, false).pause();
    return;
  }
  new IntersectionObserver(([entry]) => (entry?.isIntersecting ? tl.play() : tl.pause()), { threshold: amount }).observe(root);
}
