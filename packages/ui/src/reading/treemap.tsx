import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { File as FileData, MapBlock } from "@commitscape/data";
import { useWidth } from "../branches/useWidth";
import { useTip } from "../charts/tip";
import { compact, date, many } from "../format";
import { centre, neighbour, type Cell, type Dir } from "./cells";

const pct = (n: number, whole: number) => `${(n * 100) / whole}%`;

/** A level of the code at HEAD as one box of blocks sized by their lines: real buttons in a box that scales, one stop for the keyboard with arrows between blocks, Enter to open a folder or choose a file. Lines join the chosen file to the files that change with it. */
export function Treemap({ cells, size, className, fill, chosen, coupled, label, onPick }: { cells: Cell[]; size: { w: number; h: number }; className: string; fill: (b: MapBlock) => string; chosen: string | null; coupled: FileData["coupled"]; label: string; onPick: (b: MapBlock) => void }) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = width > 0 ? width / size.w : 0.9;
  const [at, setAt] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stops = cells.filter((c) => c.role !== "bg");
  const here = stops.find((c) => c.key === at) ?? stops[0];
  const from = chosen ? centre(cells, chosen) : null;
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir: Dir | null = e.key === "ArrowRight" ? "right" : e.key === "ArrowLeft" ? "left" : e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : null;
    if (!dir || !here) return;
    const next = neighbour(stops, here, dir);
    e.preventDefault();
    if (!next) return;
    setAt(next.key);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(next.key)}"]`)?.focus());
  };
  return (
    <div ref={ref} className={`relative w-full ${className}`} style={{ aspectRatio: `${size.w} / ${size.h}` }}>
      <div ref={box} role="group" aria-label={label} onKeyDown={move} className="absolute inset-0">
        {cells.map((c) => {
          const b = c.block;
          const pos: CSSProperties = { left: pct(c.x, size.w), top: pct(c.y, size.h), width: pct(c.w, size.w), height: pct(c.h, size.h) };
          if (c.role === "bg") return <span key={c.key} aria-hidden className="absolute p-px" style={pos}><span className="block size-full rounded-cell bg-sunken" /></span>;
          const head = c.role === "head";
          const folder = !b.file;
          const picked = b.path === chosen;
          const px = c.w * scale;
          const py = c.h * scale;
          const words = (
            <>
              <strong>{b.path}</strong>
              <div>
                {compact(b.lines)} lines{b.file ? "" : ` in ${many(b.files, "file", "files")}`}
              </div>
              <div>changed in {many(b.churn, "commit", "commits")}</div>
              {b.last_touched > 0 && <div>last changed {date(b.last_touched)}</div>}
              {b.owner && <div>most commits by {b.owner.name}</div>}
              <div className="note">{b.file ? "Enter for its details" : "Enter to open"}</div>
            </>
          );
          const text = b.name + (folder ? "/" : "");
          const hover = tip(words);
          return (
            <button
              key={c.key}
              type="button"
              data-cell={c.key}
              tabIndex={here?.key === c.key ? 0 : -1}
              onClick={() => onPick(b)}
              onFocus={(e) => {
                setAt(c.key);
                hover.onFocus(e);
              }}
              onBlur={hover.onBlur}
              onMouseMove={hover.onMouseMove}
              onMouseLeave={hover.onMouseLeave}
              aria-label={`${b.path}, ${compact(b.lines)} lines, changed in ${many(b.churn, "commit", "commits")}: ${folder ? "open it" : "its details"}`}
              className="plain-button group absolute p-px focus-visible:z-(--z-raised) focus-visible:outline-2 focus-visible:outline-transparent"
              style={pos}
            >
              <span className={`relative block size-full overflow-hidden rounded-cell transition-[filter] duration-(--duration-instant) group-hover:brightness-110 group-focus-visible:shadow-[inset_0_0_0_2px_var(--color-bg-page),inset_0_0_0_4px_var(--color-text-primary)] ${head ? "" : picked ? "ring-2 ring-primary ring-inset" : ""}`} style={head ? undefined : { background: fill(b) }}>
                {((head && px > 28) || (!head && px > 44 && py > 22)) && (
                  <span className={`mono absolute start-1 top-1 block max-w-[calc(100%-0.5rem)] truncate type-micro leading-none ${head ? "text-secondary" : "rounded-xs bg-surface px-1.5 py-1 text-primary"}`}>{text}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {from && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
          {coupled.map((c) => {
            const to = centre(cells, c.path);
            if (!to) return null;
            return (
              <g key={c.path}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={1.5 + c.degree * 3} vectorEffect="non-scaling-stroke" strokeLinecap="round" className="stroke-primary" />
                <circle cx={to.x} cy={to.y} r={4} className="fill-primary stroke-surface" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          <circle cx={from.x} cy={from.y} r={5} className="fill-surface stroke-primary" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}
