import { useId, type ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from "recharts";
import { CHART } from "../design/tokens";

const TICK = { ...CHART.tick, style: { fontVariantNumeric: "tabular-nums" } } as const;
import { compact, grouped } from "../format";
import { TipCard } from "./Tip";
import { useHydrated } from "./hydrated";
import { niceTicks } from "./ticks";

export type Point = { key: string; label: string; tick?: string; title?: string } & Record<string, number | string | undefined>;
export type Series = { key: string; label: string; colour: string };

type Payload = { name?: string; value?: number; color?: string; dataKey?: string | number; payload?: Point };

function Tip({ active, payload, title, unit, hint, focus }: { active?: boolean; payload?: Payload[]; title?: (p: Point) => ReactNode; unit: string; hint?: string; focus?: string | null }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const total = payload.reduce((n, p) => n + (p.value ?? 0), 0);
  const many = payload.length > 1;
  const rows = many
    ? [...payload]
        .filter((p) => (p.value ?? 0) > 0)
        .reverse()
        .map((p) => ({ label: <span className={focus && String(p.dataKey) !== focus ? "opacity-60" : ""}>{p.name}</span>, value: grouped(p.value ?? 0), swatch: p.color }))
    : [];
  return (
    <div className="rounded-lg border border-line bg-raised text-primary shadow-lg">
      <TipCard title={point ? (title?.(point) ?? point.title ?? point.label) : ""} value={grouped(total)} unit={unit} rows={rows} hint={total > 0 ? hint : undefined} />
    </div>
  );
}

const indexOf = (s: { activeTooltipIndex?: number | string | null } | null | undefined) => {
  const i = Number(s?.activeTooltipIndex);
  return Number.isInteger(i) && i >= 0 ? i : null;
};

/** One measure over time as a soft area with a line on top, a tooltip on hover; a click on a period picks it. */
export function AreaTrend({ points, series, height = 240, unit, title, onPick, hint, plain = false }: { points: Point[]; series: Series; height?: number; unit: string; title?: (p: Point) => ReactNode; onPick?: (p: Point) => void; hint?: string; plain?: boolean }) {
  const id = useId().replace(/:/g, "");
  const ticks = niceTicks(Math.max(0, ...points.map((p) => Number(p[series.key] ?? 0))));
  const hydrated = useHydrated();
  if (!hydrated) return <Skeleton height={height} />;
  return (
    <div style={{ height }} className={`fade -mx-1 ${onPick ? "[&_.recharts-surface]:cursor-pointer" : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          accessibilityLayer={!plain}
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onClick={(s) => {
            const i = indexOf(s);
            const p = i === null ? undefined : points[i];
            if (p && onPick && Number(p[series.key] ?? 0) > 0) onPick(p);
          }}
        >
          <defs>
            <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={series.colour} stopOpacity={0.14} />
              <stop offset="100%" stopColor={series.colour} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="key" ticks={points.filter((p) => p.tick).map((p) => p.key)} tickFormatter={(k: string) => points.find((p) => p.key === k)?.tick ?? ""} interval="preserveStartEnd" tick={TICK} tickLine={false} axisLine={false} minTickGap={14} />
          <YAxis tickFormatter={(v: number) => compact(v)} tick={TICK} tickLine={false} axisLine={false} width={38} allowDecimals={false} ticks={ticks} domain={[0, ticks.at(-1) ?? 1]} />
          <Tooltip content={<Tip unit={unit} title={title} hint={onPick ? (hint ?? "Select for these commits") : undefined} />} cursor={{ stroke: "var(--color-border-emphasized)" }} />
          <Area type="linear" dataKey={series.key} name={series.label} stroke={series.colour} strokeWidth={2} fill={`url(#g${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-surface)" }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const BAR_MAX = 24;
const GAP = 2;
const ROUND = 4;

function Segment({ x, y, width, height, fill, fillOpacity, top }: BarShapeProps & { top: boolean }) {
  if (!(height > 0) || !(width > 0)) return null;
  const lift = top ? 0 : Math.min(GAP, height - 1);
  const y0 = y + lift;
  const h = height - lift;
  const r = top ? Math.min(ROUND, width / 2, h) : 0;
  const d = `M${x},${y0 + h}V${y0 + r}${r > 0 ? `Q${x},${y0} ${x + r},${y0}H${x + width - r}Q${x + width},${y0} ${x + width},${y0 + r}` : `H${x + width}`}V${y0 + h}Z`;
  return <path d={d} fill={fill} fillOpacity={fillOpacity} />;
}

/** Several measures stacked in a column each period; one series can be brought forward, and a click on a column, or on one series in it, picks it. */
export function StackedColumns({ points, series, height = 240, unit, focus = null, onPick, hint, plain = false }: { points: Point[]; series: Series[]; height?: number; unit: string; focus?: string | null; onPick?: (p: Point, series: string | null) => void; hint?: string; plain?: boolean }) {
  const ticks = niceTicks(Math.max(0, ...points.map((p) => series.reduce((n, s) => n + Number(p[s.key] ?? 0), 0))));
  const ticked = points.some((p) => p.tick);
  const hydrated = useHydrated();
  if (!hydrated) return <Skeleton height={height} />;
  return (
    <div style={{ height }} className={`fade -mx-1 ${onPick ? "[&_.recharts-surface]:cursor-pointer" : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer={!plain}
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="22%"
          onClick={(s) => {
            const i = indexOf(s);
            const p = i === null ? undefined : points[i];
            if (p && onPick && series.some((x) => Number(p[x.key] ?? 0) > 0)) onPick(p, focus);
          }}
        >
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          {ticked ? (
            <XAxis dataKey="key" ticks={points.filter((p) => p.tick).map((p) => p.key)} tickFormatter={(k: string) => points.find((p) => p.key === k)?.tick ?? ""} tick={TICK} tickLine={false} axisLine={false} interval={0} />
          ) : (
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
          )}
          <YAxis tickFormatter={(v: number) => compact(v)} tick={TICK} tickLine={false} axisLine={false} width={38} allowDecimals={false} ticks={ticks} domain={[0, ticks.at(-1) ?? 1]} />
          <Tooltip content={<Tip unit={unit} focus={focus} hint={onPick ? (hint ?? (focus ? "Select for their commits then" : "Select for these commits")) : undefined} />} cursor={{ fill: "var(--color-overlay-hover)" }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.colour} fillOpacity={focus === null || focus === s.key ? 1 : 0.22} maxBarSize={BAR_MAX} isAnimationActive={false} shape={(p: BarShapeProps) => <Segment {...p} top={series.slice(i + 1).every((o) => Number(p.payload?.[o.key] ?? 0) <= 0)} />} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The series of a chart as small swatches with their names, beneath it. */
export function SeriesLegend({ series }: { series: Series[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 type-micro">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-cell" style={{ background: s.colour }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
