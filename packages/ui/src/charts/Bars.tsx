/**
 * A ranked list with a bar each, its value written beside it: one series,
 * so no legend, and the bar in one colour.
 */
import type { ReactNode } from "react";
import { grouped } from "../format";
import { TableView } from "./common";
import { useTip } from "./tip";

export type Bar = {
  key: string;
  label: ReactNode;
  value: number;
  /** What the value is written as, when not a plain count. */
  shown?: string;
  colour?: string;
  tip?: ReactNode;
  onClick?: () => void;
};

export function Bars({ bars, unit, max }: { bars: Bar[]; unit: string; max?: number }) {
  const tip = useTip();
  const most = max ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="chart">
      <ol className="bars">
        {bars.map((b) => (
          <li
            key={b.key}
            className={b.onClick ? "clickable" : undefined}
            onClick={b.onClick}
            onKeyDown={(e) => b.onClick && (e.key === "Enter" || e.key === " ") && b.onClick()}
            tabIndex={b.onClick ? 0 : undefined}
            role={b.onClick ? "button" : undefined}
            {...tip(b.tip ?? <>{b.label}: {b.shown ?? `${grouped(b.value)} ${unit}`}</>)}
          >
            <span className="bar-label">{b.label}</span>
            <span className="bar-track">
              <span
                className="bar"
                style={{
                  width: `${Math.max(0.5, (b.value * 100) / most)}%`,
                  background: b.colour ?? "var(--s1)",
                }}
              />
            </span>
            <span className="bar-value">{b.shown ?? grouped(b.value)}</span>
          </li>
        ))}
      </ol>
      <TableView
        head={["", unit]}
        rows={bars.map((b) => [typeof b.label === "string" ? b.label : b.key, b.shown ?? b.value])}
      />
    </div>
  );
}
