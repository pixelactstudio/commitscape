import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { GitBranch } from "@commitscape/data";
import { Face } from "../components/Face";
import { TipCard } from "../charts/Tip";
import { useTip } from "../charts/tip";
import { ICON } from "../design/tokens";
import { compact, date, duration, grouped, many } from "../format";
import { A } from "../kit/A";
import { PullChip } from "../git/PullChip";
import { agoOf, type Item, type Row } from "./model";
import { STATES } from "./states";
import { StateMark } from "./StateMark";
import { DAY, dayOf, dayWords, fractionOf, ticksOf, type Span } from "./time";

export type Layout = "wide" | "narrow";

const SIZES = { wide: { row: 32, group: 36 }, narrow: { row: 72, group: 44 } } as const;

const sizeOf = (item: Item | undefined, layout: Layout, bars: boolean): number => {
  const s = SIZES[layout];
  if (item?.kind === "group") return s.group;
  return layout === "narrow" && !bars ? 52 : s.row;
};

const keyOf = (item: Item | undefined, i: number): string => (item ? (item.kind === "group" ? `g:${item.prefix}` : `r:${item.row.b.name}`) : String(i));

export type TimelineProps = {
  items: Item[];
  view: Span;
  anchor: number;
  root: string;
  layout: Layout;
  bars: boolean;
  hrefOf: (name: string) => string;
  pullHref: (number: number) => string;
  onToggle: (prefix: string) => void;
};

const ago = (anchor: number, at: number) => agoOf(anchor, at, duration);

const label = (r: Row, root: string, anchor: number) => `${r.b.name}, ${STATES[r.state].word.toLowerCase()}, ${many(r.b.ahead, "commit", "commits")} ahead of and ${many(r.b.behind, "commit", "commits")} behind ${root}, last commit ${ago(anchor, r.b.at)}`;

/** A branch's line from where it left the default branch to its last commit, with a tick for each commit kept. */
export function Track({ b, view, colour }: { b: GitBranch; view: Span; colour: string }) {
  const from = b.baseAt > 0 ? fractionOf(view, b.baseAt) : null;
  const to = fractionOf(view, b.at);
  if (to < 0) {
    return (
      <span className="flex h-full items-center gap-1 ps-1 text-xs whitespace-nowrap text-tertiary">
        <ChevronLeft size={ICON.xs} aria-hidden />
        {dayWords(dayOf(b.at))}
      </span>
    );
  }
  const ticks = b.ticks ?? [];
  const first = ticks[0];
  const kept = first !== undefined && b.ahead > ticks.length ? fractionOf(view, first) : null;
  const at = (f: number) => `${Math.min(1, Math.max(0, f)) * 100}%`;
  const line = (a: number, z: number, faint: boolean): CSSProperties => ({ left: at(a), width: `${(Math.min(1, z) - Math.max(0, a)) * 100}%`, opacity: faint ? 0.3 : 0.6 });
  const firstAt = first !== undefined ? fractionOf(view, first) : Infinity;
  const start = Math.min(from ?? to, firstAt, to);
  return (
    <span className="absolute inset-y-0 start-2 end-2 block" style={{ color: colour }} aria-hidden>
      {kept !== null && kept > start ? (
        <>
          <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-current" style={line(start, kept, true)} />
          <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-current" style={line(kept, to, false)} />
        </>
      ) : (
        <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-current" style={line(start, to, false)} />
      )}
      {from !== null && from >= 0 && from <= 1 && <span className="absolute top-1/2 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current bg-surface" style={{ left: at(from) }} />}
      {from !== null && from < 0 && <ChevronLeft size={ICON.sm} className="absolute start-0 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70" />}
      {ticks.map((t) => {
        const f = fractionOf(view, t);
        return f >= 0 && f <= 1 ? <span key={t} className="absolute top-1/2 block h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" style={{ left: at(f) }} /> : null;
      })}
      {to <= 1 && <span className="absolute top-1/2 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" style={{ left: at(to) }} />}
      {to > 1 && <ChevronRight size={ICON.sm} className="absolute end-0 top-1/2 -translate-y-1/2 opacity-70" />}
    </span>
  );
}

function Tip({ r, root, anchor }: { r: Row; root: string; anchor: number }) {
  const { b } = r;
  return (
    <TipCard
      kicker={STATES[r.state].title}
      icon={<StateMark state={r.state} />}
      title={b.name}
      mono
      rows={[
        { label: `Left ${root}`, value: b.baseAt > 0 ? date(b.baseAt) : "No merge base" },
        { label: "Last commit", value: date(b.at) },
        { label: "Ahead / behind", value: b.baseAt > 0 ? `${grouped(b.ahead)} / ${grouped(b.behind)}` : `${grouped(b.ahead)} / no merge base` },
        ...(b.ticks ? [{ label: "Commits drawn", value: b.ticks.length < b.ahead ? `newest ${grouped(b.ticks.length)} of ${grouped(b.ahead)}` : grouped(b.ticks.length) }] : []),
        { label: "Quiet at the Build", value: duration((anchor - b.at) / DAY) },
      ]}
      hint="Click to open"
    />
  );
}

function BranchRow({ item, index, active, p }: { item: Extract<Item, { kind: "row" }>; index: number; active: boolean; p: TimelineProps }) {
  const tip = useTip();
  const { row } = item;
  const { b } = row;
  const colour = STATES[row.state].colour;
  const wide = p.layout === "wide";
  const indent = item.indent ? "ps-9" : "ps-3";
  const name = (
    <span className={`flex min-w-0 items-center gap-2 pe-2 ${wide ? indent : item.indent ? "ps-9" : ""}`}>
      <StateMark state={row.state} />
      <Face login={b.login} name={b.author} size={20} />
      <A href={p.hrefOf(b.name)} tabIndex={active ? 0 : -1} data-nav={index} aria-label={label(row, p.root, p.anchor)} className="min-w-0 flex-1 truncate font-mono text-sm text-primary no-underline outline-offset-2 hover:underline after:absolute after:inset-0 after:content-['']" title={b.name}>
        {b.name}
      </A>
      {b.pull && <PullChip pull={b.pull} href={p.pullHref(b.pull.number)} tabIndex={active ? 0 : -1} className="relative z-(--z-raised)" />}
    </span>
  );
  const track = p.bars ? (
    <span className="relative block h-full min-w-0" {...tip(<Tip r={row} root={p.root} anchor={p.anchor} />)}>
      <Track b={b} view={p.view} colour={colour} />
    </span>
  ) : null;
  const dim = row.state === "merged" ? "text-tertiary" : "";
  const noBase = b.baseAt <= 0;
  if (wide) {
    return (
      <div className={`row-hover relative grid h-full items-center ${p.bars ? "grid-cols-[var(--name)_minmax(0,1fr)_var(--meta)]" : "grid-cols-[minmax(0,1fr)_var(--meta)]"} focus-within:bg-hover`}>
        {name}
        {track}
        <span className={`grid grid-cols-[4rem_4rem_7rem] gap-x-2 items-center pe-3 text-end text-sm tnum ${dim}`}>
          <span className={row.state === "merged" ? "" : "text-primary"}>{grouped(b.ahead)}</span>
          <span className="text-secondary" title={noBase ? `No merge base with ${p.root}, so how far behind it is means nothing` : undefined}>
            {noBase ? "—" : grouped(b.behind)}
          </span>
          <span className="text-secondary" title={date(b.at)}>
            {ago(p.anchor, b.at)}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="row-hover relative flex h-full flex-col justify-center gap-1 pe-3 ps-3 focus-within:bg-hover">
      {name}
      {track && (
        <span className="relative ms-[22px] block h-4" {...tip(<Tip r={row} root={p.root} anchor={p.anchor} />)}>
          <Track b={b} view={p.view} colour={colour} />
        </span>
      )}
      <span className="ps-[22px] text-sm whitespace-nowrap text-secondary tnum">
        {compact(b.ahead)} ahead{noBase ? "" : ` · ${compact(b.behind)} behind`} · {ago(p.anchor, b.at)}
      </span>
    </div>
  );
}

function GroupRow({ item, index, active, p }: { item: Extract<Item, { kind: "group" }>; index: number; active: boolean; p: TimelineProps }) {
  const wide = p.layout === "wide";
  const newest = item.rows.reduce((m, r) => Math.max(m, r.b.at), 0);
  const counts = (["flight", "waiting", "abandoned", "merged"] as const).map((s) => [s, item.rows.filter((r) => r.state === s).length] as const).filter(([, n]) => n > 0);
  const words = counts.map(([s, n]) => `${n} ${STATES[s].word.toLowerCase()}`).join(", ");
  const head = (
    <button
      type="button"
      aria-expanded={item.open}
      aria-label={`${item.prefix}, ${many(item.rows.length, "branch", "branches")}: ${words}`}
      tabIndex={active ? 0 : -1}
      data-nav={index}
      onClick={() => p.onToggle(item.prefix)}
      className="plain-button flex min-w-0 items-center gap-2 ps-3 pe-2 text-start after:absolute after:inset-0 after:content-['']"
    >
      {item.open ? <ChevronDown size={ICON.sm} aria-hidden /> : <ChevronRight size={ICON.sm} aria-hidden />}
      <span className="min-w-0 truncate font-mono text-sm font-medium text-primary">{item.prefix}</span>
      <span className="flex-none text-sm text-secondary tnum">{many(item.rows.length, "branch", "branches")}</span>
    </button>
  );
  const dots = (
    <span className="relative block h-full min-w-0" aria-hidden>
      <span className="absolute inset-y-0 start-2 end-2 block">
        {item.rows.map((r) => {
          const f = fractionOf(p.view, r.b.at);
          return f >= 0 && f <= 1 ? <span key={r.b.name} className="absolute top-1/2 block size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80" style={{ left: `${f * 100}%`, background: STATES[r.state].colour }} /> : null;
        })}
      </span>
    </span>
  );
  const kinds = (
    <span className="flex items-center gap-1.5 text-xs text-secondary tnum">
      {counts.map(([s, n]) => (
        <span key={s} className="inline-flex items-center gap-0.5" title={`${n} ${STATES[s].word.toLowerCase()}`}>
          <StateMark state={s} size={ICON.xs} />
          {n}
        </span>
      ))}
    </span>
  );
  if (wide) {
    return (
      <div className={`row-hover relative grid h-full items-center bg-sunken ${p.bars ? "grid-cols-[var(--name)_minmax(0,1fr)_var(--meta)]" : "grid-cols-[minmax(0,1fr)_var(--meta)]"} focus-within:bg-hover`}>
        {head}
        {p.bars ? dots : null}
        <span className="flex items-center justify-between gap-2 pe-3 ps-1 text-end text-sm text-secondary tnum">
          {kinds}
          <span title={date(newest)}>{ago(p.anchor, newest)}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="row-hover relative flex h-full items-center justify-between gap-2 bg-sunken pe-3 focus-within:bg-hover">
      {head}
      {kinds}
    </div>
  );
}

/** The branches as rows under the days on view, a header for each shared prefix, only the rows near the screen drawn. */
export function Timeline(p: TimelineProps) {
  const list = useRef<HTMLDivElement>(null);
  const axis = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [pad, setPad] = useState(0);
  const [active, setActive] = useState(0);
  const wide = p.layout === "wide";
  useLayoutEffect(() => {
    const read = () => {
      const top = list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0;
      setMargin((m) => (Math.abs(m - top) < 1 ? m : top));
      const bar = axis.current;
      const under = bar ? parseFloat(getComputedStyle(bar).top) + bar.getBoundingClientRect().height : 0;
      setPad((v) => (Math.abs(v - under) < 1 ? v : under));
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(document.body);
    return () => watch.disconnect();
  }, []);
  const virtual = useWindowVirtualizer({ count: p.items.length, estimateSize: (i) => sizeOf(p.items[i], p.layout, p.bars), overscan: 10, scrollMargin: margin, scrollPaddingStart: pad, getItemKey: (i) => keyOf(p.items[i], i) });
  useEffect(() => virtual.measure(), [virtual, p.layout, p.bars]);
  const last = Math.max(0, p.items.length - 1);
  const here = Math.min(active, last);
  const go = (to: number) => {
    const next = Math.min(last, Math.max(0, to));
    setActive(next);
    virtual.scrollToIndex(next, { align: "auto" });
    requestAnimationFrame(() => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-nav="${next}"]`)?.focus({ preventScroll: true })));
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = Number((e.target as HTMLElement).dataset.nav ?? here);
    const item = p.items[at];
    const page = Math.max(3, Math.floor(window.innerHeight / SIZES[p.layout].row) - 2);
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "PageDown") go(at + page);
    else if (e.key === "PageUp") go(at - page);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(last);
    else if (e.key === "ArrowRight" && item?.kind === "group" && !item.open) p.onToggle(item.prefix);
    else if (e.key === "ArrowLeft" && item?.kind === "group" && item.open) p.onToggle(item.prefix);
    else return;
    e.preventDefault();
  };
  const ticks = p.bars ? ticksOf(p.view, wide ? 9 : 5) : [];
  const style = { "--name": "clamp(18rem, 36%, 30rem)", "--meta": "16.75rem" } as CSSProperties;
  return (
    <div style={style} className="relative">
      <div ref={axis} className="sticky top-(--chrome-top) z-(--z-sticky) border-y border-separator bg-surface type-caption font-medium">
        {wide ? (
          <div className={`grid items-center ${p.bars ? "grid-cols-[var(--name)_minmax(0,1fr)_var(--meta)]" : "grid-cols-[minmax(0,1fr)_var(--meta)]"} h-8`}>
            <span className="ps-3">Branch</span>
            {p.bars && (
              <span className="relative block h-full min-w-0" aria-hidden>
                <span className="absolute inset-y-0 start-2 end-2 block">
                  {ticks.map((t) => (
                    <span key={t.day} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap tnum ${t.major ? "text-primary" : "text-secondary"}`} style={{ left: `${fractionOf(p.view, t.day * DAY) * 100}%` }}>
                      {t.label}
                    </span>
                  ))}
                </span>
              </span>
            )}
            <span className="grid grid-cols-[4rem_4rem_7rem] gap-x-2 pe-3 text-end">
              <span title={`Commits the branch has that ${p.root} lacks`}>Ahead</span>
              <span title={`Commits ${p.root} has that the branch lacks`}>Behind</span>
              <span title="How long before the Build its last commit was made">Last commit</span>
            </span>
          </div>
        ) : p.bars ? (
          <div className="relative h-7" aria-hidden>
            <span className="absolute inset-y-0 start-[34px] end-3 block">
              {ticks.map((t) => (
                <span key={t.day} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap tnum ${t.major ? "text-primary" : "text-secondary"}`} style={{ left: `${fractionOf(p.view, t.day * DAY) * 100}%` }}>
                  {t.label}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      <div ref={list} role="list" aria-label="Branches" className="relative" style={{ height: virtual.getTotalSize() }} onKeyDown={onKeys}>
        {wide && p.bars && (
          <div className="pointer-events-none absolute inset-y-0 start-(--name) end-(--meta)" aria-hidden>
            <div className="absolute inset-y-0 start-2 end-2">
              {ticks.map((t) => (
                <span key={t.day} className="absolute inset-y-0 border-s border-separator" style={{ left: `${fractionOf(p.view, t.day * DAY) * 100}%` }} />
              ))}
            </div>
          </div>
        )}
        {virtual.getVirtualItems().map((v) => {
          const item = p.items[v.index];
          if (!item) return null;
          return (
            <div
              key={v.key}
              role="listitem"
              aria-setsize={p.items.length}
              aria-posinset={v.index + 1}
              onFocusCapture={() => setActive(v.index)}
              className="absolute inset-x-0 top-0 border-b border-separator"
              style={{ height: v.size, transform: `translateY(${v.start - virtual.options.scrollMargin}px)` }}
            >
              {item.kind === "group" ? <GroupRow item={item} index={v.index} active={v.index === here} p={p} /> : <BranchRow item={item} index={v.index} active={v.index === here} p={p} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
