import type { ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { PullStats } from "@commitscape/data";
import { TableView } from "../charts/common";
import { TipCard } from "../charts/Tip";
import { useTip } from "../charts/tip";
import { Face } from "../components/Face";
import { useStanding } from "../components/Name";
import { compact, grouped, many } from "../format";
import { A } from "../kit/A";
import { Quiet } from "../kit/primitives";
import { BANDS, percent, periodsOf, periodTick, periodWords, SERIES, spanWords, type Period } from "./model";

const PLOT = 152;

const THROUGHPUT = "Pull requests opened in each period of the Window, beside those settled by merging or by closing without merging.";
const BANDS_CAPTION = "How long the pull requests merged in the Window were open before they merged.";
const REVIEWERS_CAPTION = "Who first reviewed the most pull requests in the Window, and how soon after each was opened.";

export function Box({ title, caption, children, className = "", as: Heading = "h3", action }: { title: string; caption?: ReactNode; children: ReactNode; className?: string; as?: "h2" | "h3"; action?: ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-3 surface p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading className="m-0 type-heading">{title}</Heading>
          {caption && <p className="m-0 type-caption text-pretty">{caption}</p>}
        </div>
        {action && <span className="flex-none">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function axisOf(values: number[]): { max: number; clipped: boolean } {
  const peak = Math.max(0, ...values);
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const typical = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
  if (sorted.length >= 8 && peak > typical * 3) return { max: niceMax(typical * 1.6), clipped: true };
  return { max: niceMax(peak), clipped: false };
}

function niceMax(value: number): number {
  if (value <= 4) return value <= 2 ? 2 : 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10].find((k) => k * power >= value) ?? 10;
  return step * power;
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="size-2.5 flex-none rounded-cell" style={{ background: colour }} />
      {label}
    </li>
  );
}

function Column({ p, index, unit, max, until, count }: { p: Period; index: number; unit: Parameters<typeof periodWords>[1]; max: number; until: number; count: number }) {
  const tip = useTip();
  const high = (n: number) => `${Math.min(100, (n * 100) / max)}%`;
  const partial = p.to > until + 1;
  const settled = p.merged + p.closed;
  const over = p.opened > max || settled > max;
  const content = (
    <TipCard
      kicker={over ? "Above the axis" : partial ? "So far" : undefined}
      title={periodWords(p, unit)}
      rows={[
        { label: "Opened", value: grouped(p.opened), swatch: SERIES.opened },
        { label: "Merged", value: grouped(p.merged), swatch: SERIES.merged },
        { label: "Closed without merging", value: grouped(p.closed), swatch: SERIES.closed },
      ]}
    />
  );
  return (
    <div className="group relative h-full min-w-0 flex-1 hover:bg-hover" {...tip(content)} data-period={index}>
      <div className="absolute inset-x-px bottom-0 flex h-full items-end justify-center gap-px" style={{ opacity: partial ? 0.6 : 1 }}>
        <span className="block w-full max-w-2.5 rounded-t-xs" style={{ height: high(p.opened), minHeight: p.opened > 0 ? 2 : 0, background: SERIES.opened }} />
        <span className="flex w-full max-w-2.5 flex-col-reverse" style={{ height: high(settled), minHeight: settled > 0 ? 2 : 0 }}>
          <span className="block w-full" style={{ height: `${settled === 0 ? 0 : (p.merged * 100) / settled}%`, background: SERIES.merged, borderRadius: p.closed === 0 ? "var(--radius-xs) var(--radius-xs) 0 0" : 0 }} />
          <span className="block w-full flex-1 rounded-t-xs" style={{ background: SERIES.closed, display: p.closed === 0 ? "none" : "block" }} />
        </span>
      </div>
      {over && <span aria-hidden className="absolute inset-x-0 top-0 mx-auto h-0.5 w-full max-w-5 bg-primary" />}
      <span className="sr-only">{count > 0 ? `${periodWords(p, unit)}: ${p.opened} opened, ${p.merged} merged, ${p.closed} closed` : ""}</span>
    </div>
  );
}

/** Pull requests opened, merged and closed without merging in each period of the Window: a column of two bars, what came in and what was settled. */
export function Throughput({ stats }: { stats: PullStats }) {
  const series = stats.months;
  const folded = series ? periodsOf(series) : null;
  const periods = folded?.periods ?? [];
  const unit = folded?.unit ?? "month";
  const { max, clipped } = axisOf(periods.map((p) => Math.max(p.opened, p.merged + p.closed)));
  const total = stats.opened + stats.merged + stats.closed;
  const grid = [max, max / 2, 0];
  return (
    <Box
      title={`Throughput by ${unit}`}
      caption={THROUGHPUT}
      className="md:col-span-2 xl:col-span-6"
      as="h2"
      action={periods.length > 0 && total > 0 ? <TableView className="flex" title={`Pull requests by ${unit}`} head={[unit[0]?.toUpperCase() + unit.slice(1), "Opened", "Merged", "Closed without merging"]} rows={periods.map((p) => [periodWords(p, unit), p.opened, p.merged, p.closed])} /> : undefined}
    >
      {total === 0 || periods.length === 0 ? (
        <Quiet>No pull request was opened, merged or closed in the Window.</Quiet>
      ) : (
        <>
          <div role="img" aria-label={`${grouped(stats.opened)} opened, ${grouped(stats.merged)} merged and ${grouped(stats.closed)} closed without merging, by ${unit}; the Numbers button lists them`} className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col ps-9" style={{ minHeight: PLOT }}>
              <div className="pointer-events-none absolute inset-y-0 start-0 end-0" aria-hidden>
                {grid.map((v, i) => (
                  <div key={v} className="absolute inset-x-0 flex items-center" style={{ top: `${i * 50}%`, transform: i === 0 ? "none" : i === 2 ? "translateY(-100%)" : "translateY(-50%)" }}>
                    <span className="w-8 flex-none pe-1 text-end type-micro tnum">{compact(v)}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                ))}
              </div>
              <div className="relative flex flex-1">
                {periods.map((p, i) => (
                  <Column key={p.from} p={p} index={i} unit={unit} max={max} until={stats.span.until} count={periods.length} />
                ))}
              </div>
            </div>
            <div className="relative flex h-5 flex-none ps-9" aria-hidden>
              {periods.map((p, i) => (
                <span key={p.from} className="relative min-w-0 flex-1">
                  <span className="absolute start-0 top-1 whitespace-nowrap type-micro tnum">{periodTick(p, unit, i, periods.length)}</span>
                </span>
              ))}
            </div>
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 type-micro">
            <Key colour={SERIES.opened} label="Opened" />
            <Key colour={SERIES.merged} label="Merged" />
            <Key colour={SERIES.closed} label="Closed without merging" />
            {clipped && (
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 flex-none bg-primary" />A bar cut at the top is taller than the axis: hover it for the number
              </li>
            )}
          </ul>
        </>
      )}
    </Box>
  );
}

/** How long the pull requests merged in the Window took, in five bands. */
export function MergeBands({ stats }: { stats: PullStats }) {
  const { bands, n } = stats.mergeTime;
  const max = Math.max(1, ...bands);
  return (
    <Box title="Time to merge" caption={BANDS_CAPTION} className="xl:col-span-3" as="h2">
      {n === 0 ? (
        <Quiet>Nothing was merged in the Window.</Quiet>
      ) : (
        <ol className="m-0 flex flex-1 list-none flex-col justify-between gap-2.5 p-0" aria-label="Pull requests merged, by time to merge">
          {BANDS.map((label, i) => (
            <li key={label} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-x-3" title={`${grouped(bands[i] ?? 0)} of ${grouped(n)} merged pull requests`}>
              <span className="truncate text-sm text-secondary">{label}</span>
              <span className="block h-2.5 overflow-hidden rounded-full bg-track" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${Math.max((bands[i] ?? 0) > 0 ? 2 : 0, ((bands[i] ?? 0) * 100) / max)}%`, background: SERIES.merged }} />
              </span>
              <span className="min-w-[4.5rem] text-end text-sm tnum">
                {grouped(bands[i] ?? 0)} <span className="text-tertiary">{percent(bands[i] ?? 0, n)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {n > 0 && stats.mergeTime.median !== null && stats.mergeTime.p90 !== null && (
        <p className="m-0 border-t border-separator pt-3 type-caption tnum">
          Median {spanWords(stats.mergeTime.median)}, 90th percentile {spanWords(stats.mergeTime.p90)}.
        </p>
      )}
    </Box>
  );
}

function Reviewer({ r, max }: { r: PullStats["reviewers"][number]; max: number }) {
  const standing = useStanding(r.login);
  const name = standing ? (
    <A href={standing} className="inline-link min-w-0 truncate text-sm">
      {r.login}
    </A>
  ) : (
    <span className="min-w-0 truncate text-sm font-medium">{r.login}</span>
  );
  return (
    <li className="flex items-center gap-2.5" title={`${r.login}: ${many(r.reviews, "review", "reviews")} on ${many(r.pulls, "pull request", "pull requests")}${r.median === null ? "" : `, the first one a median of ${spanWords(r.median)} after it was opened`}`}>
      <Face login={r.login} name={r.login} size={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          {name}
          <span className="flex-none text-sm tnum">{grouped(r.pulls)}</span>
        </span>
        <span className="block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.pulls * 100) / max)}%`, background: SERIES.opened }} />
        </span>
        <span className="type-micro tnum">{r.median === null ? `${many(r.reviews, "review", "reviews")}` : `${many(r.reviews, "review", "reviews")} · first after ${spanWords(r.median)}`}</span>
      </span>
    </li>
  );
}

/** Who reviewed the most pull requests in the Window, and how soon after each was opened. */
export function ReviewerLoad({ stats }: { stats: PullStats }) {
  const list = stats.reviewers.slice(0, 5);
  const max = Math.max(1, ...list.map((r) => r.pulls));
  return (
    <Box title="Reviewer load" caption={REVIEWERS_CAPTION} className="xl:col-span-3" as="h2">
      {list.length === 0 ? (
        <Quiet>Nobody reviewed a pull request in the Window.</Quiet>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Reviewers, the busiest first">
          {list.map((r) => (
            <Reviewer key={r.login} r={r} max={max} />
          ))}
        </ol>
      )}
    </Box>
  );
}

/** The three charts while the numbers are on their way. */
export function ChartsSkeleton() {
  return (
    <>
      <Box title="Throughput" caption={THROUGHPUT} className="md:col-span-2 xl:col-span-6" as="h2">
        <div className="min-h-[172px] flex-1">
          <Skeleton height="100%" radius={2} />
        </div>
        <Skeleton height={16} width="40%" radius={1} />
      </Box>
      <Box title="Time to merge" caption={BANDS_CAPTION} className="xl:col-span-3" as="h2">
        <div className="flex flex-col gap-3.5">
          {BANDS.map((b, i) => (
            <Skeleton key={b} height={12} radius={1} index={i} />
          ))}
        </div>
      </Box>
      <Box title="Reviewer load" caption={REVIEWERS_CAPTION} className="xl:col-span-3" as="h2">
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={36} radius={2} index={i} />
          ))}
        </div>
      </Box>
    </>
  );
}
