import { useRef, type PointerEvent, type ReactNode } from "react";
import { AtSign, BriefcaseBusiness, FileText } from "lucide-react";
import { BEAT, DISTANCE, DURATION, GSAP_EASE, motion, SPRING, useReducedMotion, useScene, useSpring, useTransform, type MotionValue } from "@commitscape/ui/motion";
import { ThemedCard } from "#/components/ThemedCard";

const CARDS = [
  { src: "/api/cards/u/gaearon/repositories", alt: "gaearon's top repositories", width: 600, height: 400, place: "top-[3%] right-0 w-[80%]", turn: 5, depth: 10, chip: { icon: FileText, label: "In your README" }, chipPlace: "-top-3 left-6" },
  { src: "/api/cards/u/gaearon/calendar", alt: "gaearon's last year", width: 855, height: 236, place: "top-[41%] left-0 w-[90%]", turn: -3, depth: 18, chip: { icon: BriefcaseBusiness, label: "On LinkedIn" }, chipPlace: "-top-3 right-8" },
  { src: "/api/cards/u/gaearon/totals", alt: "gaearon's totals", width: 600, height: 236, place: "bottom-[1%] right-[4%] w-[72%]", turn: 1.5, depth: 26, chip: { icon: AtSign, label: "In a post on X" }, chipPlace: "-bottom-3 left-8" },
];

function Layer({ x, y, depth, children }: { x: MotionValue<number>; y: MotionValue<number>; depth: number; children: ReactNode }) {
  const tx = useTransform(x, (v) => v * depth);
  const ty = useTransform(y, (v) => v * depth);
  return <motion.div style={{ x: tx, y: ty }}>{children}</motion.div>;
}

/** Real Cards made for gaearon, leaning toward the pointer; one at a time steps forward and says where it goes. */
export function HeroCards() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const x = useSpring(0, SPRING.gentle);
  const y = useSpring(0, SPRING.gentle);
  const ref = useScene(
    (tl, q) => {
      const slots = q("[data-hero-slot]");
      const cards = q("[data-hero-card]");
      const chips = q("[data-hero-chip]");
      cards.forEach((card, i) => {
        const turn = CARDS[i]?.turn ?? 0;
        const chip = chips[i];
        const at = i === 0 ? BEAT.base : `+=${BEAT.short}`;
        tl.set(slots[i] ?? {}, { zIndex: CARDS.length + 1 }, at);
        tl.to(card, { y: -DISTANCE.rise, rotation: turn / 3, scale: 1.035, duration: DURATION.slow, ease: GSAP_EASE.out }, "<");
        tl.to(chip ?? {}, { opacity: 1, y: 0, duration: DURATION.base, ease: GSAP_EASE.pop }, `<+${DURATION.fast}`);
        tl.to(chip ?? {}, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.fast, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
        tl.to(card, { y: 0, rotation: turn, scale: 1, duration: DURATION.slow, ease: GSAP_EASE.inOut }, "<");
        tl.set(slots[i] ?? {}, { zIndex: i + 1 }, ">");
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
                <span data-hero-chip aria-hidden className={`hero-chip absolute ${c.chipPlace} inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--color-background-surface)] px-2.5 py-1 text-[0.72rem] font-medium whitespace-nowrap text-primary shadow-[var(--shadow-med)]`}>
                  <c.chip.icon size={12} className="text-brand" />
                  {c.chip.label}
                </span>
              </div>
            </Layer>
          </div>
        ))}
      </div>
    </div>
  );
}
