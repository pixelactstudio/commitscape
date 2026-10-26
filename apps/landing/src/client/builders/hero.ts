import { gsap } from "gsap";
import { BEAT, DISTANCE, DURATION, GSAP_EASE } from "@commitscape/ui/motion/constants";
import { TURNS } from "../../scenes/hero";
import type { Scene } from "../scene";

const CLEAR = 14;

type Box = { cy: number; reach: number; left: number; right: number };

function boxOf(slot: HTMLElement, turn: number, still: boolean): Box {
  const w = slot.offsetWidth;
  const h = slot.offsetHeight;
  const a = still ? 0 : (Math.abs(turn) * Math.PI) / 180;
  return { cy: slot.offsetTop + h / 2, reach: (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a), left: slot.offsetLeft, right: slot.offsetLeft + w };
}

/**
 * How far a card has to travel up (negative) or down to be clear of every card drawn above it, so it can change layer
 * without passing through one.
 */
function clearance(slots: HTMLElement[], i: number): number {
  const me = slots[i];
  if (!me) return 0;
  const mine = boxOf(me, 0, true);
  let up = 0;
  let down = 0;
  slots.forEach((slot, j) => {
    if (j <= i) return;
    const other = boxOf(slot, TURNS[j] ?? 0, false);
    if (other.right <= mine.left || other.left >= mine.right) return;
    const gap = mine.reach + other.reach + CLEAR;
    if (Math.abs(mine.cy - other.cy) >= gap) return;
    if (mine.cy <= other.cy) up = Math.max(up, gap - (other.cy - mine.cy));
    else down = Math.max(down, gap - (mine.cy - other.cy));
  });
  return up >= down ? -up : down;
}

/** The cards lean toward a mouse pointer over them, each layer as far as its depth, and settle when it leaves. */
function lean(root: HTMLElement): void {
  const box = root.closest<HTMLElement>("[data-hero-box]");
  if (!box || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layers = Array.from(box.querySelectorAll<HTMLElement>("[data-hero-layer]")).map((el) => ({
    depth: Number(el.dataset.depth ?? 0),
    x: gsap.quickTo(el, "x", { duration: 0.9, ease: "power3.out" }),
    y: gsap.quickTo(el, "y", { duration: 0.9, ease: "power3.out" }),
  }));
  const to = (x: number, y: number) => layers.forEach((l) => (l.x(x * l.depth), l.y(y * l.depth)));
  box.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = box.getBoundingClientRect();
    to(0.5 - (e.clientX - r.left) / r.width, 0.5 - (e.clientY - r.top) / r.height);
  });
  box.addEventListener("pointerleave", () => to(0, 0));
}

/** One card at a time drawn out of the deck, clear of the cards above it, laid on top with where it goes, then put back. */
export const scene: Scene = {
  build: (tl, q, root) => {
    lean(root);
    const slots = q("[data-hero-slot]") as HTMLElement[];
    const cards = q("[data-hero-card]");
    const chips = q("[data-hero-chip]");
    cards.forEach((card, i) => {
      const turn = TURNS[i];
      if (turn === undefined) return;
      const chip = chips[i];
      const slot = slots[i] ?? {};
      const travel = clearance(slots, i);
      const away = travel === 0 ? -DISTANCE.rise : travel;
      const side = turn >= 0 ? DISTANCE.rise : -DISTANCE.rise;
      tl.addLabel(`pull${i}`, i === 0 ? BEAT.base : `+=${BEAT.short}`);
      tl.to(card, { y: away, x: side, rotation: 0, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `pull${i}`);
      tl.set(slot, { zIndex: TURNS.length + 1 }, ">");
      tl.to(card, { y: -DISTANCE.nudge, x: 0, rotation: turn / 3, scale: 1.03, duration: DURATION.slow, ease: GSAP_EASE.out }, ">");
      tl.to(chip ?? {}, { opacity: 1, y: 0, duration: DURATION.base, ease: GSAP_EASE.pop }, `<+${DURATION.fast}`);
      tl.to(chip ?? {}, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.fast, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.to(card, { y: away, x: side, rotation: 0, scale: 1, duration: DURATION.slow, ease: GSAP_EASE.inOut }, ">");
      tl.set(slot, { zIndex: i + 1 }, ">");
      tl.to(card, { y: 0, x: 0, rotation: turn, duration: DURATION.slow, ease: GSAP_EASE.out }, ">");
    });
  },
  options: { repeatDelay: BEAT.base, still: 0 },
};
