import { useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { GSAP_EASE } from "./constants";

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: GSAP_EASE.out, duration: 0.5 });

export type SceneOptions = {
  loop?: boolean;
  repeatDelay?: number;
  amount?: number;
  still?: number | string;
};

export type SceneBuilder = (tl: gsap.core.Timeline, q: (selector: string) => Element[], root: HTMLElement) => void;

function reduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs a GSAP timeline scoped to a container: built once, played while the container is on screen and paused
 * when it leaves, looped if asked, killed on unmount. With reduced motion it shows one still frame: `still` (a time or
 * label) when given, else the last frame.
 */
export function useScene<T extends HTMLElement = HTMLDivElement>(build: SceneBuilder, { loop = true, repeatDelay = 1.6, amount = 0.35, still }: SceneOptions = {}, deps: unknown[] = []): RefObject<T | null> {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const q = gsap.utils.selector(root) as (selector: string) => Element[];
      const tl = gsap.timeline({ paused: true, repeat: loop ? -1 : 0, repeatDelay });
      build(tl, q, root);
      if (reduced()) {
        if (still === undefined) tl.progress(1).pause();
        else tl.seek(still, false).pause();
        return;
      }
      const watch = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? tl.play() : tl.pause()), { threshold: amount });
      watch.observe(root);
      return () => watch.disconnect();
    },
    { scope: ref, dependencies: deps },
  );
  return ref;
}

export { gsap, useGSAP };
