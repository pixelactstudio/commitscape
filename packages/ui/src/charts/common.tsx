import { CHART } from "../design/tokens";
import { compact, grouped } from "../format";

export type Swatch = { label: string; colour: string; mark?: "line" | "dash" | "block" };

export function Legend({ items }: { items: Swatch[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-2xs text-secondary">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden className="flex-none">
            {s.mark === "line" || s.mark === "dash" ? (
              <line x1="0" x2="14" y1="5" y2="5" stroke={s.colour} strokeWidth="2" strokeDasharray={s.mark === "dash" ? "3 2" : undefined} />
            ) : (
              <rect width="14" height="10" rx={CHART.barRadius} fill={s.colour} />
            )}
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** A chart's numbers as a plain table, folded away until asked for. */
export function TableView({ head, rows, caption = "Show the numbers" }: { head: string[]; rows: (string | number)[][]; caption?: string }) {
  return (
    <details className="group text-2xs">
      <summary className="cursor-pointer text-secondary select-none hover:text-primary">{caption}</summary>
      <div className="mt-2 max-h-[32rem] overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={`${h}${i}`} className="sticky top-0 bg-surface px-2.5 py-1.5 text-start font-medium whitespace-nowrap text-secondary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => (
                  <td key={j} className={`px-2.5 py-1 ${typeof c === "number" ? "text-end tnum" : ""}`}>
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

export function YAxis({ values, y, width, left }: { values: number[]; y: (v: number) => number; width: number; left: number }) {
  return (
    <g>
      {values.map((v) => (
        <g key={v}>
          <line x1={left} x2={width} y1={y(v)} y2={y(v)} stroke={CHART.grid} strokeWidth={1} />
          <text x={left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={CHART.tick.fontSize} fill={CHART.tick.fill} className="tnum">
            {compact(v)}
          </text>
        </g>
      ))}
    </g>
  );
}
