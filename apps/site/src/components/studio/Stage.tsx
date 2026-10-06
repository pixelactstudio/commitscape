import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Dices, Moon, RotateCcw, Sun } from "lucide-react";
import { lookOf, parseStyle, type CardStyle } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { animate, EASE, MeshGradient, meshFallback, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "@commitscape/ui/motion";
import { cardSrc } from "#/lib/markdown";
import { stagePalette } from "./look";
import type { CardChoice } from "./types";

const TILT = { stiffness: 160, damping: 18, mass: 0.6 };

/** An image that keeps showing the last one until the next has loaded, then fades the new one in over it. */
export function SteadyImage({ src, alt, width, height, className = "", eager = false }: { src: string; alt: string; width: number; height: number; className?: string; eager?: boolean }) {
  const reduce = useReducedMotion();
  const [layers, setLayers] = useState<{ now: string; was: string | null }>({ now: src, was: null });
  const wanted = useRef(src);
  const loading = src !== layers.now;
  useEffect(() => {
    if (src === layers.now) return;
    wanted.current = src;
    const img = new Image();
    img.onload = img.onerror = () => {
      if (wanted.current === src) setLayers((l) => ({ now: src, was: reduce ? null : l.now }));
    };
    img.src = src;
  }, [src, layers.now, reduce]);
  return (
    <span className={`relative block ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {layers.was && <img src={layers.was} alt="" aria-hidden width={width} height={height} className="absolute inset-0 block h-full w-full" />}
      <img
        key={layers.now}
        src={layers.now}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onAnimationEnd={() => setLayers((l) => ({ ...l, was: null }))}
        className={`relative block h-full w-full ${layers.was ? "studio-fade" : ""}`}
      />
      <span className={`studio-glass pointer-events-none absolute end-2 top-2 grid size-7 place-items-center rounded-full transition-opacity duration-(--duration-fast) ${loading ? "opacity-100" : "opacity-0"}`}>
        <Spinner size="sm" />
      </span>
    </span>
  );
}

type StageProps = {
  choice: CardChoice;
  mode: "light" | "dark";
  style: CardStyle;
  query: string;
  spin: number;
  changed: boolean;
  onMode: (mode: "light" | "dark") => void;
  onSurprise: () => void;
  onReset: () => void;
  className?: string;
};

/** The Card on a living backdrop of its own colours: it tilts toward the pointer and catches the light, and Surprise me shuffles its style. */
export function Stage({ choice, mode, style, query, spin, changed, onMode, onSurprise, onReset, className = "" }: StageProps) {
  const reduce = useReducedMotion();
  const palette = useMemo(() => stagePalette(mode, style), [mode, style]);
  const shown = useMemo(() => parseStyle(new URLSearchParams(query)), [query]);
  const radius = lookOf(mode, shown).radius;
  const card = useRef<HTMLDivElement>(null);
  const toss = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const lit = useMotionValue(0);
  const sx = useSpring(px, TILT);
  const sy = useSpring(py, TILT);
  const glow = useSpring(lit, { stiffness: 120, damping: 20 });
  const rotateX = useTransform(sy, [0, 1], [9, -9]);
  const rotateY = useTransform(sx, [0, 1], [-12, 12]);
  const gx = useTransform(sx, (v) => `${v * 100}%`);
  const gy = useTransform(sy, (v) => `${v * 100}%`);
  const band = useTransform(sx, (v) => `${(1 - v) * 100}%`);
  const glare = useMotionTemplate`radial-gradient(farthest-corner circle at ${gx} ${gy}, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.12) 28%, rgb(255 255 255 / 0) 60%)`;
  const sheen = useTransform(glow, (v) => v * 0.7);

  useEffect(() => {
    if (!spin || reduce) return;
    const moves = [
      toss.current && animate(toss.current, { scale: [1, 0.9, 1.035, 1], rotateZ: [0, -3, 1.2, 0], y: [0, 10, -8, 0] }, { duration: 0.8, ease: EASE.out, times: [0, 0.3, 0.68, 1] }),
      sweep.current && animate(sweep.current, { backgroundPositionX: ["130%", "-30%"], opacity: [0, 1, 1, 0] }, { duration: 1, ease: EASE.inOut, delay: 0.25 }),
    ];
    return () => moves.forEach((m) => m?.stop());
  }, [spin, reduce]);

  const follow = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType === "touch" || !card.current) return;
    const r = card.current.getBoundingClientRect();
    const clamp = (v: number) => Math.max(-0.2, Math.min(1.2, v));
    px.set(clamp((e.clientX - r.left) / r.width));
    py.set(clamp((e.clientY - r.top) / r.height));
    lit.set(1);
  };
  const rest = () => {
    px.set(0.5);
    py.set(0.5);
    lit.set(0);
  };

  const ratio = choice.width / choice.height;
  const corner = `${(radius / choice.width) * 100}% / ${(radius / choice.height) * 100}%`;
  return (
    <div data-mode={mode} onPointerMove={follow} onPointerLeave={rest} className={`studio-live relative isolate flex flex-col overflow-hidden ${className}`} style={{ background: meshFallback(palette) }}>
      <MeshGradient palette={palette} seed={2} />
      <div className="flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="flex min-w-0 flex-col ps-1 pt-1">
          <span className="truncate text-sm font-semibold">{choice.title}</span>
          <span className="studio-ink-2 hidden truncate text-xs sm:block">{choice.about}</span>
        </div>
        <div role="group" aria-label="Preview in" className="studio-glass flex flex-none gap-0.5 rounded-full p-0.5">
          {(
            [
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([value, label, Glyph]) => (
            <button key={value} type="button" aria-pressed={mode === value} aria-label={label} onClick={() => onMode(value)} className="studio-seg flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
              <Glyph size={ICON.sm} aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-2 sm:px-10 [perspective:1400px]">
        <motion.div ref={toss} className="w-full" style={{ maxWidth: `min(${choice.width}px, calc(var(--card-h) * ${ratio}))` }}>
          <motion.div ref={card} className="relative [transform-style:preserve-3d]" style={{ rotateX, rotateY }}>
            <SteadyImage src={cardSrc(choice.url, "svg", mode, query)} alt={`${choice.alt}, ${mode}`} width={choice.width} height={choice.height} className="studio-card" eager />
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: corner }}>
              <motion.span className="absolute inset-0 mix-blend-overlay" style={{ background: glare, opacity: glow }} />
              <motion.span
                className="absolute inset-0 mix-blend-soft-light"
                style={{ backgroundImage: "linear-gradient(105deg, transparent 38%, rgb(255 255 255 / 0.7) 48%, rgb(255 255 255 / 0) 58%)", backgroundSize: "260% 100%", backgroundPositionX: band, opacity: sheen }}
              />
              <span ref={sweep} className="absolute inset-0 opacity-0 mix-blend-overlay" style={{ backgroundImage: "linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.9) 50%, transparent 65%)", backgroundSize: "260% 100%" }} />
            </span>
          </motion.div>
        </motion.div>
      </div>
      <div className="flex items-center justify-center gap-2 p-3 sm:p-4">
        <button type="button" onClick={onSurprise} className="studio-solid flex h-10 cursor-pointer items-center gap-2 rounded-full px-5 text-sm font-semibold">
          <Dices size={ICON.md} aria-hidden />
          Surprise me
        </button>
        <button type="button" onClick={onReset} disabled={!changed} className="studio-glass flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-medium">
          <RotateCcw size={ICON.sm} aria-hidden />
          Reset
        </button>
      </div>
    </div>
  );
}
