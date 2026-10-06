import type { Activity as Data } from "@commitscape/data";
import { useData } from "../data";
import { Clock } from "lucide-react";
import { peakOf, WeekGrid } from "../charts/Grid";
import { useTip } from "../charts/tip";
import { Lines } from "../charts/Lines";
import { Explain } from "../explain";
import { grouped, many, share } from "../format";
import { Panel } from "../kit/layout";
import { COLOR, ICON, SERIES } from "../design/tokens";
import { personColour } from "../theme";
import { Failed, Quiet, ScreenFrame, StacksOverTime, type Stack, within } from "./kit";
import type { ScreenProps } from "./props";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

const TYPED = new Set(["features", "fixes", "refactors", "performance", "style", "build", "chores"]);
const CONVENTIONAL = 0.3;

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** How the work moved: commits over time by person, pull requests and issues, the hours of the week, and the kinds of work. */
export function Activity({ params }: ScreenProps) {
  const { data: a, error, stale } = useData<Data>("/api/activity", params);
  if (error || !a) return <Failed words={error} />;
  const span = within(a.window);
  const stacks: Stack[] = [
    ...a.people.map((p, i) => ({ key: `p${i}`, label: p.name, colour: personColour(p.colour), days: a.days.map((d) => d[i] ?? 0) })),
    { key: "rest", label: "Everyone else", colour: "var(--other)", days: a.days.map((d) => d[a.people.length] ?? 0) },
  ].filter((s) => s.days.some((v) => v > 0));
  const commits = a.days.reduce((n, d) => n + d.reduce((m, v) => m + v, 0), 0);
  const told = a.kinds.reduce((n, k) => n + k.commits, 0);
  const typed = a.kinds.filter((k) => TYPED.has(k.kind)).reduce((n, k) => n + k.commits, 0);
  const kinds = told > 0 && typed >= (told + a.unclassified) * CONVENTIONAL;
  const releases = a.releases.filter((r) => {
    const d = Math.floor(r.time / 86_400);
    return d >= a.first_day && d < a.first_day + a.days.length;
  });
  const peak = peakOf(a.week);
  return (
    <ScreenFrame stale={stale}>
      <Panel
        title="Commits over time, by person"
        description={`${many(commits, "commit", "commits")} ${span}: the five who made most, then everyone else`}
        actions={releases.length > 0 ? <span className="type-micro">{many(releases.length, "release", "releases")} in this Window</span> : undefined}
      >
        {commits === 0 ? <Quiet>No commits in this Window. Choose a longer one above.</Quiet> : <StacksOverTime firstDay={a.first_day} stacks={stacks} unit="commits" height={280} />}
        <Explain>Commits that are not merges, stacked by who made them. Each person keeps one colour on every screen, fixed by their commits over all of history.</Explain>
      </Panel>

      {a.github && (
        <Panel title="Pull requests and issues" description={`A week at a time${a.github.complete ? "" : ", from what has been read of GitHub so far"}`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <Lines
              unit="pull requests"
              firstWeek={a.github.first_week}
              lines={[
                { label: "Pull requests opened", colour: "var(--s1)", values: a.github.opened },
                { label: "Pull requests merged", colour: "var(--brand)", values: a.github.merged, dashed: true },
              ]}
            />
            <Lines
              unit="issues"
              firstWeek={a.github.first_week}
              lines={[
                { label: "Issues opened", colour: "var(--s2)", values: a.github.issues_opened },
                { label: "Issues closed", colour: "var(--s3)", values: a.github.issues_closed, dashed: true },
              ]}
            />
          </div>
          <Explain>From GitHub's history of the repository, read a page at a time and kept, so later Builds read only what changed.</Explain>
        </Panel>
      )}

      <div className="flex flex-col gap-gutter">
        <Panel
          title="When the work happens"
          description={peak ? `Busiest on ${WEEKDAYS[peak.day]} from ${hh(peak.hour)} to ${hh(peak.hour + 1)}: ${many(peak.commits, "commit", "commits")}, ${peak.times.toFixed(peak.times >= 10 ? 0 : 1)}× a typical hour` : "Commits by weekday and hour"}
          actions={<ClockNote />}
        >
          <div className="flex flex-col gap-x-10 gap-y-5 lg:flex-row lg:items-start">
            <div className="max-w-[54rem] min-w-0 flex-1">
              <WeekGrid week={a.week} />
            </div>
            <Rhythm week={a.week} />
          </div>
          <Explain>Each commit at the hour its author's clock showed, so a team across time zones still shows its working day. The bars above are each hour's total across the week, those beside each day's share; the ringed cell is the busiest hour.</Explain>
        </Panel>
        {kinds && (
          <Panel title="Kinds of work" description={`${share(typed, told + a.unclassified)} of commits say their kind in a conventional prefix (feat:, fix:…)`}>
            <KindsBar kinds={a.kinds} all={told + a.unclassified} />
            <Explain>
              Judged from the files a commit changed first (only tests, only docs, only CI, only dependency manifests), and from its message when the files cannot tell. {grouped(a.unclassified)} commits could be told by neither.
            </Explain>
          </Panel>
        )}
      </div>
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
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:w-52 lg:flex-none lg:grid-cols-1 lg:border-s lg:border-line lg:ps-6">
      {facts.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-1.5">
          <dt className="order-2 type-caption text-pretty">{label}</dt>
          <dd className="order-1 m-0 type-stat-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function KindsBar({ kinds, all }: { kinds: Data["kinds"]; all: number }) {
  const tip = useTip();
  const parts = kinds.map((k, i) => ({ ...k, colour: SERIES[i] ?? COLOR.other }));
  const told = kinds.reduce((n, k) => n + k.commits, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Commits by kind of work">
        {parts.map((p) => (
          <span key={p.kind} className="block h-full min-w-0.75 transition-opacity hover:opacity-80" style={{ width: `${(p.commits * 100) / Math.max(1, told)}%`, background: p.colour }} {...tip(<><strong>{p.kind}</strong><div className="note">{many(p.commits, "commit", "commits")} · {share(p.commits, all)} of all</div></>)} />
        ))}
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-8 gap-y-2 p-0 sm:grid-cols-3 lg:grid-cols-4" aria-label="Kinds of work">
        {parts.map((p) => (
          <li key={p.kind} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: p.colour }} />
            <span className="truncate">{p.kind}</span>
            <span className="ms-auto text-xs whitespace-nowrap text-secondary tnum">
              {grouped(p.commits)} · {share(p.commits, all)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClockNote() {
  const tip = useTip();
  return (
    <span
      tabIndex={0}
      className="inline-flex h-6 cursor-help items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium whitespace-nowrap text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent-bg"
      {...tip(
        <>
          <strong>On each author's own clock</strong>
          <div className="note">The hour their commit recorded, in their own time zone: not your time, and not UTC. A team spread across the world still shows its working day.</div>
        </>,
      )}
    >
      <Clock size={ICON.xs} aria-hidden />
      Authors' local time
    </span>
  );
}
