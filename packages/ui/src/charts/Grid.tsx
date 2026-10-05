import { grouped, many, share } from "../format";
import { TableView } from "./common";
import { useTip } from "./tip";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

function step(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n / max) * 4)));
}

const green = (s: number) => (s === 0 ? "var(--empty)" : `var(--green-${s})`);

export type Peak = { day: number; hour: number; commits: number; times: number };

/** The busiest weekday and hour of a week of commits, and how many times a typical hour it is. */
export function peakOf(week: number[][]): Peak | null {
  let best: Peak | null = null;
  const all = week.flat().reduce((a, b) => a + b, 0);
  week.forEach((hours, day) =>
    hours.forEach((commits, hour) => {
      if (commits > 0 && (!best || commits > best.commits)) best = { day, hour, commits, times: 0 };
    }),
  );
  if (!best) return null;
  const found: Peak = best;
  return { ...found, times: all > 0 ? found.commits / (all / 168) : 0 };
}

/** Commits by weekday and hour as a heat map of cells on the authors' own clocks, with each hour's and each day's totals beside it and the busiest hour ringed. */
export function WeekGrid({ week, unit = "commits", totals = true }: { week: number[][]; unit?: string; totals?: boolean }) {
  const tip = useTip();
  const max = Math.max(0, ...week.flat());
  const all = week.flat().reduce((a, b) => a + b, 0);
  const peak = peakOf(week);
  const byHour = Array.from({ length: 24 }, (_, h) => week.reduce((n, hours) => n + (hours[h] ?? 0), 0));
  const byDay = week.map((hours) => hours.reduce((a, b) => a + b, 0));
  const hourMost = Math.max(1, ...byHour);
  const dayMost = Math.max(1, ...byDay);
  const average = all / 168;
  const columns = totals ? "grid-cols-[2.1rem_repeat(24,minmax(0,1fr))] sm:grid-cols-[2.4rem_repeat(24,minmax(0,1fr))_4rem]" : "grid-cols-[2.1rem_repeat(24,minmax(0,1fr))]";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={`grid ${columns} items-end gap-[3px] text-[0.68rem] text-secondary tnum`} role="img" aria-label={`${unit} by weekday and hour, on each author's own clock`}>
        {totals && (
          <>
            <span aria-hidden />
            {byHour.map((n, h) => (
              <span
                key={`h${h}`}
                className="flex h-7 items-end"
                {...tip(
                  <>
                    <strong>
                      {hh(h)} to {hh(h + 1)}
                    </strong>
                    <div className="note">
                      {many(n, unit === "commits" ? "commit" : unit, unit)} across the week · {share(n, all)}
                    </div>
                  </>,
                )}
              >
                <span className="block w-full rounded-t-[2px] bg-[var(--green-2)] opacity-70" style={{ height: `${Math.max(n > 0 ? 6 : 0, (n * 100) / hourMost)}%` }} />
              </span>
            ))}
            <span aria-hidden className="hidden sm:block" />
          </>
        )}
        {week.map((hours, d) => (
          <div key={d} className="contents">
            <span className="self-center pe-1 text-end">{WEEKDAYS[d]?.slice(0, 3)}</span>
            {hours.map((n, h) => {
              const top = peak !== null && peak.day === d && peak.hour === h;
              return (
                <span
                  key={h}
                  className={`aspect-square rounded-[3px] transition-[filter] hover:brightness-125 ${top ? "outline-2 outline-offset-1 outline-[var(--color-text-primary)] outline-solid" : ""}`}
                  style={{ background: green(step(n, max)) }}
                  {...tip(
                    <>
                      <strong>
                        {WEEKDAYS[d]}s, {hh(h)} to {hh(h + 1)}
                      </strong>
                      <div>{many(n, unit === "commits" ? "commit" : unit, unit)}</div>
                      {n > 0 && (
                        <div className="note">
                          {share(n, all)} of all{average > 0 ? ` · ${(n / average).toFixed(n / average >= 10 ? 0 : 1)}× a typical hour` : ""}
                          {top ? " · the busiest hour" : ""}
                        </div>
                      )}
                    </>,
                  )}
                />
              );
            })}
            {totals && (
              <span className="hidden h-full items-center gap-1.5 ps-1.5 sm:flex" title={`${grouped(byDay[d] ?? 0)} on ${WEEKDAYS[d]}s`}>
                <span className="flex w-5 flex-none">
                  <span className="block h-1.5 rounded-full bg-[var(--green-2)] opacity-70" style={{ width: `${Math.max((byDay[d] ?? 0) > 0 ? 12 : 0, ((byDay[d] ?? 0) * 100) / dayMost)}%` }} />
                </span>
                <span className="whitespace-nowrap">{share(byDay[d] ?? 0, all)}</span>
              </span>
            )}
          </div>
        ))}
        <span aria-hidden />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={`l${h}`} className="relative h-4">
            {h % 6 === 0 && <span className="absolute start-0 top-0.5 whitespace-nowrap">{hh(h)}</span>}
          </span>
        ))}
        {totals && <span aria-hidden className="hidden sm:block" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-secondary">
        <TableView head={["Day", ...Array.from({ length: 24 }, (_, h) => `${h}`)]} rows={week.map((hours, d) => [WEEKDAYS[d] ?? "", ...hours])} />
        <span className="flex items-center gap-1.5" aria-label={`From none to ${grouped(max)} ${unit} in one hour of the week`}>
          <span className="tnum">0</span>
          {[0, 1, 2, 3, 4].map((s) => (
            <span key={s} aria-hidden className="inline-block size-[11px] rounded-[3px]" style={{ background: green(s) }} />
          ))}
          <span className="tnum">
            {grouped(max)} {unit} in an hour
          </span>
        </span>
      </div>
    </div>
  );
}
