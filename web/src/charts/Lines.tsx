/**
 * Weekly counts as lines on one axis, with a crosshair that reads every
 * series at the week under the pointer.
 */
import { useState } from "react";
import { day, grouped } from "../format";
import { Legend, TableView, YAxis } from "./common";
import { ticks, useWidth } from "./scale";

export type Line = { label: string; colour: string; values: number[]; dashed?: boolean };

const HEIGHT = 160;
const LEFT = 36;
const TOP = 10;
const BOTTOM = 22;

export function Lines({ firstWeek, lines, unit }: { firstWeek: number; lines: Line[]; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const weeks = Math.max(0, ...lines.map((l) => l.values.length));
  const most = Math.max(1, ...lines.flatMap((l) => l.values));
  const scale = ticks(most);
  const top = scale.at(-1) ?? most;
  const x = (i: number) => LEFT + (weeks <= 1 ? 0 : (i * (width - LEFT - 4)) / (weeks - 1));
  const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
  const week = (i: number) => day(firstWeek + i * 7);
  return (
    <div className="chart" ref={ref}>
      <Legend items={lines.map((l) => ({ label: l.label, colour: l.colour, mark: l.dashed ? "dash" : "line" }))} />
      {lines.every((l) => l.values.every((v) => v === 0)) ? (
        <p className="note">None in this window.</p>
      ) : width > 0 && weeks > 0 && (
        <div className="lines-wrap">
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${unit} a week`}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const i = Math.round(((e.clientX - r.left - LEFT) / Math.max(1, width - LEFT - 4)) * (weeks - 1));
              setAt(Math.max(0, Math.min(weeks - 1, i)));
            }}
            onMouseLeave={() => setAt(null)}
          >
            <YAxis values={scale} y={y} width={width} left={LEFT} />
            {lines.map((l) => (
              <polyline
                key={l.label}
                fill="none"
                stroke={l.colour}
                strokeWidth="2"
                strokeDasharray={l.dashed ? "5 3" : undefined}
                points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              />
            ))}
            {at !== null && (
              <g>
                <line className="crosshair" x1={x(at)} x2={x(at)} y1={TOP} y2={HEIGHT - BOTTOM} />
                {lines.map((l) => (
                  <circle key={l.label} cx={x(at)} cy={y(l.values[at] ?? 0)} r="4" fill={l.colour} stroke="var(--surface)" strokeWidth="2" />
                ))}
              </g>
            )}
            <g className="axis">
              <text x={LEFT} y={HEIGHT - 6}>{week(0)}</text>
              <text x={width - 4} y={HEIGHT - 6} textAnchor="end">{week(weeks - 1)}</text>
            </g>
          </svg>
          {at !== null && (
            <div className="tip inline" style={{ left: Math.min(x(at) + 10, width - 220) }}>
              <strong>Week of {week(at)}</strong>
              {lines.map((l) => (
                <div key={l.label}>
                  {l.label}: {grouped(l.values[at] ?? 0)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <TableView
        head={["Week of", ...lines.map((l) => l.label)]}
        rows={Array.from({ length: weeks }, (_, i) => [week(i), ...lines.map((l) => l.values[i] ?? 0)]).filter((r) =>
          r.slice(1).some((v) => v !== 0),
        )}
      />
    </div>
  );
}
