import { compact, day, grouped } from "../format";
import { Legend, TableView, type Swatch } from "./common";
import { ticks } from "./scale";
import { useTip } from "./tip";
import { binDays, thinMarks, yearsOf, type Mark } from "./marks";

export type Series = { label: string; colour: string; values: number[] };
export type { Mark } from "./marks";

export const COLUMNS_HEIGHT = 200;

export function Columns({
  firstDay,
  series,
  marks = [],
  unit = "commits",
  height = COLUMNS_HEIGHT,
}: {
  firstDay: number;
  series: Series[];
  marks?: Mark[];
  unit?: string;
  height?: number;
}) {
  const tip = useTip();
  const days = Math.max(0, ...series.map((s) => s.values.length));
  const per = binDays(days);
  const bins = Math.max(1, Math.ceil(days / per));
  const stacks = Array.from({ length: bins }, (_, b) =>
    series.map((s) => {
      let n = 0;
      for (let d = b * per; d < Math.min(days, (b + 1) * per); d++) n += s.values[d] ?? 0;
      return n;
    }),
  );
  const totals = stacks.map((s) => s.reduce((a, b) => a + b, 0));
  const scale = ticks(Math.max(1, ...totals));
  const top = scale.at(-1) ?? 1;
  const span = (b: number) => {
    const from = firstDay + b * per;
    return per === 1 ? day(from) : `${day(from)} to ${day(Math.min(firstDay + days, from + per) - 1)}`;
  };
  const drawn = thinMarks(marks, firstDay, bins * per);
  const years = yearsOf(firstDay, days);
  const legend: Swatch[] = series.map((s) => ({ label: s.label, colour: s.colour }));
  if (drawn.length > 0 && series.length > 1) legend.push({ label: "Release", colour: "var(--text-2)", mark: "dash" });
  const unitWords = per === 1 ? "a column a day" : per === 7 ? "a column a week" : per === 28 ? "a column every four weeks" : "a column a quarter";
  const hidden = marks.length - drawn.length;
  return (
    <div className="chart">
      <Legend items={legend} />
      <p className="note small">
        {unitWords}
        {hidden > 0 && `; ${drawn.length} of ${grouped(marks.length)} releases drawn, where they fit`}
      </p>
      <div className="cols" style={{ height }} role="img" aria-label={`${unit} over time, ${unitWords}`}>
        <div className="cols-plot">
          {scale.map((v) => (
            <div key={v} className="cols-grid" style={{ bottom: `${(v / top) * 100}%` }}>
              <span>{compact(v)}</span>
            </div>
          ))}
          {drawn.map(({ mark, at, labelled }) => (
            <div key={`${mark.label}${mark.day}`} className="cols-mark" style={{ left: `${at}%` }} {...tip(<><strong>{mark.label}</strong><div>released {day(mark.day)}</div></>)}>
              {labelled && <span>{mark.label}</span>}
            </div>
          ))}
          <div className="cols-bars">
            {stacks.map((stack, b) => (
              <div
                key={b}
                className="cols-bin"
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
                {stack.map((n, i) =>
                  n === 0 ? null : <span key={i} style={{ height: `${(n / top) * 100}%`, background: series[i]?.colour }} />,
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="cols-axis">
          {years.length > 0 ? (
            years.map((d) => (
              <span key={d} style={{ left: `${((d - firstDay) / Math.max(1, bins * per)) * 100}%` }}>
                {new Date(d * 86_400_000).getUTCFullYear()}
              </span>
            ))
          ) : (
            <>
              <span style={{ left: 0 }}>{day(firstDay)}</span>
              <span style={{ right: 0 }}>{day(firstDay + Math.max(0, days - 1))}</span>
            </>
          )}
        </div>
      </div>
      <TableView
        head={["When", ...(series.length > 1 ? series.map((s) => s.label) : []), `All ${unit}`]}
        rows={stacks
          .map((s, b) => [span(b), ...(series.length > 1 ? s : []), totals[b] ?? 0])
          .filter((r) => r.at(-1) !== 0)}
      />
    </div>
  );
}
