import { useContext, useMemo, useState, type MouseEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ChevronDown, ChevronRight, Tag } from "lucide-react";
import type { GitBranches, GitTag } from "@commitscape/data";
import { TipCard } from "../charts/Tip";
import { TipContext } from "../charts/tip";
import { ICON } from "../design/tokens";
import { date, duration, grouped, many } from "../format";
import { Quiet } from "../kit/primitives";
import { NoMatch } from "../screens/kit";
import type { Go, Route } from "../route";
import { Brush } from "./Brush";
import { agoOf } from "./model";
import { RangeBar, type Preset } from "./Range";
import { familiesOf, leadOf, nearestTag, type Family } from "./releases";
import { TAGS } from "./states";
import { binTimes, DAY, dayOf, fractionOf, ticksOf, type Span } from "./time";
import { useWidth } from "./useWidth";

const NARROW = 860;
const FIRST = 12;
const MORE = 200;

const ago = (anchor: number, at: number) => agoOf(anchor, at, duration);

function Ticks({ f, view, root }: { f: Family; view: Span; root: string }) {
  const { show, hide } = useContext(TipContext);
  const move = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const inner = box.width - 16;
    if (inner <= 0) return;
    const at = (e.clientX - box.left - 8) / inner;
    const tag = nearestTag(f.tags, (view.from + at * (view.to - view.from)) * DAY);
    if (!tag || Math.abs(fractionOf(view, tag.at) - at) * inner > 8) return hide();
    const i = f.tags.indexOf(tag);
    const before = f.tags[i + 1];
    show(
      e,
      <TipCard
        kicker={f.label}
        icon={<Tag size={ICON.sm} aria-hidden />}
        title={tag.name}
        mono
        rows={[
          { label: "Tagged", value: date(tag.at) },
          ...(before ? [{ label: "After the one before", value: duration((tag.at - before.at) / DAY) }] : []),
          ...(tag.since != null ? [{ label: `Commits on ${root} since`, value: grouped(tag.since) }] : []),
        ]}
      />,
    );
  };
  return (
    <span className="relative block h-full min-w-0" onMouseMove={move} onMouseLeave={hide} aria-hidden>
      <span className="absolute inset-y-0 start-2 end-2 block">
        <span className="absolute inset-x-0 top-1/2 h-px bg-separator" />
        {f.tags.map((t, i) => {
          const x = fractionOf(view, t.at);
          return x >= 0 && x <= 1 ? <span key={t.name} className={`absolute top-1/2 block w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${i === 0 ? "h-5 opacity-100" : "h-3.5 opacity-55"}`} style={{ left: `${x * 100}%`, background: TAGS.colour }} /> : null;
        })}
      </span>
    </span>
  );
}

function TagList({ f, github, anchor }: { f: Family; github: string; anchor: number }) {
  const [shown, setShown] = useState(FIRST);
  const list = f.tags.slice(0, shown);
  const cols = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 sm:grid-cols-[14rem_8rem_9rem_5rem]";
  return (
    <div className="border-t border-separator bg-sunken py-2 ps-9 pe-3">
      <div className={`${cols} hidden pb-1 text-xs font-medium text-secondary sm:grid`} aria-hidden>
        <span>Tag</span>
        <span>Tagged</span>
        <span>After the one before</span>
        <span>Commit</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {list.map((t, i) => {
          const before = f.tags[i + 1];
          const gap = before ? (t.at - before.at) / DAY : null;
          return (
            <li key={t.name} className={`${cols} py-1 text-sm`}>
              <a className="min-w-0 truncate font-mono text-primary" href={`${github}/releases/tag/${encodeURIComponent(t.name)}`} target="_blank" rel="noopener noreferrer" title={`Open ${t.name} on GitHub`}>
                {t.name}
              </a>
              <span className="text-end text-secondary tnum sm:text-start" title={ago(anchor, t.at)}>
                {date(t.at)}
              </span>
              <span className="hidden text-secondary tnum sm:block">{gap === null ? "First" : gap < 1 ? "Same day" : `${duration(gap)} after`}</span>
              <a className="hidden font-mono text-secondary sm:block" href={`${github}/commit/${t.sha}`} target="_blank" rel="noopener noreferrer" title="Open the tagged commit on GitHub">
                {t.sha.slice(0, 7)}
              </a>
            </li>
          );
        })}
      </ul>
      {f.tags.length > shown && (
        <div className="pt-1">
          <Button label={`Show ${many(Math.min(MORE, f.tags.length - shown), "more tag", "more tags")}`} variant="ghost" size="sm" onClick={() => setShown((n) => n + MORE)} />
        </div>
      )}
    </div>
  );
}

function FamilyRow({ f, view, open, onToggle, root, anchor, github, wide }: { f: Family; view: Span; open: boolean; onToggle: () => void; root: string; anchor: number; github: string; wide: boolean }) {
  const head = (
    <button type="button" aria-expanded={open} onClick={onToggle} className="plain-button flex min-w-0 items-center gap-2 ps-3 pe-2 text-start after:absolute after:inset-0 after:content-['']" aria-label={`${f.label}, ${many(f.tags.length, "tag", "tags")}, newest ${f.newest.name}`}>
      {open ? <ChevronDown size={ICON.sm} aria-hidden /> : <ChevronRight size={ICON.sm} aria-hidden />}
      <span className="min-w-0 truncate font-mono text-sm font-medium text-primary" title={f.label}>
        {f.label}
      </span>
      <span className="flex-none text-sm text-secondary tnum">{grouped(f.tags.length)}</span>
    </button>
  );
  const cadence = f.cadence === null ? "one release" : `every ${duration(f.cadence)}`;
  return (
    <div className="border-b border-separator last:border-b-0">
      {wide ? (
        <div className="row-hover relative grid h-10 grid-cols-[15rem_minmax(0,1fr)_26rem] items-center focus-within:bg-hover">
          {head}
          <Ticks f={f} view={view} root={root} />
          <span className="grid grid-cols-[minmax(0,1fr)_6.5rem_7.5rem] items-center gap-2 pe-3 text-sm tnum">
            <span className="truncate font-mono text-primary" title={f.newest.name}>
              {f.newest.name}
            </span>
            <span className="text-end text-secondary" title={date(f.newest.at)}>
              {ago(anchor, f.newest.at)}
            </span>
            <span className="text-end whitespace-nowrap text-secondary" title={f.gaps > 0 ? `The middle of the ${many(f.gaps, "gap", "gaps")} between its newest days with a release` : undefined}>
              {cadence}
            </span>
          </span>
        </div>
      ) : (
        <div className="row-hover relative flex flex-col gap-1 pe-3 ps-0 pt-2 pb-1 focus-within:bg-hover">
          {head}
          <span className="block h-6 ps-3">
            <Ticks f={f} view={view} root={root} />
          </span>
          <span className="ps-9 text-xs text-secondary tnum">
            Newest {f.newest.name}, {ago(anchor, f.newest.at)} · {cadence}
          </span>
        </div>
      )}
      {open && <TagList f={f} github={github} anchor={anchor} />}
    </div>
  );
}

/** The tags on one time axis, a row per family of names, with its newest and its usual gap. */
export function Releases({ data, route, go, github }: { data: GitBranches; route: Route; go: Go; github: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const wide = width === 0 || width >= NARROW;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<Span | null>(null);
  const anchor = data.builtAt;
  const end = dayOf(anchor) + 1;
  const q = (route.q ?? "").trim().toLowerCase();
  const tags = useMemo(() => (q === "" ? data.tags : data.tags.filter((t) => t.name.toLowerCase().includes(q))), [data.tags, q]);
  const families = useMemo(() => familiesOf(tags), [tags]);
  const lead = useMemo(() => leadOf(familiesOf(data.tags)), [data.tags]);
  const extent = useMemo<Span>(() => ({ from: Math.min(end - 30, ...data.tags.map((t: GitTag) => dayOf(t.at))) - 7, to: end }), [data.tags, end]);
  const chosen: Span = route.since !== undefined && route.until !== undefined ? { from: route.since, to: route.until } : extent;
  const view = draft ?? chosen;
  const commit = (span: Span) => go({ since: span.from, until: span.to }, true);
  const presets: Preset[] = [
    { id: "all", label: "All time", span: extent },
    { id: "5y", label: "5 years", span: { from: Math.max(extent.from, end - 5 * 365), to: end } },
    { id: "1y", label: "1 year", span: { from: Math.max(extent.from, end - 365), to: end } },
  ].filter((p, i, all) => all.findIndex((x) => x.span.from === p.span.from) === i);
  const ticks = ticksOf(view, wide ? 9 : 5);
  const bins = useMemo(() => binTimes(data.tags.map((t) => t.at), extent, 96), [data.tags, extent]);
  const hidden = data.tagsTotal - data.tags.length;
  if (data.tags.length === 0) return <Quiet>This repository has no tags. Its releases show here once it tags a version.</Quiet>;
  const sinceLead = lead && lead.newest.since != null ? lead.newest.since : null;
  return (
    <section aria-label="Releases" className="surface overflow-clip">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 type-heading">Releases over time</h2>
          <p className="m-0 type-description">
            {lead ? (
              <>
                The releases of <span className="font-mono">{lead.label}</span> come {lead.cadence === null ? "once" : `about every ${duration(lead.cadence)}`}; the newest is <span className="font-mono">{lead.newest.name}</span> on {date(lead.newest.at)}
                {sinceLead !== null ? `, and ${many(sinceLead, "commit", "commits")} have reached ${data.default} since` : ""}.
              </>
            ) : (
              "Every tag, by the family of its name."
            )}
          </p>
        </div>
        <RangeBar view={view} presets={presets} onPick={commit} />
        <Brush bins={bins} extent={extent} view={view} onPreview={setDraft} onCommit={commit} noun="tags" />
      </div>
      <div ref={box} className="relative">
        <div className="sticky top-(--chrome-top) z-(--z-sticky) border-y border-separator bg-surface type-caption font-medium">
          <div className={`grid h-8 items-center ${wide ? "grid-cols-[15rem_minmax(0,1fr)_26rem]" : "grid-cols-1"}`}>
            {wide && <span className="ps-3">Family</span>}
            <span className="relative block h-full min-w-0" aria-hidden>
              <span className={`absolute inset-y-0 end-2 block ${wide ? "start-2" : "start-5"}`}>
                {ticks.map((t) => (
                  <span key={t.day} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap tnum ${t.major ? "text-primary" : "text-secondary"}`} style={{ left: `${fractionOf(view, t.day * DAY) * 100}%` }}>
                    {t.label}
                  </span>
                ))}
              </span>
            </span>
            {wide && (
              <span className="grid grid-cols-[minmax(0,1fr)_6.5rem_7.5rem] gap-2 pe-3 text-end">
                <span className="text-start">Newest</span>
                <span>Tagged</span>
                <span>Usually</span>
              </span>
            )}
          </div>
        </div>
        {families.length === 0 ? (
          <NoMatch what="tags" query={(route.q ?? "").trim()} onClear={() => go({ q: undefined }, true)} clear="Clear the search" />
        ) : (
          families.map((f) => (
            <FamilyRow
              key={f.key}
              f={f}
              view={view}
              open={open.has(f.key)}
              onToggle={() => setOpen((s) => (s.has(f.key) ? new Set([...s].filter((k) => k !== f.key)) : new Set([...s, f.key])))}
              root={data.default}
              anchor={anchor}
              github={github}
              wide={wide}
            />
          ))
        )}
      </div>
      {hidden > 0 && <p className="m-0 border-t border-separator px-4 py-2 type-caption">{grouped(data.tags.length)} of {grouped(data.tagsTotal)} tags are read: every one named like a version, and the newest of the rest.</p>}
    </section>
  );
}
