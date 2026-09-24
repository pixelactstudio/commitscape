/** What every chart shares: its width, its axes, its legend and its table. */
import type { ReactNode } from "react";
import { compact, grouped } from "../format";

export type Swatch = { label: string; colour: string; mark?: "line" | "dash" | "block" };

/** The key to two or more series: always there, never colour alone. */
export function Legend({ items }: { items: Swatch[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="legend">
      {items.map((s) => (
        <li key={s.label}>
          <svg width="14" height="10" aria-hidden>
            {s.mark === "line" || s.mark === "dash" ? (
              <line
                x1="0"
                x2="14"
                y1="5"
                y2="5"
                stroke={s.colour}
                strokeWidth="2"
                strokeDasharray={s.mark === "dash" ? "3 2" : undefined}
              />
            ) : (
              <rect width="14" height="10" rx="2" fill={s.colour} />
            )}
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** The chart's numbers as a table, for reading them exactly. */
export function TableView({
  head,
  rows,
  caption = "Show the numbers",
}: {
  head: string[];
  rows: (string | number)[][];
  caption?: string;
}) {
  return (
    <details className="table-view">
      <summary>{caption}</summary>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={typeof c === "number" ? "num" : undefined}>
                    {typeof c === "number" ? grouped(c) : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A y axis's gridlines and labels, recessive, on the left. */
export function YAxis({
  values,
  y,
  width,
  left,
}: {
  values: number[];
  y: (v: number) => number;
  width: number;
  left: number;
}) {
  return (
    <g className="axis">
      {values.map((v) => (
        <g key={v}>
          <line x1={left} x2={width} y1={y(v)} y2={y(v)} />
          <text x={left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {compact(v)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** A chart's frame: its title, what it shows, and the chart itself. */
export function Figure({
  title,
  note,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="figure" id={id}>
      <h2>{title}</h2>
      {note && <p className="note">{note}</p>}
      {children}
    </section>
  );
}
