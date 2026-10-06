import type { Profile } from "@commitscape/data";
import { useTip } from "../charts/tip";
import { heat } from "../design/tokens";
import { grouped, many } from "../format";
import { Panel } from "../kit/layout";
import { Nothing } from "../motion";
import { clockState, WEEKDAYS } from "./days";

const NIGHT = new Set([22, 23, 0, 1, 2, 3, 4]);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

function weekOf(clock: NonNullable<Profile["clock"]>): number[][] | null {
  return clock.week && clock.week.length === 7 ? clock.week : null;
}

function shade(n: number, most: number): string {
  return heat(n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / most) * 4))));
}

/** When their newest commits were made, on each commit's own clock: a weekday by hour heat map, with the busiest hour and day, and how much falls at night and at weekends. */
export function CommitClock({ profile, wide = false }: { profile: Profile; wide?: boolean }) {
  const state = clockState(profile);
  if (state === "failed")
    return (
      <Panel title="When they commit" description="The hour and weekday of their newest commits, on each commit's own clock" className="h-full [&>*]:h-full">
        <Nothing title="GitHub did not hand over commit times this time" words="It limits how often its commit search is asked. commitscape asks again on a visit after a few minutes." compact />
      </Panel>
    );
  if (state === "none" || !profile.clock)
    return (
      <Panel title="When they commit" description="The hour and weekday of their newest commits, on each commit's own clock" className="h-full [&>*]:h-full">
        <Nothing title="No commits to read the time of" words="GitHub's commit search has no commits by them yet." compact />
      </Panel>
    );
  return <Heat clock={profile.clock} wide={wide} />;
}

function Heat({ clock, wide }: { clock: NonNullable<Profile["clock"]>; wide: boolean }) {
  const tip = useTip();
  const week = weekOf(clock);
  const peak = clock.hours.indexOf(Math.max(...clock.hours));
  const night = clock.hours.reduce((n, v, h) => (NIGHT.has(h) ? n + v : n), 0);
  const days = week ? week.map((r) => r.reduce((a, b) => a + b, 0)) : null;
  const topDay = days ? days.indexOf(Math.max(...days)) : -1;
  const weekend = days ? (days[5] ?? 0) + (days[6] ?? 0) : 0;
  const most = Math.max(1, ...(week ? week.flat() : clock.hours));
  const facts = [
    { label: "Busiest hour", value: `${pad(peak)}`, note: many(clock.hours[peak] ?? 0, "commit", "commits") },
    ...(days ? [{ label: "Busiest day", value: WEEKDAYS[topDay] ?? "—", note: many(days[topDay] ?? 0, "commit", "commits") }] : []),
    { label: "At night", value: `${Math.round((night * 100) / clock.sampled)}%`, note: "22:00 to 05:00" },
    ...(days ? [{ label: "At weekends", value: `${Math.round((weekend * 100) / clock.sampled)}%`, note: "Saturday and Sunday" }] : []),
  ];
  return (
    <Panel title="When they commit" description={`The hour${week ? " and weekday" : ""} of their newest ${grouped(clock.sampled)} commits, on each commit's own clock`} className="h-full [&>*]:h-full">
      <div className={`grid gap-5 ${wide ? "lg:grid-cols-[1fr_15rem] lg:items-center" : ""}`}>
        {week ? (
          <div className="flex flex-col gap-1.5" role="img" aria-label={`Most commits at ${pad(peak)}${topDay >= 0 ? ` and on ${WEEKDAYS[topDay]}s` : ""}`}>
            <div className="grid gap-0.75" style={{ gridTemplateColumns: "2rem repeat(24, minmax(0, 1fr))" }}>
              {week.map((row, d) => (
                <div key={WEEKDAYS[d]} className="contents">
                  <span className="self-center type-micro">{WEEKDAYS[d]?.slice(0, 3)}</span>
                  {row.map((n, h) => (
                    <span
                      key={h}
                      className={`block rounded-cell transition-opacity hover:opacity-80 ${wide ? "h-[clamp(0.875rem,2.4vw,1.75rem)]" : "aspect-square"}`}
                      style={{ background: shade(n, most) }}
                      {...tip(
                        <>
                          <strong>
                            {WEEKDAYS[d]}, {pad(h)} to {pad((h + 1) % 24)}
                          </strong>
                          <div className="note">{many(n, "commit", "commits")}</div>
                        </>,
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="grid type-micro tnum" style={{ gridTemplateColumns: "2rem repeat(4, minmax(0, 1fr))" }}>
              <span />
              {[0, 6, 12, 18].map((h) => (
                <span key={h}>{pad(h)}</span>
              ))}
            </div>
            <span className="flex items-center justify-end gap-1.5 type-micro">
              Fewer
              {[0, 1, 2, 3, 4].map((s) => (
                <span key={s} className="inline-block size-2.5 rounded-cell" style={{ background: heat(s) }} />
              ))}
              More
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-32 items-end gap-0.75" role="img" aria-label={`Most commits at ${pad(peak)}`}>
              {clock.hours.map((n, h) => (
                <span key={h} className="flex h-full flex-1 flex-col justify-end" {...tip(<><strong>{pad(h)} to {pad((h + 1) % 24)}</strong><div className="note">{many(n, "commit", "commits")}</div></>)}>
                  <span className={`block w-full rounded-t-cell ${NIGHT.has(h) ? "bg-[var(--s7)]" : "bg-[var(--s1)]"}`} style={{ height: `${Math.max(n > 0 ? 3 : 1, (n * 100) / most)}%`, opacity: n > 0 ? 1 : 0.25 }} />
                </span>
              ))}
            </div>
            <div className="flex justify-between type-micro tnum">
              {[0, 6, 12, 18, 23].map((h) => (
                <span key={h}>{pad(h)}</span>
              ))}
            </div>
          </div>
        )}
        <dl className={`m-0 grid grid-cols-2 gap-x-4 gap-y-3 ${wide ? "lg:grid-cols-2" : ""}`}>
          {facts.map((f) => (
            <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="type-caption">{f.label}</dt>
              <dd className="m-0 truncate type-stat-sm">{f.value}</dd>
              <dd className="m-0 truncate type-micro">{f.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
