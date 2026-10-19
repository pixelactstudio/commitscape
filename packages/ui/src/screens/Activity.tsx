import { useState } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Clock } from "lucide-react";
import type { Activity as Data, PersonRef } from "@commitscape/data";
import { WeekGrid } from "../charts/Grid";
import { peakOf } from "../charts/peak";
import { useTip } from "../charts/tip";
import { TipCard } from "../charts/Tip";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useData } from "../data";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { grouped, many, share, within } from "../format";
import { Panel } from "../kit/layout";
import { Surface } from "../kit/primitives";
import { personColour } from "../theme";
import { BarList, EmptyWindow, Failed, ScreenFrame, StacksOverTime, type Stack } from "./kit";
import { useReload } from "./reload";
import { openers, type ScreenProps } from "./props";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

const TYPED = new Set(["features", "fixes", "refactors", "performance", "style", "build", "chores"]);
const CONVENTIONAL = 0.3;

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

const CHART = 280;

/** How the work moved: commits over time by person, the hours of the week, and the kinds of work. */
export function Activity({ params, route, go }: ScreenProps) {
  const { data: a, error, stale } = useData<Data>("/api/activity", params);
  const reload = useReload();
  const [focus, setFocus] = useState<string | null>(null);
  if (error || !a) return <Failed words={error} retry={reload} />;
  const open = openers(go, route);
  const span = within(a.window);
  const stacks: (Stack & { person: PersonRef | null })[] = [
    ...a.people.map((p, i) => ({ key: `p${i}`, label: p.name, colour: personColour(p.colour), days: a.days.map((d) => d[i] ?? 0), person: p })),
    { key: "rest", label: "Everyone else", colour: "var(--other)", days: a.days.map((d) => d[a.people.length] ?? 0), person: null },
  ].filter((s) => s.days.some((v) => v > 0));
  const personOf = (key: string | null) => stacks.find((s) => s.key === key)?.person ?? null;
  const commits = a.days.reduce((n, d) => n + d.reduce((m, v) => m + v, 0), 0);
  const told = a.kinds.reduce((n, k) => n + k.commits, 0);
  const typed = a.kinds.filter((k) => TYPED.has(k.kind)).reduce((n, k) => n + k.commits, 0);
  const kinds = told > 0 && typed >= (told + a.unclassified) * CONVENTIONAL;
  const releases = a.releases.filter((r) => {
    const d = Math.floor(r.time / 86_400);
    return d >= a.first_day && d < a.first_day + a.days.length;
  });
  const peak = peakOf(a.week);
  const all = told + a.unclassified;
  if (commits === 0) {
    return (
      <ScreenFrame stale={stale}>
        <Surface>
          <EmptyWindow window={a.window} what="Choose a longer Window to see how the work moved over time and through the week." go={go} />
        </Surface>
      </ScreenFrame>
    );
  }
  return (
    <ScreenFrame stale={stale}>
      <Panel
        title="Commits over time, by person"
        description={`${many(commits, "commit", "commits")} ${span}: the ${a.people.length === 1 ? "one person" : `${a.people.length} who made most`}, then everyone else`}
        actions={releases.length > 0 ? <span className="type-caption">{many(releases.length, "release", "releases")} in this Window</span> : undefined}
      >
        <div className="flex flex-col gap-4">
          <StacksOverTime
            firstDay={a.first_day}
            stacks={stacks}
            unit="commits"
            height={CHART}
            focus={focus}
            releases={releases.map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name }))}
            onPick={(d, key) => {
              const who = personOf(key);
              open.commits(who ? { ...d, who: who.id } : d);
            }}
          />
          <StackLegend
            stacks={stacks}
            total={commits}
            focus={focus}
            onFocus={setFocus}
            onPick={(key) => {
              const who = personOf(key);
              if (who) open.commits({ who: who.id });
            }}
          />
        </div>
        <Explain>
          Commits that are not merges, stacked by who made them. Each person keeps one colour on every screen, fixed by their commits over all of history. Hover a name to bring their commits forward; select a column for
          its commits, or a name for all of theirs.
        </Explain>
      </Panel>

      <Panel
        title="When the work happens"
        description={
          peak
            ? `Busiest on ${WEEKDAYS[peak.day]} from ${hh(peak.hour)} to ${hh(peak.hour + 1)}: ${many(peak.commits, "commit", "commits")}, ${peak.times.toFixed(peak.times >= 10 ? 0 : 1)}× a typical hour`
            : "Commits by weekday and hour"
        }
        actions={<ClockNote />}
      >
        <WeekGrid week={a.week} onPick={(p) => open.commits(p)} />
        <Rhythm week={a.week} />
        <Explain>
          Each commit at the hour its author’s clock showed, so a team across time zones still shows its working day. The bars above are each hour’s total across the week, those beside each day’s share; the ringed cell
          is the busiest hour. Select a cell, an hour or a day for its commits.
        </Explain>
      </Panel>

      {kinds && (
        <Panel title="Kinds of work" description={`${share(typed, all)} of commits say their kind in a conventional prefix (feat:, fix:…)`}>
          <KindsList kinds={a.kinds} all={all} />
          <Explain>
            Judged from the files a commit changed first (only tests, only docs, only CI, only dependency manifests), and from its message when the files cannot tell. {grouped(a.unclassified)} commits could be told by
            neither.
          </Explain>
        </Panel>
      )}
    </ScreenFrame>
  );
}

const NIGHT = new Set([22, 23, 0, 1, 2, 3, 4]);

function Rhythm({ week }: { week: number[][] }) {
  const all = week.flat().reduce((a, b) => a + b, 0);
  if (all === 0) return null;
  const weekend = [5, 6].reduce((n, d) => n + (week[d] ?? []).reduce((a, b) => a + b, 0), 0);
  const night = week.reduce((n, hours) => n + hours.reduce((m, v, h) => (NIGHT.has(h) ? m + v : m), 0), 0);
  const office = week.slice(0, 5).reduce((n, hours) => n + hours.reduce((m, v, h) => (h >= 9 && h < 18 ? m + v : m), 0), 0);
  const days = week.map((hours) => hours.reduce((a, b) => a + b, 0));
  const top = days.indexOf(Math.max(...days));
  const facts: [string, string][] = [
    [share(office, all), "in office hours, 09:00 to 18:00 on weekdays"],
    [share(weekend, all), "on weekends"],
    [share(night, all), "at night, 22:00 to 05:00"],
    [WEEKDAYS[top] ?? "", "the busiest day"],
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-separator pt-4 sm:grid-cols-4">
      {facts.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-1">
          <dd className="order-1 m-0 type-stat">{value}</dd>
          <dt className="order-2 type-caption text-pretty">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

function KindsList({ kinds, all }: { kinds: Data["kinds"]; all: number }) {
  const sorted = [...kinds].sort((a, b) => b.commits - a.commits);
  return (
    <div className="grid gap-x-10 @min-[60rem]:grid-cols-2">
      <BarList
        label="Commits by kind of work"
        max={sorted[0]?.commits ?? 1}
        items={sorted.slice(0, Math.ceil(sorted.length / 2)).map((k) => ({ key: k.kind, label: k.kind, value: k.commits, shown: `${grouped(k.commits)} · ${share(k.commits, all)}` }))}
      />
      {sorted.length > 1 && (
        <BarList
          label="Commits by kind of work, continued"
          max={sorted[0]?.commits ?? 1}
          items={sorted.slice(Math.ceil(sorted.length / 2)).map((k) => ({ key: k.kind, label: k.kind, value: k.commits, shown: `${grouped(k.commits)} · ${share(k.commits, all)}` }))}
        />
      )}
    </div>
  );
}

function ClockNote() {
  const tip = useTip();
  return (
    <span
      tabIndex={0}
      className="inline-flex h-6 cursor-help items-center gap-1.5 rounded-full border border-line px-2.5 type-caption font-medium whitespace-nowrap"
      {...tip(
        <TipCard
          icon={<Clock size={ICON.sm} aria-hidden />}
          title="On each author’s own clock"
          body="The hour their commit recorded, in their own time zone: not your time, and not UTC. A team spread across the world still shows its working day."
        />,
      )}
    >
      <Clock size={ICON.xs} aria-hidden />
      Authors’ local time
    </span>
  );
}

function StackLegend({
  stacks,
  total,
  focus,
  onFocus,
  onPick,
}: {
  stacks: (Stack & { person: PersonRef | null })[];
  total: number;
  focus: string | null;
  onFocus: (key: string | null) => void;
  onPick: (key: string) => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="People in the chart" onMouseLeave={() => onFocus(null)}>
      {stacks.map((s) => (
        <LegendChip key={s.key} stack={s} total={total} dim={focus !== null && focus !== s.key} onFocus={onFocus} onPick={onPick} />
      ))}
    </ul>
  );
}

function LegendChip({ stack, total, dim, onFocus, onPick }: { stack: Stack & { person: PersonRef | null }; total: number; dim: boolean; onFocus: (key: string | null) => void; onPick: (key: string) => void }) {
  const login = useLogin(stack.person);
  const n = stack.days.reduce((a, b) => a + b, 0);
  const body = (
    <>
      {stack.person ? (
        <Face login={login} name={stack.person.name} size={20} ring={stack.colour} tint={stack.colour} decorative />
      ) : (
        <span aria-hidden className="ms-1 size-3 flex-none rounded-cell" style={{ background: stack.colour }} />
      )}
      <span className="max-w-40 truncate type-caption font-medium text-primary">
        <bdi>{stack.label}</bdi>
      </span>
      <span className="type-caption tnum">{grouped(n)}</span>
      <span className="type-micro tnum">{share(n, total)}</span>
    </>
  );
  const cls = `flex h-8 items-center gap-2 rounded-full border border-line bg-surface ps-1 pe-3 transition-opacity duration-(--duration-instant) ${dim ? "opacity-45" : ""}`;
  return (
    <li onMouseEnter={() => onFocus(stack.key)}>
      {stack.person ? (
        <button type="button" onClick={() => onPick(stack.key)} onFocus={() => onFocus(stack.key)} onBlur={() => onFocus(null)} title={`${stack.label}’s commits`} className={`${cls} plain-button row-hover`}>
          {body}
        </button>
      ) : (
        <span className={cls}>{body}</span>
      )}
    </li>
  );
}

function Line() {
  return (
    <span className="block h-5">
      <Skeleton height={14} width={260} radius={1} />
    </span>
  );
}

/** The Activity screen while its answer is fetched, the same size as what fills it. */
export function ActivitySkeleton() {
  return (
    <ScreenFrame label="Loading">
      <Panel title="Commits over time, by person" description={<Line />}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton height={CHART} index={1} />
            <div className="h-5" />
            <div className="h-7" />
          </div>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={32} width={190} radius="rounded" index={i} />
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="When the work happens" description={<Line />}>
        <WeekGrid week={Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))} />
        <div className="h-21.5 @max-[40rem]:h-57" />
      </Panel>
    </ScreenFrame>
  );
}
