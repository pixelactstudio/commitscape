import { lookOf } from "@commitscape/ui/cards/style";
import { BEAT, DURATION, GSAP_EASE } from "@commitscape/ui/motion/constants";
import { address, art, FULL, SMALL, vars, type Look } from "../../scenes/cards";
import { point, press } from "../kit";
import type { Scene } from "../scene";

function visible(q: (s: string) => Element[], selector: string) {
  return q(selector).find((el) => (el as HTMLElement).offsetParent !== null);
}

/** The Card studio at work: the cursor picks a preset, an accent, a background and a theme; the Card and its address follow. */
export const scene: Scene = {
  build: (tl, q, root) => {
    const cursor = q("[data-cursor]")[0];
    const card = q("[data-card]")[0] as HTMLElement | undefined;
    const glow = q("[data-glow]")[0] as HTMLElement | undefined;
    const query = q("[data-query]")[0];
    const copy = q("[data-copy]")[0];
    const full = !!visible(q, "[data-accent]");
    const dress = (look: Look) => {
      if (!card) return;
      for (const [k, v] of Object.entries(vars(look))) card.style.setProperty(k, v);
      if (glow) Object.assign(glow.style, art(look));
      if (query) query.textContent = address(look).replaceAll("&", "​&");
      const back = lookOf(look.theme, look.style).background;
      q("[data-preset]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-preset") === look.style.preset));
      q("[data-accent]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-accent") === look.style.accent));
      q("[data-back]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-back") === back));
      q("[data-mode]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-mode") === look.theme));
    };
    tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.5, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
    (full ? FULL : SMALL).forEach((step, i) => {
      const target = visible(q, step.target);
      if (!target) return;
      point(tl, cursor, target, root, i === 0 ? BEAT.base : `+=${BEAT.base}`);
      press(tl, cursor, target, ">");
      if (target === copy) {
        tl.call(() => copy?.toggleAttribute("data-on", true), undefined, ">");
        tl.call(() => copy?.toggleAttribute("data-on", false), undefined, `+=${BEAT.long}`);
        return;
      }
      tl.to(glow ?? {}, { opacity: 0, duration: DURATION.fast }, "<");
      tl.call(() => dress(step.look), undefined, ">");
      tl.to(glow ?? {}, { opacity: 1, duration: DURATION.slow }, ">");
    });
    tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.short}`);
  },
  options: { still: 0, repeatDelay: BEAT.base },
};
