import type { ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { PULL_STALE_DAYS, type PullStats } from "@commitscape/data";
import { grouped } from "../format";
import { percent, spanDates, spanParts, spanWords } from "./model";

function Metric({ id, label, value, unit, note, pending = false }: { id: string; label: string; value?: ReactNode; unit?: string | undefined; note?: ReactNode; pending?: boolean }) {
  return (
    <div data-stat={id} className="flex min-w-0 flex-col gap-1 bg-surface px-3.5 py-3 sm:px-5 sm:py-3.5">
      <span className="type-label">{label}</span>
      {pending ? (
        <Skeleton height={29} width="42%" radius={2} />
      ) : (
        <span className="flex items-baseline gap-1 type-stat">
          <span data-value>{value}</span>
          {unit && <span className="type-label text-secondary">{unit}</span>}
        </span>
      )}
      <span className="type-caption min-h-[4.2em] text-pretty sm:min-h-[1.4em] lg:min-h-[2.8em]">{pending ? <Skeleton height={14} width="80%" radius={1} /> : note}</span>
    </div>
  );
}

function Time({ seconds }: { seconds: number | null }): { value: ReactNode; unit: string | undefined } {
  if (seconds === null) return { value: "—", unit: undefined };
  const [n, unit] = spanParts(seconds);
  return { value: n, unit };
}

/** The numbers over the Window, each saying what it counts and how many pull requests it is of. */
export function Summary({ stats }: { stats: PullStats }) {
  const { mergeTime: m, firstReview: f, unreviewed: u } = stats;
  const median = Time({ seconds: m.median });
  const p90 = Time({ seconds: m.p90 });
  const first = Time({ seconds: f.median });
  const all = stats.span.since === null;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4" role="group" aria-label="Pull request numbers over the Window">
      <Metric id="opened" label="Opened" value={grouped(stats.opened)} note={all ? "Opened over all time" : `Opened ${spanDates(stats.span)}`} />
      <Metric id="merged" label="Merged" value={grouped(stats.merged)} note={`Merged in the Window${stats.closed > 0 ? `; ${grouped(stats.closed)} closed without merging` : ""}`} />
      <Metric id="median-merge" label="Time to merge, median" value={median.value} unit={median.unit} note={m.n === 0 ? "None was merged in the Window" : `Half of the ${grouped(m.n)} merged took ${spanWords(m.median ?? 0)} or less`} />
      <Metric id="p90-merge" label="Time to merge, 90th percentile" value={p90.value} unit={p90.unit} note={m.n === 0 ? "None was merged in the Window" : `Nine in ten of the ${grouped(m.n)} merged took ${spanWords(m.p90 ?? 0)} or less`} />
      <Metric
        id="first-review"
        label="First review, median"
        value={first.value}
        unit={first.unit}
        note={f.of === 0 ? "None was opened in the Window" : f.n === 0 ? `None of the ${grouped(f.of)} opened was reviewed` : `For the ${grouped(f.n)} of ${grouped(f.of)} opened that someone else reviewed`}
      />
      <Metric id="unreviewed" label="Merged without review" value={percent(u.n, u.of)} note={u.of === 0 ? "None was merged in the Window" : `${grouped(u.n)} of ${grouped(u.of)} merged had no review from anyone else`} />
      <Metric id="open" label="Open now" value={grouped(stats.open)} note="Open now, of any age" />
      <Metric id="idle" label={`Idle over ${PULL_STALE_DAYS} days`} value={grouped(stats.idle)} note={`${stats.open > 0 ? `${percent(stats.idle, stats.open)} of the open ones: ` : "Open ones "}quiet on GitHub for ${PULL_STALE_DAYS} days or more`} />
    </div>
  );
}

/** The numbers' grid while they are on their way, at the size they will be. */
export function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4" role="status" aria-busy="true" aria-label="Loading the numbers">
      {["Opened", "Merged", "Time to merge, median", "Time to merge, 90th percentile", "First review, median", "Merged without review", "Open now", `Idle over ${PULL_STALE_DAYS} days`].map((label) => (
        <Metric key={label} id={label} label={label} pending />
      ))}
    </div>
  );
}
