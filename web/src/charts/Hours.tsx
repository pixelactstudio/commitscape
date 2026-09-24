/**
 * Commits by hour of the day, a column an hour, with the night (22:00 to
 * 05:00) shaded and labelled.
 */
import { grouped } from "../format";
import { TableView, YAxis } from "./common";
import { ticks, useWidth } from "./scale";
import { useTip } from "./tip";

const HEIGHT = 150;
const LEFT = 36;
const TOP = 16;
const BOTTOM = 22;

export function Hours({ hours }: { hours: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const scale = ticks(Math.max(1, ...hours));
  const top = scale.at(-1) ?? 1;
  const bw = Math.max(1, (width - LEFT) / 24);
  const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
  const x = (h: number) => LEFT + h * bw;
  const label = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="Commits by hour of the day">
          <rect className="night" x={x(22)} width={bw * 2} y={TOP} height={HEIGHT - TOP - BOTTOM} />
          <rect className="night" x={x(0)} width={bw * 5} y={TOP} height={HEIGHT - TOP - BOTTOM} />
          <text className="night-label" x={x(0) + 4} y={TOP - 4}>
            night
          </text>
          <YAxis values={scale} y={y} width={width} left={LEFT} />
          {hours.map((n, h) => (
            <g key={h} {...tip(<><strong>{label(h)}–{label((h + 1) % 24)}</strong><div>{grouped(n)} commits</div></>)}>
              <rect className="hit" x={x(h)} width={bw} y={TOP} height={HEIGHT - TOP - BOTTOM} />
              {n > 0 && (
                <path
                  className="hour-bar"
                  d={`M${x(h) + 1},${y(0)} V${y(n) + 3} q0,-3 3,-3 H${x(h) + bw - 4} q3,0 3,3 V${y(0)} Z`}
                />
              )}
            </g>
          ))}
          <g className="axis">
            {[0, 6, 12, 18].map((h) => (
              <text key={h} x={x(h)} y={HEIGHT - 6}>
                {label(h)}
              </text>
            ))}
          </g>
        </svg>
      )}
      <TableView head={["Hour", "Commits"]} rows={hours.map((n, h) => [label(h), n])} />
    </div>
  );
}
