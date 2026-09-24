import type { Activity as Data } from "../api/types";
import { useData } from "../api/useData";
import { Bars } from "../charts/Bars";
import { Columns } from "../charts/Columns";
import { Figure } from "../charts/common";
import { WeekGrid } from "../charts/Grid";
import { Lines } from "../charts/Lines";
import { Explain } from "../explain";
import { githubWhy, grouped, many, share, WINDOW_WORDS } from "../format";
import { personColour } from "../theme";
import type { ScreenProps } from "./props";

export function Activity({ meta, params }: ScreenProps) {
  const { data: a, error, stale } = useData<Data>("/api/activity", params, meta.generation);
  if (error) return <p className="error">{error}</p>;
  if (!a) return <p className="waiting">Reading…</p>;
  const span = WINDOW_WORDS[a.window] ?? a.window;
  const series = [
    ...a.people.map((p, i) => ({
      label: p.name,
      colour: personColour(p.colour),
      values: a.days.map((d) => d[i] ?? 0),
    })),
    {
      label: "Everyone else",
      colour: "var(--other)",
      values: a.days.map((d) => d[a.people.length] ?? 0),
    },
  ].filter((s) => s.values.some((v) => v > 0));
  const commits = a.days.reduce((n, d) => n + d.reduce((m, v) => m + v, 0), 0);
  const told = a.kinds.reduce((n, k) => n + k.commits, 0);
  return (
    <main className={stale ? "stale" : undefined}>
      <Figure
        title="Commits over time, by person"
        note={`${many(commits, "commit", "commits")} in ${span}; the five who made most, then everyone else`}
      >
        <Columns
          firstDay={a.first_day}
          series={series}
          marks={a.releases.map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name }))}
        />
        <Explain>
          Commits that are not merges, stacked by who made them. Each person keeps one colour on every screen, fixed by
          their commits over all of history. Dashed lines are releases: the repository's version tags, and GitHub's
          releases once they are read.
        </Explain>
      </Figure>

      <Figure
        title="Pull requests and issues"
        note={
          a.github
            ? `A week at a time${a.github.complete ? "" : ", from what has been read of GitHub so far"}`
            : undefined
        }
      >
        {a.github ? (
          <div className="two">
            <Lines
              unit="pull requests"
              firstWeek={a.github.first_week}
              lines={[
                { label: "Pull requests opened", colour: "var(--s1)", values: a.github.opened },
                { label: "Pull requests merged", colour: "var(--s2)", values: a.github.merged, dashed: true },
              ]}
            />
            <Lines
              unit="issues"
              firstWeek={a.github.first_week}
              lines={[
                { label: "Issues opened", colour: "var(--s1)", values: a.github.issues_opened },
                { label: "Issues closed", colour: "var(--s2)", values: a.github.issues_closed, dashed: true },
              ]}
            />
          </div>
        ) : (
          <p className="note">{githubWhy(meta.github, meta.github_history)}</p>
        )}
        <Explain>
          From GitHub's whole history of the repository, read through the gh CLI a page at a time and kept, so later
          visits read only what changed.
        </Explain>
      </Figure>

      <div className="two">
        <Figure title="When the work happens" note="Commits by weekday and hour, on each author's own clock">
          <WeekGrid week={a.week} />
          <Explain>Each commit at the hour its author's clock showed, so a team across time zones still shows its working day.</Explain>
        </Figure>
        <Figure title="Kinds of work" note={a.kinds.length > 0 ? `${share(told, told + a.unclassified)} of commits could be told` : undefined}>
          {a.kinds.length === 0 ? (
            <p className="note">
              Most commits here could not be told apart by their files or their message ({grouped(a.unclassified)} of them),
              so no split is shown rather than a misleading one.
            </p>
          ) : (
            <Bars
              unit="commits"
              bars={a.kinds.map((k) => ({
                key: k.kind,
                label: k.kind,
                value: k.commits,
                shown: `${grouped(k.commits)} · ${share(k.commits, told + a.unclassified)}`,
              }))}
            />
          )}
          <Explain>
            Judged from the files a commit changed first (only tests, only docs, only CI, only dependency manifests), and
            from its message when the files cannot tell. {grouped(a.unclassified)} commits could be told by neither.
          </Explain>
        </Figure>
      </div>
    </main>
  );
}
