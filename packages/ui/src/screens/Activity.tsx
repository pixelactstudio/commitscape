import type { Activity as Data } from "@commitscape/data";
import { useData } from "../data";
import { WeekGrid } from "../charts/Grid";
import { Lines } from "../charts/Lines";
import { Explain } from "../explain";
import { grouped, many, share } from "../format";
import { Panel } from "../kit/layout";
import { personColour } from "../theme";
import { BarList, Failed, Quiet, ScreenFrame, StacksOverTime, type Stack, within } from "./kit";
import type { ScreenProps } from "./props";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

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
  const kinds = told >= (told + a.unclassified) / 4 && told > 0;
  const releases = a.releases.filter((r) => {
    const d = Math.floor(r.time / 86_400);
    return d >= a.first_day && d < a.first_day + a.days.length;
  });
  const busiest = busiestHour(a.week);
  return (
    <ScreenFrame stale={stale}>
      <Panel
        title="Commits over time, by person"
        description={`${many(commits, "commit", "commits")} ${span}: the five who made most, then everyone else`}
        actions={releases.length > 0 ? <span className="text-xs text-secondary">{many(releases.length, "release", "releases")} in this Window</span> : undefined}
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

      <div className={`grid gap-4 ${kinds ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
        <Panel title="When the work happens" description={busiest ? `Busiest on ${busiest}, on each author's own clock` : "Commits by weekday and hour, on each author's own clock"}>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            <div className="max-w-[44rem] min-w-[16rem] flex-1">
              <WeekGrid week={a.week} />
            </div>
            <Rhythm week={a.week} />
          </div>
          <Explain>Each commit at the hour its author's clock showed, so a team across time zones still shows its working day.</Explain>
        </Panel>
        {kinds && (
          <Panel title="Kinds of work" description={`${share(told, told + a.unclassified)} of commits could be told`}>
            <BarList
              label="Kinds of work"
              items={a.kinds.map((k, i) => ({
                key: k.kind,
                label: k.kind,
                value: k.commits,
                shown: `${grouped(k.commits)} · ${share(k.commits, told + a.unclassified)}`,
                colour: `var(--s${(i % 8) + 1})`,
              }))}
            />
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
  const days = week.map((hours) => hours.reduce((a, b) => a + b, 0));
  const top = days.indexOf(Math.max(...days));
  const facts: [string, string][] = [
    [share(all - weekend, all), "on weekdays"],
    [share(weekend, all), "on weekends"],
    [share(night, all), "between 22:00 and 05:00"],
    [WEEKDAYS[top] ?? "", "the busiest day"],
  ];
  return (
    <dl className="m-0 grid w-full grid-cols-2 gap-x-6 gap-y-4 sm:w-auto sm:grid-cols-4 lg:w-44 lg:grid-cols-1">
      {facts.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="order-2 text-xs text-secondary">{label}</dt>
          <dd className="order-1 m-0 text-[1.3rem] leading-tight font-semibold tracking-[-0.02em]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function busiestHour(week: number[][]): string | null {
  let best = { n: 0, d: -1, h: -1 };
  week.forEach((hours, d) => hours.forEach((n, h) => n > best.n && (best = { n, d, h })));
  if (best.d < 0) return null;
  return `${WEEKDAYS[best.d]} at ${String(best.h).padStart(2, "0")}:00`;
}
