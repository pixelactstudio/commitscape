import { useRef, useSyncExternalStore } from "react";
import { Crown } from "lucide-react";
import { CountUp, DURATION, EASE, motion, useInView, useReducedMotion } from "../motion";
import { ICON } from "../design/tokens";
import { toneOf, winnerOf, type Duel, type Side } from "./tone";

const never = () => () => {};

function useHydrated() {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/** A bar that grows out from the middle the first time it is seen; drawn full on the server so nothing waits for scripts. */
export function GrowBar({ value, side, lead }: { value: number; side: Side; lead: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const hydrated = useHydrated();
  const scale = !hydrated || reduce || seen ? 1 : 0;
  return (
    <span ref={ref} className={`flex h-2 w-full overflow-hidden rounded-full bg-track ${side === "a" ? "justify-end" : "justify-start"}`} style={toneOf(side)}>
      <motion.span
        className="block h-full rounded-full bg-[var(--side)]"
        initial={false}
        animate={{ scaleX: scale }}
        transition={scale === 0 ? { duration: 0 } : { duration: DURATION.slow, ease: EASE.out }}
        style={{ width: `${value > 0 ? Math.max(3, value * 100) : 0}%`, originX: side === "a" ? 1 : 0, opacity: lead ? 1 : 0.38 }}
      />
    </span>
  );
}

function Value({ d, side, lead }: { d: Duel; side: Side; lead: boolean }) {
  const n = side === "a" ? d.a : d.b;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-lg leading-none tracking-number whitespace-nowrap tnum sm:text-xl ${lead ? "font-semibold text-primary" : "text-secondary"} ${side === "b" ? "flex-row-reverse" : ""}`}>
      {lead && <Crown size={ICON.sm} className="flex-none text-[var(--side)]" aria-label="leads this view" />}
      {n === null ? <span title="not known">—</span> : <CountUp value={n} format={d.format} />}
    </span>
  );
}

/** One view between two people: what it counts in the middle, each side's number at the edge, and a bar each growing outward. */
export function DuelRow({ d, columns = 1 }: { d: Duel; columns?: 1 | 2 }) {
  const win = winnerOf(d);
  const most = Math.max(d.a ?? 0, d.b ?? 0);
  const least = Math.min(d.a ?? Infinity, d.b ?? Infinity);
  const width = (n: number | null) => (n === null || most === 0 ? 0 : d.lowerWins ? least / Math.max(n, 0.01) : n / most);
  return (
    <li className={`-mb-px flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:px-5 ${columns === 2 ? "lg:odd:border-e lg:last:odd:col-span-2 lg:last:odd:border-e-0" : ""}`}>
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[1fr_auto_1fr]">
        <span className="col-span-2 row-start-1 text-center text-sm leading-tight font-medium text-secondary sm:col-span-1 sm:col-start-2">
          {d.label}
          {win === "tie" && <span className="ms-1.5 text-xs font-normal sm:ms-0 sm:block">a tie</span>}
        </span>
        <span className="row-start-2 flex min-w-0 justify-start sm:col-start-1 sm:row-start-1" style={toneOf("a")}>
          <Value d={d} side="a" lead={win === "a"} />
        </span>
        <span className="row-start-2 flex min-w-0 justify-end sm:col-start-3 sm:row-start-1" style={toneOf("b")}>
          <Value d={d} side="b" lead={win === "b"} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <GrowBar value={width(d.a)} side="a" lead={win === "a" || win === "tie"} />
        <GrowBar value={width(d.b)} side="b" lead={win === "b" || win === "tie"} />
      </div>
      {d.note && <p className="m-0 text-center type-caption">{d.note}</p>}
    </li>
  );
}

/** Views between two people, one row each, in a single surface; in two columns on wide screens when asked, and without its own frame inside a Panel. */
export function DuelRows({ rows, label, columns = 1, bare = false }: { rows: Duel[]; label?: string; columns?: 1 | 2; bare?: boolean }) {
  return (
    <ol aria-label={label} className={`m-0 grid list-none overflow-hidden p-0 ${columns === 2 ? "lg:grid-cols-2" : ""} ${bare ? "border-t border-line" : "rounded-lg border border-line bg-surface"}`}>
      {rows.map((d) => (
        <DuelRow key={d.key} d={d} columns={columns} />
      ))}
    </ol>
  );
}
