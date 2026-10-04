import { useState } from "react";
import { day, grouped } from "../format";
import { Legend, TableView, YAxis } from "./common";
import { HALF, ticks } from "./scale";

export type Line = { label: string; colour: string; values: number[]; dashed?: boolean };

const HEIGHT = 170;
const LEFT = 36;
const TOP = 10;
const BOTTOM = 22;

/** Weekly counts as lines, with a crosshair and the week's numbers on hover. */
export function Lines({ firstWeek, lines, unit }: { firstWeek: number; lines: Line[]; unit: string }) {
  const width = HALF;
  const [at, setAt] = useState<number | null>(null);
  const weeks = Math.max(0, ...lines.map((l) => l.values.length));
  const most = Math.max(1, ...lines.flatMap((l) => l.values));
  const scale = ticks(most);
  const top = scale.at(-1) ?? most;
  const x = (i: number) => LEFT + (weeks <= 1 ? 0 : (i * (width - LEFT - 4)) / (weeks - 1));
  const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
  const week = (i: number) => day(firstWeek + i * 7);
  const empty = lines.every((l) => l.values.every((v) => v === 0));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Legend items={lines.map((l) => ({ label: l.label, colour: l.colour, mark: l.dashed ? "dash" : "line" }))} />
      {empty || weeks === 0 ? (
        <p className="m-0 grid place-items-center text-sm text-secondary" style={{ aspectRatio: `${width} / ${HEIGHT}` }}>
          None in this Window.
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block h-auto w-full overflow-visible"
            role="img"
            aria-label={`${unit} a week`}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const i = Math.round((((e.clientX - r.left) * (width / Math.max(1, r.width)) - LEFT) / Math.max(1, width - LEFT - 4)) * (weeks - 1));
              setAt(Math.max(0, Math.min(weeks - 1, i)));
            }}
            onMouseLeave={() => setAt(null)}
          >
            <YAxis values={scale} y={y} width={width} left={LEFT} />
            {lines.map((l) => (
              <polyline key={l.label} fill="none" stroke={l.colour} strokeWidth="2" strokeLinejoin="round" strokeDasharray={l.dashed ? "5 3" : undefined} points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            ))}
            {at !== null && (
              <g>
                <line x1={x(at)} x2={x(at)} y1={TOP} y2={HEIGHT - BOTTOM} className="stroke-[var(--color-border-emphasized)]" />
                {lines.map((l) => (
                  <circle key={l.label} cx={x(at)} cy={y(l.values[at] ?? 0)} r="4" fill={l.colour} stroke="var(--color-background-surface)" strokeWidth="2" />
                ))}
              </g>
            )}
            <g className="fill-[var(--color-text-secondary)] text-[11px] tnum">
              <text x={LEFT} y={HEIGHT - 6}>
                {week(0)}
              </text>
              <text x={width - 4} y={HEIGHT - 6} textAnchor="end">
                {week(weeks - 1)}
              </text>
            </g>
          </svg>
          {at !== null && (
            <div className="pointer-events-none absolute top-4 min-w-40 rounded-[var(--radius-element)] border border-line bg-popover px-3 py-2 text-[0.8rem] shadow-[var(--shadow-med)]" style={{ left: `${Math.min(((x(at) + 10) / width) * 100, 55)}%` }}>
              <div className="mb-1 font-medium">Week of {week(at)}</div>
              {lines.map((l) => (
                <div key={l.label} className="flex justify-between gap-4 text-secondary">
                  <span>{l.label}</span>
                  <span className="font-medium text-primary tnum">{grouped(l.values[at] ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <TableView head={["Week of", ...lines.map((l) => l.label)]} rows={Array.from({ length: weeks }, (_, i) => [week(i), ...lines.map((l) => l.values[i] ?? 0)]).filter((r) => r.slice(1).some((v) => v !== 0))} />
    </div>
  );
}
