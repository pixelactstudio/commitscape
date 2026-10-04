import { day, grouped } from "../format";
import { ramp } from "../theme";
import { TableView } from "./common";
import { HALF, ranges } from "./scale";
import { useTip } from "./tip";

function quantiles(values: number[]): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [1, 1, 1, 1];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 1;
  const out = [at(0.25), at(0.5), at(0.75), sorted.at(-1) ?? 1];
  for (let i = 1; i < 4; i++) out[i] = Math.max(out[i] ?? 0, out[i - 1] ?? 0);
  return out;
}

function steps(max: number): number[] {
  if (max <= 4) return [1, 2, 3, 4].map((s) => Math.min(s, max));
  return [1, 2, 3, 4].map((s) => Math.ceil((max * s) / 4));
}

function step(n: number, bounds: number[]): number {
  if (n <= 0) return 0;
  const i = bounds.findIndex((b) => n <= b);
  return i === -1 ? 4 : i + 1;
}

function RampLegend({ bounds, unit }: { bounds: number[]; unit: string }) {
  return (
    <ul className="legend">
      <li>
        <svg width="12" height="12" aria-hidden>
          <rect width="12" height="12" rx="2" className="empty-cell" />
        </svg>
        none
      </li>
      {ranges(bounds).map((r) => (
        <li key={r.step}>
          <svg width="12" height="12" aria-hidden>
            <rect width="12" height="12" rx="2" fill={ramp("blue", step(r.to, bounds))} />
          </svg>
          {r.from === r.to ? grouped(r.to) : `${grouped(r.from)}–${grouped(r.to)}`}
        </li>
      ))}
      <li className="note">{unit}</li>
    </ul>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function WeekGrid({ week }: { week: number[][] }) {
  const tip = useTip();
  const width = HALF;
  const max = Math.max(0, ...week.flat());
  const bounds = steps(max);
  const left = 80;
  const cell = Math.max(8, Math.min(26, (width - left) / 24));
  return (
    <div className="chart">
      <RampLegend bounds={bounds} unit="commits in the hour" />
      <svg viewBox={`0 0 ${left + cell * 24} ${cell * 7 + 18}`} className="fluid" role="img" aria-label="Commits by weekday and hour">
        {week.map((hours, d) => (
          <g key={d}>
            <text className="axis-label" x={left - 8} y={d * cell + cell / 2} dy="0.32em" textAnchor="end">
              {WEEKDAYS[d]?.slice(0, 3)}
            </text>
            {hours.map((n, h) => (
              <rect
                key={h}
                x={left + h * cell + 1}
                y={d * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx="2"
                className={n === 0 ? "empty-cell" : undefined}
                fill={n === 0 ? undefined : ramp("blue", step(n, bounds))}
                tabIndex={-1}
                {...tip(
                  <>
                    <strong>
                      {WEEKDAYS[d]}s, {String(h).padStart(2, "0")}:00–{String(h + 1).padStart(2, "0")}:00
                    </strong>
                    <div>{grouped(n)} commits</div>
                  </>,
                )}
              />
            ))}
          </g>
        ))}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} className="axis-label" x={left + h * cell} y={cell * 7 + 14}>
            {String(h).padStart(2, "0")}:00
          </text>
        ))}
      </svg>
      <TableView
        head={["Day", ...Array.from({ length: 24 }, (_, h) => `${h}`)]}
        rows={week.map((hours, d) => [WEEKDAYS[d] ?? "", ...hours])}
      />
    </div>
  );
}

export function Calendar({ firstDay, days, unit = "commits", quantile = false }: { firstDay: number; days: number[]; unit?: string; quantile?: boolean }) {
  const tip = useTip();
  const max = Math.max(0, ...days);
  const bounds = quantile ? quantiles(days) : steps(max);
  const weekday = (d: number) => (d + 3) % 7;
  const offset = weekday(firstDay);
  const weeks = Math.ceil((days.length + offset) / 7);
  const cell = 14;
  return (
    <div className="chart">
      <RampLegend bounds={bounds} unit={`${unit} a day`} />
      <svg viewBox={`0 0 ${weeks * cell} ${cell * 7}`} className="fluid" style={{ maxWidth: weeks * cell }} role="img" aria-label="Commits a day">
        {days.map((n, i) => {
          const d = firstDay + i;
          const col = Math.floor((i + offset) / 7);
          return (
            <rect
              key={i}
              x={col * cell + 0.5}
              y={weekday(d) * cell + 0.5}
              width={cell - 1}
              height={cell - 1}
              rx="1.5"
              className={n === 0 ? "empty-cell" : undefined}
              fill={n === 0 ? undefined : ramp("blue", step(n, bounds))}
              {...tip(
                <>
                  <strong>{day(d)}</strong>
                  <div>
                    {grouped(n)} {unit}
                  </div>
                </>,
              )}
            />
          );
        })}
      </svg>
      <TableView
        head={["Day", unit]}
        rows={days.flatMap((n, i) => (n > 0 ? [[day(firstDay + i), n]] : []))}
      />
    </div>
  );
}
