import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { SPRING } from "./constants";

const LINES = ["Nothing to count here yet.", "Still nothing. Poke me again?", "I checked twice. Empty.", "Okay, you win: here is a jump."];

function Blob({ onPoke, mood }: { onPoke: () => void; mood: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const eyeX = useSpring(x, SPRING.snappy);
  const eyeY = useSpring(y, SPRING.snappy);
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      const d = Math.max(1, Math.hypot(dx, dy));
      x.set((dx / d) * Math.min(4, d / 40));
      y.set((dy / d) * Math.min(3, d / 40));
    };
    const timer = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
    }, 3800);
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      window.clearInterval(timer);
    };
  }, [reduce, x, y]);
  const eye = (
    <motion.span className="block h-2.5 w-2 rounded-full bg-[#08090b]" style={{ x: eyeX, y: eyeY }} animate={{ scaleY: blink ? 0.1 : 1 }} transition={{ duration: 0.08 }} />
  );
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label="Poke the mascot"
      onClick={onPoke}
      className="relative grid size-14 cursor-pointer place-items-center rounded-[18px] border-0 bg-brand p-0 shadow-[0_10px_30px_-10px_var(--brand),inset_0_-4px_0_rgb(0_0_0/0.18)]"
      animate={reduce ? undefined : mood === LINES.length - 1 ? { y: [0, -26, 0], rotate: [0, 360] } : { y: [0, -3, 0] }}
      transition={mood === LINES.length - 1 ? { duration: 0.7, ease: "easeOut" } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      whileTap={{ scale: 0.9 }}
    >
      <span className="flex gap-2">
        {eye}
        {eye}
      </span>
      <span className={`absolute bottom-3 h-1 rounded-full bg-[#08090b] transition-all ${mood > 0 ? "w-2.5" : "w-4"}`} />
    </motion.button>
  );
}

/** A section with nothing to show: a small mascot that follows the pointer and answers pokes, with what is missing and why. */
export function Nothing({ title, words, action, compact = false }: { title?: ReactNode; words?: ReactNode; action?: ReactNode; compact?: boolean }) {
  const [mood, setMood] = useState(0);
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? "py-6" : "py-10"}`}>
      <Blob mood={mood} onPoke={() => setMood((m) => (m + 1) % LINES.length)} />
      <div className="flex max-w-sm flex-col gap-1">
        <span className="text-sm font-medium text-primary" aria-live="polite">
          {mood === 0 ? (title ?? LINES[0]) : LINES[mood]}
        </span>
        {words && <span className="text-sm text-pretty text-secondary">{words}</span>}
      </div>
      {action}
    </div>
  );
}
