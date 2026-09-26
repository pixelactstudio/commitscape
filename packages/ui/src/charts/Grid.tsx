/**
 * Counts in a grid of cells, darker for more: the week by hour, and a
 * person's days as a calendar. Four steps of one hue, and an empty cell
 * for none, with the steps' ranges in the legend.
 */
import { day, grouped } from "../format";
import { ramp } from "../theme";
import { TableView } from "./common";
import { ranges, useWidth } from "./scale";
import { useTip } from "./tip";

/** The four steps' upper bounds: quarters of the largest count. */
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

/** Commits by weekday and hour, on each author's own clock. */
export function WeekGrid({ week }: { week: number[][] }) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(0, ...week.flat());
  const bounds = steps(max);
  const left = 80;
  const cell = Math.max(8, Math.min(26, (width - left) / 24));
  return (
    <div className="chart" ref={ref}>
      <RampLegend bounds={bounds} unit="commits in the hour" />
      <svg width={left + cell * 24} height={cell * 7 + 18} role="img" aria-label="Commits by weekday and hour">
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

/** A person's commits a day, a column a week, Monday at the top. */
export function Calendar({ firstDay, days }: { firstDay: number; days: number[] }) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(0, ...days);
  const bounds = steps(max);
  // Days since the epoch: day 0 was a Thursday, so Monday is (d + 3) % 7.
  const weekday = (d: number) => (d + 3) % 7;
  const offset = weekday(firstDay);
  const weeks = Math.ceil((days.length + offset) / 7);
  const cell = Math.max(4, Math.min(14, width / Math.max(1, weeks)));
  return (
    <div className="chart" ref={ref}>
      <RampLegend bounds={bounds} unit="commits a day" />
      <svg width={weeks * cell} height={cell * 7} role="img" aria-label="Commits a day">
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
                  <div>{grouped(n)} commits</div>
                </>,
              )}
            />
          );
        })}
      </svg>
      <TableView
        head={["Day", "Commits"]}
        rows={days.flatMap((n, i) => (n > 0 ? [[day(firstDay + i), n]] : []))}
      />
    </div>
  );
}
