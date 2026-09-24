/**
 * Commits over time as columns, stacked by person when there are several,
 * with releases marked. Days are gathered into weeks, or four-week spans,
 * when there are too many to draw one a day.
 */
import { day, grouped } from "../format";
import { Legend, TableView, YAxis, type Swatch } from "./common";
import { ticks, useWidth } from "./scale";
import { useTip } from "./tip";

export type Series = { label: string; colour: string; values: number[] };
export type Mark = { day: number; label: string };

const HEIGHT = 180;
const LEFT = 36;
const BOTTOM = 22;
const TOP = 18;

/** How many days each column holds, so each is at least a few pixels. */
function binDays(days: number, width: number): number {
  const room = Math.max(1, (width - LEFT) / 4);
  if (days <= room) return 1;
  if (days / 7 <= room) return 7;
  return 28;
}

export function Columns({
  firstDay,
  series,
  marks = [],
  unit = "commits",
}: {
  firstDay: number;
  series: Series[];
  marks?: Mark[];
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const days = Math.max(0, ...series.map((s) => s.values.length));
  const per = binDays(days, width);
  const bins = Math.ceil(days / per);
  const stacks = Array.from({ length: bins }, (_, b) =>
    series.map((s) => {
      let n = 0;
      for (let d = b * per; d < Math.min(days, (b + 1) * per); d++) n += s.values[d] ?? 0;
      return n;
    }),
  );
  const totals = stacks.map((s) => s.reduce((a, b) => a + b, 0));
  const most = Math.max(1, ...totals);
  const scale = ticks(most);
  const top = scale.at(-1) ?? most;
  const inner = Math.max(1, width - LEFT);
  const bw = inner / Math.max(1, bins);
  const gap = bw >= 4 ? 2 : bw >= 2 ? 1 : 0;
  const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
  const xOfDay = (d: number) => LEFT + ((d - firstDay) / per) * bw;
  const span = (b: number) => {
    const from = firstDay + b * per;
    return per === 1 ? day(from) : `${day(from)} to ${day(Math.min(firstDay + days, from + per) - 1)}`;
  };
  // Label a few releases, spread out; the rest are marks with a tooltip.
  let lastLabel = -Infinity;
  const labelled = new Set<number>();
  for (const [i, m] of marks.entries()) {
    const x = xOfDay(m.day);
    if (x - lastLabel > 70) {
      labelled.add(i);
      lastLabel = x;
    }
  }
  const years: number[] = [];
  const perYear = new Set<number>();
  for (let d = firstDay; d < firstDay + days; d++) {
    const date = new Date(d * 86_400_000);
    const yr = date.getUTCFullYear();
    if (!perYear.has(yr) && date.getUTCMonth() === 0 && date.getUTCDate() === 1) {
      perYear.add(yr);
      years.push(d);
    }
  }
  const legend: Swatch[] = series.map((s) => ({ label: s.label, colour: s.colour }));
  if (marks.length > 0 && series.length > 1) legend.push({ label: "Release", colour: "var(--text-2)", mark: "dash" });
  const unitWords = per === 1 ? "a column a day" : per === 7 ? "a column a week" : "a column every four weeks";
  return (
    <div className="chart" ref={ref}>
      <Legend items={legend} />
      <p className="note small">{unitWords}</p>
      {width > 0 && (
        <svg className="columns" width={width} height={HEIGHT} role="img" aria-label={`${unit} over time, ${unitWords}`}>
          <YAxis values={scale} y={y} width={width} left={LEFT} />
          {marks.map((m, i) => {
            const x = xOfDay(m.day);
            return (
              <g key={`${m.label}${m.day}`} className="mark" {...tip(<><strong>{m.label}</strong><div>released {day(m.day)}</div></>)}>
                <line x1={x} x2={x} y1={TOP - 4} y2={HEIGHT - BOTTOM} />
                <rect className="hit" x={x - 4} width={8} y={0} height={HEIGHT - BOTTOM} />
                {labelled.has(i) && (
                  <text x={x + 3} y={TOP - 6}>
                    {m.label}
                  </text>
                )}
              </g>
            );
          })}
          {stacks.map((stack, b) => {
            let base = 0;
            const x = LEFT + b * bw + gap / 2;
            const w = Math.max(0.5, bw - gap);
            return (
              <g
                key={b}
                {...tip(
                  <>
                    <strong>{span(b)}</strong>
                    {series.length > 1 &&
                      series.map((s, i) =>
                        stack[i] ? (
                          <div key={s.label}>
                            {s.label}: {grouped(stack[i] ?? 0)}
                          </div>
                        ) : null,
                      )}
                    <div>
                      {grouped(totals[b] ?? 0)} {unit}
                    </div>
                  </>,
                )}
              >
                <rect className="hit" x={LEFT + b * bw} width={bw} y={TOP} height={HEIGHT - TOP - BOTTOM} />
                {stack.map((n, i) => {
                  if (n === 0) return null;
                  const y0 = y(base);
                  base += n;
                  const y1 = y(base);
                  return (
                    <rect
                      key={i}
                      x={x}
                      width={w}
                      y={y1}
                      height={Math.max(0.5, y0 - y1)}
                      fill={series[i]?.colour}
                      stroke={gap > 0 && series.length > 1 ? "var(--surface)" : undefined}
                      strokeWidth={gap > 0 && series.length > 1 ? 1 : undefined}
                    />
                  );
                })}
              </g>
            );
          })}
          <g className="axis">
            {(years.length > 0 && years.length < 16 ? years : [firstDay, firstDay + days - 1]).map((d, i, all) => (
              <text
                key={d}
                x={xOfDay(d)}
                y={HEIGHT - 6}
                textAnchor={years.length > 0 && years.length < 16 ? "start" : i === all.length - 1 ? "end" : "start"}
              >
                {years.length > 0 && years.length < 16 ? new Date(d * 86_400_000).getUTCFullYear() : day(d)}
              </text>
            ))}
          </g>
        </svg>
      )}
      <TableView
        head={["When", ...(series.length > 1 ? series.map((s) => s.label) : []), `All ${unit}`]}
        rows={stacks
          .map((s, b) => [span(b), ...(series.length > 1 ? s : []), totals[b] ?? 0])
          .filter((r) => r.at(-1) !== 0)}
      />
    </div>
  );
}
