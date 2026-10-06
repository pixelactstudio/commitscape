import { useRef, type PointerEvent, type ReactNode } from "react";
import { AtSign, BriefcaseBusiness, FileText } from "lucide-react";
import { Chip } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { BEAT, DISTANCE, DURATION, GSAP_EASE, motion, SPRING, useReducedMotion, useScene, useSpring, useTransform, type MotionValue } from "@commitscape/ui/motion";
import { ThemedCard } from "#/components/ThemedCard";

const CARDS = [
  { src: "/api/cards/u/gaearon/repositories", alt: "gaearon's top repositories", width: 600, height: 400, place: "top-0 right-0 w-[80%]", turn: 5, depth: 10, chip: { icon: FileText, label: "In your README" }, chipPlace: "-top-3 left-6" },
  { src: "/api/cards/u/gaearon/calendar", alt: "gaearon's last year", width: 855, height: 236, place: "top-[43%] left-0 w-[90%]", turn: -3, depth: 18, chip: { icon: BriefcaseBusiness, label: "On LinkedIn" }, chipPlace: "-top-3 right-8" },
  { src: "/api/cards/u/gaearon/totals", alt: "gaearon's totals", width: 600, height: 236, place: "bottom-0 right-[4%] w-[72%]", turn: 1.5, depth: 26, chip: { icon: AtSign, label: "In a post on X" }, chipPlace: "-bottom-3 left-8" },
];

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
    const other = boxOf(slot, CARDS[j]?.turn ?? 0, false);
    if (other.right <= mine.left || other.left >= mine.right) return;
    const gap = mine.reach + other.reach + CLEAR;
    if (Math.abs(mine.cy - other.cy) >= gap) return;
    if (mine.cy <= other.cy) up = Math.max(up, gap - (other.cy - mine.cy));
    else down = Math.max(down, gap - (mine.cy - other.cy));
  });
  return up >= down ? -up : down;
}

function Layer({ x, y, depth, children }: { x: MotionValue<number>; y: MotionValue<number>; depth: number; children: ReactNode }) {
  const tx = useTransform(x, (v) => v * depth);
  const ty = useTransform(y, (v) => v * depth);
  return <motion.div style={{ x: tx, y: ty }}>{children}</motion.div>;
}

/**
 * Real Cards made for gaearon, leaning toward the pointer. One at a time is drawn out of the deck, clear of the cards
 * above it, laid back on top and says where it goes; then it slides out again and back into its place.
 */
export function HeroCards() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const x = useSpring(0, SPRING.gentle);
  const y = useSpring(0, SPRING.gentle);
  const ref = useScene(
    (tl, q) => {
      const slots = q("[data-hero-slot]") as HTMLElement[];
      const cards = q("[data-hero-card]");
      const chips = q("[data-hero-chip]");
      cards.forEach((card, i) => {
        const c = CARDS[i];
        if (!c) return;
        const chip = chips[i];
        const slot = slots[i] ?? {};
        const travel = clearance(slots, i);
        const away = travel === 0 ? -DISTANCE.rise : travel;
        const side = c.turn >= 0 ? DISTANCE.rise : -DISTANCE.rise;
        tl.addLabel(`pull${i}`, i === 0 ? BEAT.base : `+=${BEAT.short}`);
        tl.to(card, { y: away, x: side, rotation: 0, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `pull${i}`);
        tl.set(slot, { zIndex: CARDS.length + 1 }, ">");
        tl.to(card, { y: -DISTANCE.nudge, x: 0, rotation: c.turn / 3, scale: 1.03, duration: DURATION.slow, ease: GSAP_EASE.out }, ">");
        tl.to(chip ?? {}, { opacity: 1, y: 0, duration: DURATION.base, ease: GSAP_EASE.pop }, `<+${DURATION.fast}`);
        tl.to(chip ?? {}, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.fast, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
        tl.to(card, { y: away, x: side, rotation: 0, scale: 1, duration: DURATION.slow, ease: GSAP_EASE.inOut }, ">");
        tl.set(slot, { zIndex: i + 1 }, ">");
        tl.to(card, { y: 0, x: 0, rotation: c.turn, duration: DURATION.slow, ease: GSAP_EASE.out }, ">");
      });
    },
    { repeatDelay: BEAT.base, still: 0 },
  );
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse" || !box.current) return;
    const r = box.current.getBoundingClientRect();
    x.set(0.5 - (e.clientX - r.left) / r.width);
    y.set(0.5 - (e.clientY - r.top) / r.height);
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <div ref={box} onPointerMove={move} onPointerLeave={leave} className="relative mx-auto w-full max-w-[34rem]">
      <div ref={ref} className="hero-cards relative aspect-[1.02] w-full" role="group" aria-label="Cards made for gaearon">
        {CARDS.map((c, i) => (
          <div key={c.src} data-hero-slot className={`rise absolute ${c.place}`} style={{ zIndex: i + 1, animationDelay: `${(i + 2) * 60}ms` }}>
            <Layer x={x} y={y} depth={c.depth}>
              <div data-hero-card className="hero-card relative" style={{ transform: `rotate(${c.turn}deg)` }}>
                <ThemedCard src={c.src} alt={c.alt} width={c.width} height={c.height} eager />
                <span data-hero-chip aria-hidden className={`hero-chip absolute ${c.chipPlace}`}>
                  <Chip icon={<c.chip.icon size={ICON.xs} className="text-brand" />} className="shadow-md">
                    {c.chip.label}
                  </Chip>
                </span>
              </div>
            </Layer>
          </div>
        ))}
      </div>
    </div>
  );
}
