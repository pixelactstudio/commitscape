import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { grouped } from "../format";
import { clampSpan, dayWords, fractionOf, ticksOf, DAY, type Span } from "./time";

const MIN_DAYS = 7;
const AXIS = "h-5";

type Drag = { kind: "from" | "to" | "pan"; grab: number; start: Span };

/** Bars over the whole time there is, with the days on view lit between two handles: drag them, or use the arrow keys. */
export function Brush({ bins, extent, view, onPreview, onCommit, noun, older = 0 }: { bins: number[]; extent: Span; view: Span; onPreview: (span: Span | null) => void; onCommit: (span: Span) => void; noun: string; older?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const width = Math.max(1, extent.to - extent.from);
  const most = Math.max(1, ...bins);
  const left = Math.max(0, fractionOf(extent, view.from * DAY));
  const right = Math.min(1, fractionOf(extent, view.to * DAY));

  const dayAt = (x: number): number => {
    const box = track.current?.getBoundingClientRect();
    return box && box.width > 0 ? extent.from + ((x - box.left) / box.width) * width : extent.from;
  };

  const spanFor = (d: Drag, x: number): Span => {
    const day = Math.round(dayAt(x));
    if (d.kind === "pan") return clampSpan(d.start.from + Math.round(dayAt(x) - d.grab), d.start.to - d.start.from, extent);
    if (d.kind === "from") return { from: Math.min(Math.max(day, extent.from), d.start.to - MIN_DAYS), to: d.start.to };
    return { from: d.start.from, to: Math.max(Math.min(day, extent.to), d.start.from + MIN_DAYS) };
  };

  const begin = (kind: Drag["kind"]) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    setDrag({ kind, grab: dayAt(e.clientX), start: view });
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (drag) onPreview(spanFor(drag, e.clientX));
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const next = spanFor(drag, e.clientX);
    setDrag(null);
    onPreview(null);
    onCommit(next);
  };

  const step = (which: "from" | "to") => (e: KeyboardEvent<HTMLElement>) => {
    const big = e.shiftKey ? 7 : 1;
    const by = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -big : e.key === "ArrowRight" || e.key === "ArrowUp" ? big : e.key === "PageDown" ? -30 : e.key === "PageUp" ? 30 : 0;
    const jump = e.key === "Home" ? extent.from : e.key === "End" ? extent.to : null;
    if (by === 0 && jump === null) return;
    e.preventDefault();
    const target = jump ?? (which === "from" ? view.from : view.to) + by;
    onCommit(which === "from" ? { from: Math.min(Math.max(target, extent.from), view.to - MIN_DAYS), to: view.to } : { from: view.from, to: Math.max(Math.min(target, extent.to), view.from + MIN_DAYS) });
  };

  const grip = "absolute top-0 bottom-5 z-(--z-raised) flex w-3 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm outline-offset-0 before:absolute before:-inset-x-2 before:inset-y-0 focus-visible:outline-2 focus-visible:outline-focus";

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={track}
        className="relative h-16 cursor-pointer select-none"
        onPointerDown={(e) => {
          if (e.button === 0) onCommit(clampSpan(Math.round(dayAt(e.clientX) - (view.to - view.from) / 2), view.to - view.from, extent));
        }}
      >
        <div className="absolute inset-x-0 top-0 bottom-5 flex items-end gap-px" role="img" aria-label={`How many ${noun} had their last commit in each slice of ${dayWords(extent.from)} to ${dayWords(extent.to)}`}>
          {bins.map((n, i) => (
            <span key={i} className="block flex-1 rounded-cell bg-strong" style={{ height: n === 0 ? "2px" : `${Math.max(10, (n * 100) / most)}%` }} />
          ))}
        </div>
        {older > 0 && (
          <span className="pointer-events-none absolute start-1 top-0 rounded-xs bg-surface/80 px-1 text-xs text-secondary tnum">
            ‹ {grouped(older)} older
          </span>
        )}
        <div className="pointer-events-none absolute top-0 bottom-5 left-0 bg-body/70" style={{ width: `${left * 100}%` }} aria-hidden />
        <div className="pointer-events-none absolute top-0 right-0 bottom-5 bg-body/70" style={{ width: `${(1 - right) * 100}%` }} aria-hidden />
        <div
          className="absolute top-0 bottom-5 cursor-grab touch-none border-y border-strong active:cursor-grabbing"
          style={{ left: `${left * 100}%`, width: `${Math.max(0, right - left) * 100}%` }}
          onPointerDown={begin("pan")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => {
            setDrag(null);
            onPreview(null);
          }}
        />
        {(["from", "to"] as const).map((which) => (
          <span
            key={which}
            role="slider"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={which === "from" ? "Start of the days shown" : "End of the days shown"}
            aria-valuemin={which === "from" ? extent.from : view.from + MIN_DAYS}
            aria-valuemax={which === "from" ? view.to - MIN_DAYS : extent.to}
            aria-valuenow={which === "from" ? view.from : view.to}
            aria-valuetext={dayWords(which === "from" ? view.from : view.to)}
            className={grip}
            style={{ left: `${(which === "from" ? left : right) * 100}%` }}
            onPointerDown={begin(which)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => {
              setDrag(null);
              onPreview(null);
            }}
            onKeyDown={step(which)}
          >
            <span className="block h-full w-1 rounded-full bg-inverse shadow-ring" aria-hidden />
          </span>
        ))}
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 ${AXIS}`} aria-hidden>
          {ticksOf(extent, 8).map((t) => (
            <span key={t.day} className={`absolute top-1 -translate-x-1/2 text-xs whitespace-nowrap tnum ${t.major ? "font-medium text-secondary" : "text-tertiary"}`} style={{ left: `${fractionOf(extent, t.day * DAY) * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
