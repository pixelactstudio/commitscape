import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { animate, motion, MotionConfig, useInView, useReducedMotion, type Variants } from "motion/react";
import { BLUR, DISTANCE, DURATION, EASE, SPRING, STAGGER, VIEWPORT } from "./constants";

/** Sets the Site's motion defaults and turns animation off for people who ask their system for less motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE.out }}>
      {children}
    </MotionConfig>
  );
}

const revealVariants = (y: number, blur: boolean, delay = 0): Variants => ({
  hidden: { opacity: 0, y, filter: blur ? `blur(${BLUR.reveal}px)` : "blur(0px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: DURATION.reveal, ease: EASE.out, delay } },
});

/** Fades, lifts and unblurs its children the first time they scroll into view. For content below the fold. */
export function Reveal({ children, as = "div", y = DISTANCE.rise, blur = true, delay = 0, className }: { children: ReactNode; as?: "div" | "section" | "li" | "span" | "p" | "h2"; y?: number; blur?: boolean; delay?: number; className?: string }) {
  const Tag = motion[as] as ElementType;
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={VIEWPORT} variants={revealVariants(y, blur, delay)}>
      {children}
    </Tag>
  );
}

/** Reveals its StaggerItem children one after another when the group scrolls into view. */
export function Stagger({ children, as = "div", gap = STAGGER.base, delay = 0, className }: { children: ReactNode; as?: "div" | "ul" | "ol" | "section"; gap?: number; delay?: number; className?: string }) {
  const Tag = motion[as] as ElementType;
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={VIEWPORT} variants={{ hidden: {}, shown: { transition: { staggerChildren: gap, delayChildren: delay } } }}>
      {children}
    </Tag>
  );
}

/** One member of a Stagger group. */
export function StaggerItem({ children, as = "div", y = DISTANCE.rise, blur = false, className }: { children: ReactNode; as?: "div" | "li" | "span" | "article"; y?: number; blur?: boolean; className?: string }) {
  const Tag = motion[as] as ElementType;
  return (
    <Tag className={className} variants={revealVariants(y, blur)}>
      {children}
    </Tag>
  );
}

/** A number that counts up to its value the first time it is seen, keeping its width so nothing shifts. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-US"), duration = DURATION.scene, className }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!seen || reduce) return void setShown(value);
    const controls = animate(0, value, { duration, ease: EASE.out, onUpdate: setShown });
    return () => controls.stop();
  }, [seen, reduce, value, duration]);
  return (
    <span ref={ref} className={`relative inline-grid tnum ${className ?? ""}`}>
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {format(value)}
      </span>
      <span className="col-start-1 row-start-1" aria-label={format(value)}>
        {format(shown)}
      </span>
    </span>
  );
}

/** Lifts a card slightly under the pointer and presses it on click. */
export function Lift({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  const Tag = motion[as] as ElementType;
  return (
    <Tag className={className} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }} transition={SPRING.snappy}>
      {children}
    </Tag>
  );
}

export { AnimatePresence, motion, useInView, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
