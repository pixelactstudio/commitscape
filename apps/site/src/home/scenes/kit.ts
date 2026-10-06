import { DURATION, GSAP_EASE, TYPING } from "@commitscape/ui/motion";

type Timeline = gsap.core.Timeline;
type Position = gsap.Position;

export const whole = (n: number) => Math.round(n).toLocaleString("en-US");

export const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n)}`);

/**
 * Counts an element's text from one number to another, showing the first number from the start unless `prime` is
 * false; returns a call that puts the first number back.
 */
export function count(tl: Timeline, el: Element | undefined, from: number, to: number, at: Position, { duration = DURATION.scene, format = whole, suffix = "", prime = true }: { duration?: number; format?: (n: number) => string; suffix?: string; prime?: boolean } = {}) {
  if (!el) return () => {};
  const box = { v: from };
  const write = () => {
    el.textContent = `${format(box.v)}${suffix}`;
  };
  tl.fromTo(box, { v: from }, { v: to, duration, ease: GSAP_EASE.out, onUpdate: write, immediateRender: false }, at);
  if (prime) write();
  return () => {
    box.v = from;
    write();
  };
}

/** Types text into an element one character at a time; the element starts empty. */
export function type(tl: Timeline, el: Element | undefined, text: string, at: Position) {
  if (!el) return;
  const box = { n: 0 };
  el.textContent = "";
  tl.fromTo(
    box,
    { n: 0 },
    {
      n: text.length,
      duration: text.length * TYPING.char,
      ease: "none",
      immediateRender: false,
      onUpdate: () => {
        el.textContent = text.slice(0, Math.round(box.n));
      },
    },
    at,
  );
}

function centre(el: Element, root: Element) {
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
}

/** Glides the scene's cursor to the middle of an element, measured when the move starts. */
export function point(tl: Timeline, cursor: Element | undefined, target: Element | undefined, root: Element | null, at: Position) {
  if (!cursor || !target || !root) return;
  tl.to(cursor, { x: () => centre(target, root).x, y: () => centre(target, root).y, opacity: 1, duration: DURATION.slow, ease: GSAP_EASE.inOut }, at);
}

/** The cursor presses and the element under it gives a little. */
export function press(tl: Timeline, cursor: Element | undefined, target: Element | undefined, at: Position) {
  if (!cursor || !target) return;
  tl.to(cursor, { scale: 0.82, duration: DURATION.instant, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut }, at);
  tl.to(target, { scale: 0.94, duration: DURATION.instant, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut }, "<");
}
