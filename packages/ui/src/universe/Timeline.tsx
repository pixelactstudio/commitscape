import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Selector } from "@astryxdesign/core/Selector";
import { Pause, Play, X } from "lucide-react";
import { SLOTS, WEEK_SECONDS } from "@commitscape/data/universe";
import { date, grouped } from "../format";
import { SPEEDS, type Clock } from "./clock";
import type { Look } from "./look";
import type { Summary } from "./protocol";

export type TimelineProps = {
  summary: Summary;
  strip: Uint32Array;
  look: Look;
  clock: Clock;
  playing: boolean;
  ready: boolean;
  speed: number;
  range: [number, number] | null;
  compact: boolean;
  name: (person: number) => string;
  onPlay: () => void;
  onSpeed: (seconds: number) => void;
  onRange: (range: [number, number] | null) => void;
  onScrub: (at: number, done: boolean) => void;
  legend?: ReactNode;
  note?: ReactNode;
};

type Tip = { x: number; week: number } | null;

const HEIGHT = 40;

/** The history under the map: commits per week stacked by the colour their author held that week, release ticks, the playhead to drag, a range to brush with shift, and play, pause and speed. */
export function Timeline(p: TimelineProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<Tip>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const { summary, strip } = p;
  const weeks = summary.weeks;
  const span = Math.max(1, summary.newest - summary.origin);
  const xOf = (t: number) => ((t - summary.origin) / span) * width;
  const tOf = (x: number) => summary.origin + Math.max(0, Math.min(1, x / Math.max(1, width))) * span;

  const totals = useMemo(() => {
    const out = new Uint32Array(weeks);
    for (let w = 0; w < weeks; w++) {
      let s = 0;
      for (let k = 0; k <= SLOTS; k++) s += strip[w * (SLOTS + 1) + k] as number;
      out[w] = s;
    }
    return out;
  }, [strip, weeks]);
  const { most, cut, peak } = useMemo(() => {
    const busy = Array.from(totals).filter((v) => v > 0).sort((a, b) => a - b);
    const peak = busy.at(-1) ?? 1;
    const p98 = busy[Math.floor(busy.length * 0.98)] ?? peak;
    const cap = Math.max(4, Math.ceil(p98 * 1.15));
    return peak > cap * 1.4 ? { most: cap, cut: true, peak } : { most: Math.max(1, peak), cut: false, peak };
  }, [totals]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const colours = [...p.look.css.slots, p.look.css.other];
    const mark = p.look.night ? "white" : "black";
    const bar = width / weeks;
    const columns = Math.max(1, Math.floor(width));
    if (bar >= 1) {
      for (let w = 0; w < weeks; w++) {
        let y = HEIGHT;
        const x = w * bar;
        for (let k = 0; k <= SLOTS; k++) {
          const v = strip[w * (SLOTS + 1) + k] as number;
          if (!v) continue;
          const h = Math.min(y - 4, (v / most) * (HEIGHT - 4));
          g.fillStyle = colours[k] ?? colours[SLOTS] ?? "gray";
          g.fillRect(x, y - h, Math.max(1, bar - (bar > 3 ? 1 : 0)), h);
          y -= h;
        }
        if ((totals[w] as number) > most) {
          g.fillStyle = mark;
          g.fillRect(x - 1, 0, Math.max(3, bar + 1), 2);
        }
      }
    } else {
      for (let col = 0; col < columns; col++) {
        const w0 = Math.floor((col / columns) * weeks);
        const w1 = Math.max(w0 + 1, Math.floor(((col + 1) / columns) * weeks));
        const sums = new Array<number>(SLOTS + 1).fill(0);
        for (let w = w0; w < w1; w++) for (let k = 0; k <= SLOTS; k++) sums[k] = (sums[k] as number) + (strip[w * (SLOTS + 1) + k] as number);
        let y = HEIGHT;
        for (let k = 0; k <= SLOTS; k++) {
          const v = (sums[k] as number) / (w1 - w0);
          if (!v) continue;
          const h = Math.min(y - 4, (v / most) * (HEIGHT - 4));
          g.fillStyle = colours[k] ?? "gray";
          g.fillRect(col, y - h, 1, h);
          y -= h;
        }
        let over = false;
        for (let w = w0; w < w1; w++) if ((totals[w] as number) > most) over = true;
        if (over) {
          g.fillStyle = mark;
          g.fillRect(col - 1, 0, 3, 2);
        }
      }
    }
  }, [strip, width, weeks, most, totals, p.look]);

  useEffect(() => {
    const move = () => {
      const at = p.clock.at;
      const x = xOf(at);
      if (head.current) head.current.style.transform = `translateX(${x}px)`;
      if (label.current) label.current.textContent = date(at);
      slider.current?.setAttribute("aria-valuenow", String(Math.round(at)));
      slider.current?.setAttribute("aria-valuetext", date(at));
    };
    move();
    return p.clock.listen(move);
  });

  const drag = useRef<{ mode: "scrub" | "brush"; from: number; id: number } | null>(null);
  const localX = (e: PointerEvent) => e.clientX - (box.current?.getBoundingClientRect().left ?? 0);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!p.ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    slider.current?.focus({ preventScroll: true });
    const t = tOf(localX(e));
    if (e.shiftKey) {
      drag.current = { mode: "brush", from: t, id: e.pointerId };
      setBrush([t, t]);
    } else {
      drag.current = { mode: "scrub", from: t, id: e.pointerId };
      p.onScrub(t, false);
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const x = localX(e);
    const w = Math.max(0, Math.min(weeks - 1, Math.floor((tOf(x) - summary.origin) / WEEK_SECONDS)));
    setTip({ x, week: w });
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const t = tOf(x);
    if (d.mode === "brush") setBrush([Math.min(d.from, t), Math.max(d.from, t)]);
    else p.onScrub(t, false);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const t = tOf(localX(e));
    if (d.mode === "brush") {
      setBrush(null);
      const lo = Math.min(d.from, t);
      const hi = Math.max(d.from, t);
      if (hi - lo >= WEEK_SECONDS) p.onRange([lo, hi]);
    } else p.onScrub(t, true);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30.44 * 86_400 : WEEK_SECONDS;
    const at = p.clock.at;
    const go = (t: number) => {
      e.preventDefault();
      e.stopPropagation();
      p.onScrub(t, true);
    };
    if (e.key === "ArrowRight" || e.key === "ArrowUp") go(at + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") go(at - step);
    else if (e.key === "PageUp") go(at + 365.25 * 86_400);
    else if (e.key === "PageDown") go(at - 365.25 * 86_400);
    else if (e.key === "Home") go(summary.origin);
    else if (e.key === "End") go(summary.newest);
  };

  const shown = brush ?? p.range;
  const ticks = summary.releases;
  const tipWeek = tip ? tip.week : null;
  const tipText = useMemo(() => {
    if (tipWeek === null) return null;
    const start = summary.origin + tipWeek * WEEK_SECONDS;
    const parts: { colour: string; who: string; n: number }[] = [];
    for (let k = 0; k <= SLOTS; k++) {
      const n = strip[tipWeek * (SLOTS + 1) + k] as number;
      if (!n) continue;
      const person = k < SLOTS ? (summary.slotsByWeek[tipWeek * SLOTS + k] as number) : -1;
      parts.push({ colour: k < SLOTS ? (p.look.css.slots[k] ?? "") : p.look.css.other, who: k < SLOTS && person >= 0 ? p.name(person) : "Everyone else", n });
    }
    parts.sort((a, b) => b.n - a.n);
    return { start, total: totals[tipWeek] ?? 0, parts: parts.slice(0, 4), more: Math.max(0, parts.length - 4) };
  }, [tipWeek, strip, summary, totals, p]);

  const years = useMemo(() => {
    const out: { x: number; text: string }[] = [];
    const first = new Date(summary.origin * 1000).getUTCFullYear() + 1;
    const last = new Date(summary.newest * 1000).getUTCFullYear();
    const every = Math.max(1, Math.ceil((last - first + 1) / Math.max(2, Math.floor(width / 64))));
    for (let y = first; y <= last; y += every) out.push({ x: ((Date.UTC(y, 0, 1) / 1000 - summary.origin) / span) * width, text: String(y) });
    return out;
  }, [summary, width, span]);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface/90 px-3 pt-2 pb-1.5 shadow-(--shadow-md) backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton label={p.playing ? "Pause (Space)" : "Play the history (Space)"} size="sm" variant="primary" icon={<Icon icon={p.playing ? Pause : Play} size="sm" />} onClick={p.onPlay} isDisabled={!p.ready} />
        <span ref={label} className={`flex-none type-label text-primary tabular-nums ${p.compact ? "" : "min-w-26"} ${p.range ? "hidden" : ""}`} aria-hidden>
          {date(p.clock.at)}
        </span>
        {p.range ? (
          <span className="line-clamp-2 min-w-0 type-caption text-secondary">
            <span className="font-semibold text-primary tabular-nums">
              {date(p.range[0])} – {date(p.range[1])}
            </span>
            {!p.compact && ": heights count the commits in this range, colours go to its eight busiest people"}
          </span>
        ) : (
          !p.compact && <span className="line-clamp-2 min-w-0 type-caption text-secondary">{p.note && !p.playing ? p.note : p.clock.at >= summary.newest - 3600 ? "now: the newest commit on the default branch" : `${grouped(Math.round((summary.newest - p.clock.at) / 86_400))} days before the newest commit`}</span>
        )}
        <span className="ml-auto" />
        {p.range && <IconButton label="Clear the range" size="sm" variant="secondary" icon={<Icon icon={X} size="sm" />} onClick={() => p.onRange(null)} />}
        <div className="flex-none">
        <Selector label="Speed" isLabelHidden size="sm" value={String(p.speed)} onChange={(v) => p.onSpeed(Number(v))} options={SPEEDS.map((s) => ({ value: String(s.value), label: p.compact ? s.short : s.label }))} width={p.compact ? 104 : 120} />
        </div>
      </div>
      {p.legend}
      <div
        ref={slider}
        role="slider"
        tabIndex={0}
        aria-label="Playhead: where in the history the map stands"
        aria-valuemin={Math.round(summary.origin)}
        aria-valuemax={Math.round(summary.newest)}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End PageUp PageDown"
        className="relative cursor-ew-resize touch-none rounded-sm outline-offset-2 select-none"
        onKeyDown={key}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setTip(null)}
      >
        <div ref={box} className="relative" style={{ height: HEIGHT }}>
          <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
          {shown && <div className="absolute inset-y-0 rounded-xs border-x border-brand bg-brand/15" style={{ left: xOf(shown[0]), width: Math.max(2, xOf(shown[1]) - xOf(shown[0])) }} aria-hidden />}
          {Array.from(ticks.time).map((t, i) => (
            <span key={`${ticks.names[i]}-${i}`} className="absolute -top-1 h-2 w-px bg-brand" style={{ left: xOf(t) }} title={ticks.names[i]} aria-hidden />
          ))}
          <div ref={head} className="pointer-events-none absolute inset-y-0 -left-px w-0.5 rounded-full bg-primary" aria-hidden>
            <span className="absolute -top-1 -left-1 size-2.5 rounded-full border-2 border-surface bg-primary" />
          </div>
          {tip && tipText && (
            <div className="pointer-events-none absolute bottom-full z-10 mb-3 w-56 rounded-md bg-surface p-2 shadow-(--shadow-lg)" style={{ left: Math.max(0, Math.min(width - 224, tip.x - 112)) }}>
              <p className="m-0 type-caption text-secondary">
                Week of {date(tipText.start)} · <span className="font-semibold text-primary tabular-nums">{grouped(tipText.total)}</span> commits
              </p>
              {tipText.parts.map((x) => (
                <p key={x.who} className="m-0 flex items-center gap-1.5 type-caption text-primary">
                  <span className="size-2 flex-none rounded-full" style={{ background: x.colour }} />
                  <span className="truncate">{x.who}</span>
                  <span className="ml-auto tabular-nums text-secondary">{grouped(x.n)}</span>
                </p>
              ))}
              {tipText.more > 0 && <p className="m-0 type-caption text-tertiary">and {tipText.more} more</p>}
              {cut && tipText.total > most && <p className="m-0 mt-1 type-caption text-tertiary">Bars stop at {grouped(most)}; a mark on top shows a taller week. The busiest had {grouped(peak)}. A commit counts in the week it reached the default branch, so one merge can bring many at once.</p>}
            </div>
          )}
        </div>
        <div className="relative h-4" aria-hidden>
          {years.map((y) => (
            <span key={y.text} className="absolute top-0.5 -translate-x-1/2 type-caption text-tertiary tabular-nums" style={{ left: y.x }}>
              {y.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
