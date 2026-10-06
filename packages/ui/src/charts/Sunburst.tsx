import { type ReactNode } from "react";
import { AnimatePresence, motion } from "../motion";
import { COLOR } from "../design/tokens";
import { DURATION, EASE } from "../motion/constants";
import { useTip } from "./tip";

export type SunNode = {
  key: string;
  name: string;
  value: number;
  colour: string;
  file: boolean;
  open: boolean;
  tip: ReactNode;
  inside: SunNode[] | null;
};

export type Arc = { node: SunNode; parent: SunNode | null; ring: 0 | 1; from: number; to: number; fill: string };

export const SUN = { size: 320, hole: 64, ring: 112, gap: 3, outer: 156 } as const;

const MIN = 0.022;

/** The rings of a sunburst for one level: its children around the hole and their own children outside them, the slivers (and children past the limit) folded into one grey "more" arc each. */
export function arcsOf(children: SunNode[], more: (count: number, value: number, parent: SunNode | null) => SunNode, limit = Infinity): Arc[] {
  const out: Arc[] = [];
  const place = (list: SunNode[], from: number, span: number, ring: 0 | 1, parent: SunNode | null) => {
    const total = list.reduce((n, c) => n + c.value, 0);
    if (total <= 0 || span <= 0) return;
    let at = from;
    let rest = 0;
    let restCount = 0;
    let shown = 0;
    for (const c of list) {
      if (c.value <= 0) continue;
      const angle = (span * c.value) / total;
      if (angle < MIN || (ring === 0 && shown >= limit)) {
        rest += c.value;
        restCount += 1;
        continue;
      }
      const fill = ring === 0 ? (c.file ? `color-mix(in srgb, ${c.colour} 62%, var(--surface))` : c.colour) : `color-mix(in srgb, ${parent?.colour ?? c.colour} ${c.file ? 42 : 72}%, var(--surface))`;
      out.push({ node: c, parent, ring, from: at, to: at + angle, fill });
      shown += 1;
      if (ring === 0 && c.inside && c.inside.length > 0) place(c.inside, at, angle, 1, c);
      at += angle;
    }
    if (restCount > 0) {
      const node = more(restCount, rest, parent);
      out.push({ node, parent, ring, from: at, to: from + span, fill: ring === 0 ? "var(--other)" : "color-mix(in srgb, var(--other) 55%, var(--surface))" });
    }
  };
  place(children, 0, Math.PI * 2, 0, null);
  return out;
}

function point(r: number, a: number): string {
  return `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
}

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 0.0001);
  const end = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  return `M${point(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${point(r1, end)}L${point(r0, end)}A${r0} ${r0} 0 ${large} 0 ${point(r0, a0)}Z`;
}

/** A Filelight-style sunburst: a level's children as a ring around a hole, their children as an outer ring; the level zooms in and out as it changes. */
export function Sunburst({
  level,
  arcs,
  direction,
  hover,
  onHover,
  onPick,
  onUp,
  centre,
  label,
}: {
  level: string;
  arcs: Arc[];
  direction: 1 | -1;
  hover: string | null;
  onHover: (key: string | null) => void;
  onPick: (node: SunNode) => void;
  onUp?: () => void;
  centre: ReactNode;
  label: string;
}) {
  const tip = useTip();
  const lit = (a: Arc) => hover === null || a.node.key === hover || a.parent?.key === hover || hover.startsWith(a.node.key);
  const half = SUN.size / 2;
  return (
    <div className="relative aspect-square w-full">
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={level}
          custom={direction}
          className="absolute inset-0"
          variants={{
            enter: (d: number) => ({ opacity: 0, scale: d > 0 ? 0.8 : 1.14 }),
            shown: { opacity: 1, scale: 1 },
            leave: (d: number) => ({ opacity: 0, scale: d > 0 ? 1.14 : 0.8 }),
          }}
          initial="enter"
          animate="shown"
          exit="leave"
          transition={{ duration: DURATION.base, ease: EASE.out }}
        >
          <svg viewBox={`${-half} ${-half} ${SUN.size} ${SUN.size}`} className="block h-full w-full overflow-visible" role="img" aria-label={label} onMouseLeave={() => onHover(null)}>
            {arcs.map((a) => {
              const r0 = a.ring === 0 ? SUN.hole : SUN.ring + SUN.gap;
              const r1 = a.ring === 0 ? SUN.ring : SUN.outer;
              const can = a.node.open || a.node.file;
              return (
                <path
                  key={`${a.ring}${a.node.key}`}
                  d={sector(r0, r1, a.from, a.to)}
                  fill={a.fill}
                  stroke={COLOR.surface}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  className={`transition-opacity duration-(--duration-fast) ${can ? "cursor-pointer" : ""}`}
                  style={{ opacity: lit(a) ? 1 : 0.32 }}
                  onClick={can ? () => onPick(a.node) : undefined}
                  onMouseEnter={() => onHover(a.node.key)}
                  {...tip(a.node.tip)}
                />
              );
            })}
            <circle r={SUN.hole - SUN.gap} fill={COLOR.surface} className={onUp ? "cursor-pointer" : undefined} onClick={onUp} onMouseEnter={() => onHover(null)} />
          </svg>
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex w-[34%] flex-col items-center gap-0.5 text-center">{centre}</div>
      </div>
    </div>
  );
}
