import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { monthName, PRODUCT } from "@commitscape/data";
import { Face, Figure, grouped, many } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { boardsQuery, peopleBoardsQuery } from "#/lib/queries";

type Window = "season" | "last-season" | "90d" | "all";
const WINDOWS: [Window, string][] = [
  ["season", "This Season"],
  ["last-season", "Last Season"],
  ["90d", "90 days"],
  ["all", "All time"],
];

export const Route = createFileRoute("/leaderboards")({
  validateSearch: (s: Record<string, unknown>): { window?: Window; repo?: string } => ({
    ...(WINDOWS.some(([w]) => w === s.window) ? { window: s.window as Window } : {}),
    ...(typeof s.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(s.repo) ? { repo: s.repo } : {}),
  }),
  head: () => ({ meta: [{ title: `Leaderboards · ${PRODUCT}` }] }),
  component: Leaderboards,
});

const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Leaderboards() {
  const search = Route.useSearch();
  const window = search.window ?? "season";
  return (
    <section className="boards flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            Leaderboards
          </Heading>
          <p className="repo-facts note small">
            <span>People, view by view and never by one score, then repositories. People who chose to stay out are not on them. The people boards start again each Season, a calendar month.</span>
          </p>
        </div>
      </header>
      <Section fallback={<Skeleton height={520} />}>
        <People window={window} repo={search.repo ?? null} />
      </Section>
      <Section fallback={<Skeleton height={600} />}>
        <Repositories />
      </Section>
    </section>
  );
}

function People({ window, repo }: { window: Window; repo: string | null }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(peopleBoardsQuery(window, repo));
  const span = data.from && data.to ? (window === "season" || window === "last-season" ? `${monthName(data.from.slice(0, 7))}${window === "season" ? ", so far" : ""}` : `${data.from} to ${data.to}`) : "all time";
  return (
    <>
      <div className="boards-tools">
        <Heading level={2} className="figure-title">
          People, {span}
        </Heading>
        <div className="flex items-center gap-3 flex-wrap">
          <SegmentedControl label="Window" size="sm" value={window} onChange={(w) => void navigate({ search: (s) => ({ ...s, window: w as Window }) })}>
            {WINDOWS.map(([w, label]) => (
              <SegmentedControlItem key={w} value={w} label={label} />
            ))}
          </SegmentedControl>
          <Selector
            label="Repository"
            isLabelHidden
            size="sm"
            value={repo ?? "all"}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, repo: v === "all" ? undefined : v }) })}
            options={[{ value: "all", label: `Every seed repository (${data.repositories.length})` }, ...data.repositories.map((r) => ({ value: r, label: r }))]}
            width={260}
          />
        </div>
      </div>
      <div className="three">
        {data.boards.map((b) => (
          <Figure key={b.id} title={b.title} note={b.how} id={b.id}>
            {b.rows.length === 0 ? (
              <p className="note">Nobody in this window yet.</p>
            ) : (
              <ol className="people-board">
                {b.rows.map((r, i) => (
                  <li key={r.login}>
                    <span className="place">{i === 0 || (b.rows[i - 1]?.value ?? 0) > r.value ? i + 1 : ""}</span>
                    <Face login={r.login} name={r.login} size={24} />
                    <a href={repo ? `/u/${r.login}/${repo}` : `/u/${r.login}`}>{r.login}</a>
                    <span className="num small" title={many(r.value, ...b.unit)}>
                      {many(r.value, ...b.short)}
                      {!repo && r.repositories > 1 && <span className="note"> in {r.repositories}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Figure>
        ))}
      </div>
    </>
  );
}

function Repositories() {
  const { data: boards } = useSuspenseQuery(boardsQuery());
  return (
    <>
      <Heading level={2} className="figure-title">
        Repositories
      </Heading>
      <p className="note">
        Ranked by what commitscape measures in their history.
        {boards.from > 0 && (
          <>
            {" "}
            Updated {day(boards.builtAt)}, from {grouped(boards.from)} of the most starred repositories on GitHub in each language.
          </>
        )}
      </p>
      {boards.boards.length === 0 && <p>No boards yet: they are written once the first night's repositories are read.</p>}
      <div className="two">
        {boards.boards.map((b) => (
          <Card key={b.id} padding={4} className="figure board" id={b.id}>
            <Heading level={3} className="figure-title">
              {b.title}
            </Heading>
            <p className="note">{b.how}</p>
            {b.rows.length === 0 ? (
              <p className="note">None yet.</p>
            ) : (
              <ol className="board-rows">
                {b.rows.map((r) => (
                  <li key={`${r.owner}/${r.name}`}>
                    <a href={`/gh/${r.owner}/${r.name}`}>
                      {r.owner}/{r.name}
                    </a>
                    <span className="note small">{r.language}</span>
                    <span className="board-value">{r.shown}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
