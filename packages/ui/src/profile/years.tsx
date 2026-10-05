import { useId, useMemo, useState, type ReactNode } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Profile } from "@commitscape/data";
import { StackedColumns, type Point } from "../charts/Trend";
import { compact, grouped, many } from "../format";
import { Panel } from "../kit/layout";
import { Nothing } from "../motion";
import { DAY, monthKey, monthLabel, monthsBetween } from "./days";

const OUTCOMES = [
  { key: "merged", label: "Merged", colour: "var(--s7)" },
  { key: "open", label: "Still open", colour: "var(--s3)" },
  { key: "closed", label: "Closed unmerged", colour: "var(--other)" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["key"];
type Month = { key: string; label: string; tick?: string; contributions: number; merged: number; open: number; closed: number; read: boolean };

const axis = { fontSize: 11, fill: "var(--color-text-secondary)" };
const Y_WIDTH = 38;

function monthsOf(profile: Profile, full: Profile | null): { list: Month[]; since: string | null } {
  const source = full ?? profile;
  const contributions = new Map(profile.months.map((m) => [m.month, m.contributions]));
  const prs = new Map<string, { merged: number; open: number; closed: number }>();
  let since: string | null = null;
  for (const m of source.months) {
    if (!m.prs || m.prs.merged + m.prs.open + m.prs.closed === 0) continue;
    if (!since || m.month < since) since = m.month;
    prs.set(m.month, m.prs);
  }
  const keys = [...profile.months.filter((m) => m.contributions > 0).map((m) => m.month), ...prs.keys()].sort();
  if (keys.length === 0) return { list: [], since };
  const last = monthKey(Math.floor(profile.fetchedAt / DAY));
  const capped = source.read.prs < source.read.prsTotal;
  const list = monthsBetween(keys[0] ?? last, last > (keys.at(-1) ?? "") ? last : (keys.at(-1) ?? last)).map((key) => {
    const p = prs.get(key) ?? { merged: 0, open: 0, closed: 0 };
    const mm = key.slice(5);
    return { key, label: monthLabel(key), tick: mm === "01" ? key.slice(0, 4) : undefined, contributions: contributions.get(key) ?? 0, ...p, read: !capped || (since !== null && key >= since) };
  });
  return { list, since };
}

/** Whether a Profile carries its pull requests month by month. */
function hasPrMonths(p: Profile | null): p is Profile {
  return !!p && p.read.complete && (p.read.prs === 0 || p.months.some((m) => m.prs));
}

function MonthTip({ active, payload, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Month }[]; unit?: string }) {
  if (!active || !payload?.length) return null;
  const m = payload[0]?.payload;
  if (!m) return null;
  const prs = m.merged + m.open + m.closed;
  return (
    <div className="min-w-44 rounded-[var(--radius-element)] border border-line bg-popover px-3 py-2 text-[0.8rem] shadow-[var(--shadow-med)]">
      <div className="mb-1 font-medium text-primary">{m.label}</div>
      <div className="flex justify-between gap-4 text-secondary">
        <span>Contributions</span>
        <span className="font-medium text-primary tnum">{grouped(m.contributions)}</span>
      </div>
      {unit !== "contributions" && (
        <>
          <div className="mt-1 flex justify-between gap-4 text-secondary">
            <span>Pull requests opened</span>
            <span className="font-medium text-primary tnum">{m.read ? grouped(prs) : "not read"}</span>
          </div>
          {m.read &&
            prs > 0 &&
            OUTCOMES.map((o) => (
              <div key={o.key} className="flex items-center justify-between gap-4 ps-3 text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: o.colour }} />
                  {o.label}
                </span>
                <span className="tnum">{grouped(m[o.key])}</span>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function coverage(full: Profile | null, given: Profile | null, since: string | null): string {
  if (!full) return given ? "Pull requests by month arrive with their next read from GitHub." : "Reading their pull requests…";
  const counted = full.months.reduce((n, m) => n + (m.prs ? m.prs.merged + m.prs.open + m.prs.closed : 0), 0);
  const total = full.read.prsTotal;
  if (counted >= total) return `All ${grouped(total)} of their pull requests, in the month each was opened.`;
  if (counted >= full.read.prs) return `From the newest ${grouped(counted)} of their ${grouped(total)} pull requests, back to ${since ? monthLabel(since) : "the start"}; older months are not read.`;
  return `From ${grouped(counted)} of their ${grouped(total)} pull requests; the rest arrive with their next read from GitHub.`;
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-secondary">{label}</span>
      <span className="truncate text-[0.95rem] font-semibold tracking-[-0.01em] tnum">{value}</span>
      {note && <span className="truncate text-xs text-secondary">{note}</span>}
    </div>
  );
}

/** Contributions month by month with the pull requests opened each month beneath, split by how they ended; or every year by kind. */
export function OverTheYears({ profile, full: given = null }: { profile: Profile; full?: Profile | null }) {
  const full = hasPrMonths(given) ? given : hasPrMonths(profile) ? profile : null;
  const [by, setBy] = useState<"month" | "year">("month");
  const [hidden, setHidden] = useState<Outcome[]>([]);
  const id = useId().replace(/:/g, "");
  const sync = `years${id}`;
  const { list: months, since } = useMemo(() => monthsOf(profile, full), [profile, full]);
  const years = useMemo<Point[]>(() => profile.years.filter((y) => y.commits + y.prs + y.reviews + y.issues > 0).map((y) => ({ key: String(y.year), label: String(y.year), commits: y.commits, prs: y.prs, reviews: y.reviews, issues: y.issues })), [profile.years]);
  const first = new Date(profile.calendar.firstDay * DAY * 1000).getUTCFullYear();
  if (profile.totals.contributions === 0 && months.length === 0)
    return (
      <Panel title="Over the years" description="Contributions since they joined GitHub" className="h-full [&>*]:h-full">
        <Nothing title="Nothing on the timeline yet" words="Once they commit, open a pull request or review one, it shows up here month by month." compact />
      </Panel>
    );
  const busiest = months.reduce<Month | null>((b, m) => (m.contributions > (b?.contributions ?? 0) ? m : b), null);
  const contributed = profile.totals.contributions > 0;
  const read = months.filter((m) => m.read);
  const opened = read.reduce((n, m) => n + m.merged + m.open + m.closed, 0);
  const merged = read.reduce((n, m) => n + m.merged, 0);
  const mostPrs = read.reduce<Month | null>((b, m) => (m.merged + m.open + m.closed > (b ? b.merged + b.open + b.closed : 0) ? m : b), null);
  const ticks = months.filter((m) => m.tick).map((m) => m.key);
  const shown = OUTCOMES.filter((o) => !hidden.includes(o.key));
  return (
    <Panel
      title="Over the years"
      description={`${many(profile.totals.contributions, "contribution", "contributions")} since ${first}`}
      className="h-full [&>*]:h-full"
      actions={
        years.length > 0 && (
        <SegmentedControl label="Show the years by" size="sm" value={by} onChange={(v) => setBy(v as "month" | "year")}>
          <SegmentedControlItem value="month" label="By month" />
          <SegmentedControlItem value="year" label="By year" />
        </SegmentedControl>
        )
      }
    >
      {by === "month" || years.length === 0 ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Fact label="Busiest month" value={busiest ? grouped(busiest.contributions) : "—"} note={busiest ? busiest.label : "no contributions counted"} />
            <Fact label="Most pull requests" value={full ? (mostPrs ? grouped(mostPrs.merged + mostPrs.open + mostPrs.closed) : "0") : <Skeleton height={16} width={40} radius={1} />} note={full ? (mostPrs ? `opened in ${mostPrs.label}` : "none opened") : "reading"} />
            <Fact label="Merged" value={full ? (opened > 0 ? `${Math.round((merged * 100) / opened)}%` : "—") : <Skeleton height={16} width={40} radius={1} />} note={full ? (opened > 0 ? `${grouped(merged)} of ${grouped(opened)} opened` : "none opened") : "reading"} />
          </div>
          {contributed && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-secondary">Contributions a month</span>
            <div className="fade -mx-1 h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={months} syncId={sync} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`c${id}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="key" hide />
                  <YAxis tickFormatter={(v: number) => compact(v)} tick={axis} tickLine={false} axisLine={false} width={Y_WIDTH} allowDecimals={false} tickCount={3} />
                  <Tooltip content={<MonthTip unit="contributions" />} cursor={{ stroke: "var(--color-border-emphasized)" }} />
                  <Area type="monotone" dataKey="contributions" name="Contributions" stroke="var(--brand)" strokeWidth={2} fill={`url(#c${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-surface)" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span className="text-xs font-medium text-secondary">Pull requests opened a month, by how they ended</span>
              {(!full || opened > 0) && <span className="flex flex-wrap gap-1" role="group" aria-label="Show pull requests that were">
                {OUTCOMES.map((o) => {
                  const on = !hidden.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHidden(on ? [...hidden, o.key] : hidden.filter((h) => h !== o.key))}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors ${on ? "border-line bg-[var(--color-background-body)] text-primary" : "border-dashed border-line bg-transparent text-secondary line-through"}`}
                    >
                      <span className="size-2 rounded-full" style={{ background: on ? o.colour : "var(--color-track)" }} />
                      {o.label}
                    </button>
                  );
                })}
              </span>}
            </div>
            {full && opened === 0 ? (
              <p className="m-0 rounded-[var(--radius-element)] border border-dashed border-line px-4 py-5 text-center text-sm text-secondary">No pull requests opened yet. Each one they open lands here, in its month.</p>
            ) : full ? (
              <div className="fade -mx-1 h-[124px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} syncId={sync} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="12%">
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="key" ticks={ticks} tickFormatter={(k: string) => months.find((m) => m.key === k)?.tick ?? ""} interval="preserveStartEnd" tick={axis} tickLine={false} axisLine={false} minTickGap={14} />
                    <YAxis tickFormatter={(v: number) => compact(v)} tick={axis} tickLine={false} axisLine={false} width={Y_WIDTH} allowDecimals={false} tickCount={3} />
                    <Tooltip content={<MonthTip />} cursor={{ fill: "var(--color-overlay-hover)" }} />
                    {shown.map((o, i) => (
                      <Bar key={o.key} dataKey={o.key} name={o.label} stackId="prs" fill={o.colour} maxBarSize={18} radius={i === shown.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Skeleton height={124} radius={2} />
            )}
            {(!full || opened > 0) && <span className="text-xs text-pretty text-secondary">
              {coverage(full, given, since)}
            </span>}
          </div>
        </div>
      ) : (
        <StackedColumns
          points={years}
          unit="contributions"
          height={318}
          series={[
            { key: "commits", label: "Commits", colour: "var(--s1)" },
            { key: "prs", label: "Pull requests", colour: "var(--s7)" },
            { key: "reviews", label: "Reviews", colour: "var(--s3)" },
            { key: "issues", label: "Issues", colour: "var(--s4)" },
          ]}
        />
      )}
    </Panel>
  );
}
