import type { ReactNode } from "react";
import { grouped } from "../format";
import { TableView } from "./common";
import { useTip } from "./tip";

export type Bar = {
  key: string;
  label: ReactNode;
  value: number;
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
        {bars.map((b) => {
          const row = (
            <>
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
            </>
          );
          const hint = tip(b.tip ?? <>{b.label}: {b.shown ?? `${grouped(b.value)} ${unit}`}</>);
          return (
            <li key={b.key}>
              {b.onClick ? (
                <button type="button" className="bar-row clickable" onClick={b.onClick} {...hint}>
                  {row}
                </button>
              ) : (
                <div className="bar-row" {...hint}>
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <TableView
        head={["", unit]}
        rows={bars.map((b) => [typeof b.label === "string" ? b.label : b.key, b.shown ?? b.value])}
      />
    </div>
  );
}
