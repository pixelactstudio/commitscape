import { useId, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "../design/tokens";
import { compact, grouped } from "../format";

export type Point = { key: string; label: string; tick?: string } & Record<string, number | string | undefined>;
export type Series = { key: string; label: string; colour: string };


function Tip({ active, payload, title, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: Point }[]; title?: (p: Point) => ReactNode; unit: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="min-w-36 rounded-md border border-line bg-popover px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 font-medium text-primary">{point ? (title?.(point) ?? point.label) : null}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-secondary">
          <span className="flex items-center gap-1.5">
            {payload.length > 1 && <span className="size-2 rounded-full" style={{ background: p.color }} />}
            {payload.length > 1 ? p.name : unit}
          </span>
          <span className="font-medium text-primary tnum">{grouped(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

/** One measure over time as a soft area with a line on top, a tooltip on hover. */
export function AreaTrend({ points, series, height = 240, unit, title }: { points: Point[]; series: Series; height?: number; unit: string; title?: (p: Point) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  return (
    <div style={{ height }} className="fade -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={series.colour} stopOpacity={0.28} />
              <stop offset="100%" stopColor={series.colour} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="key" ticks={points.filter((p) => p.tick).map((p) => p.key)} tickFormatter={(k: string) => points.find((p) => p.key === k)?.tick ?? ""} interval="preserveStartEnd" tick={CHART.tick} tickLine={false} axisLine={false} minTickGap={14} />
          <YAxis tickFormatter={(v: number) => compact(v)} tick={CHART.tick} tickLine={false} axisLine={false} width={38} allowDecimals={false} />
          <Tooltip content={<Tip unit={unit} title={title} />} cursor={{ stroke: "var(--color-border-emphasized)" }} />
          <Area type="monotone" dataKey={series.key} name={series.label} stroke={series.colour} strokeWidth={2} fill={`url(#g${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-surface)" }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Several measures stacked in a column each period, with a legend. */
export function StackedColumns({ points, series, height = 240, unit }: { points: Point[]; series: Series[]; height?: number; unit: string }) {
  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 && (
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 type-micro">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-cell" style={{ background: s.colour }} />
            {s.label}
          </li>
        ))}
      </ul>
      )}
      <div style={{ height }} className="fade -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
            <YAxis tickFormatter={(v: number) => compact(v)} tick={CHART.tick} tickLine={false} axisLine={false} width={38} allowDecimals={false} />
            <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "var(--color-overlay-hover)" }} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.colour} maxBarSize={24} radius={i === series.length - 1 ? [CHART.barRadius, CHART.barRadius, 0, 0] : 0} stroke="var(--color-background-surface)" strokeWidth={1} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
