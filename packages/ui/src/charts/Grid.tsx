import { grouped } from "../format";
import { TableView } from "./common";
import { useTip } from "./tip";

function steps(max: number): number[] {
  if (max <= 4) return [1, 2, 3, 4].map((s) => Math.min(s, max));
  return [1, 2, 3, 4].map((s) => Math.ceil((max * s) / 4));
}

function step(n: number, bounds: number[]): number {
  if (n <= 0) return 0;
  const i = bounds.findIndex((b) => n <= b);
  return i === -1 ? 4 : i + 1;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const green = (s: number) => (s === 0 ? "var(--empty)" : `var(--green-${s})`);

/** Commits by weekday and hour as a grid of cells, shaded by how many, with the hours of the night set apart. */
export function WeekGrid({ week }: { week: number[][] }) {
  const tip = useTip();
  const max = Math.max(0, ...week.flat());
  const bounds = steps(max);
  const left = 34;
  const cell = 22;
  const gap = 3;
  const width = left + 24 * cell;
  const height = 7 * cell + 18;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="Commits by weekday and hour">
        {week.map((hours, d) => (
          <g key={d}>
            <text x={left - 8} y={d * cell + cell / 2} dy="0.32em" textAnchor="end" className="fill-[var(--color-text-secondary)] text-[10px]">
              {WEEKDAYS[d]?.slice(0, 3)}
            </text>
            {hours.map((n, h) => (
              <rect
                key={h}
                x={left + h * cell + gap / 2}
                y={d * cell + gap / 2}
                width={cell - gap}
                height={cell - gap}
                rx="4"
                fill={green(step(n, bounds))}
                className="transition-opacity hover:opacity-75"
                {...tip(
                  <>
                    <strong>
                      {WEEKDAYS[d]}s, {String(h).padStart(2, "0")}:00 to {String((h + 1) % 24).padStart(2, "0")}:00
                    </strong>
                    <div className="note">{grouped(n)} commits</div>
                  </>,
                )}
              />
            ))}
          </g>
        ))}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={left + h * cell + gap / 2} y={7 * cell + 13} className="fill-[var(--color-text-secondary)] text-[10px] tnum">
            {String(h).padStart(2, "0")}:00
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
        <TableView head={["Day", ...Array.from({ length: 24 }, (_, h) => `${h}`)]} rows={week.map((hours, d) => [WEEKDAYS[d] ?? "", ...hours])} />
        <span className="flex items-center gap-1.5">
          Fewer
          {[0, 1, 2, 3, 4].map((s) => (
            <span key={s} className="inline-block size-[11px] rounded-[3px]" style={{ background: green(s) }} title={s === 0 ? "none" : `up to ${grouped(bounds[s - 1] ?? 0)} commits in the hour`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
