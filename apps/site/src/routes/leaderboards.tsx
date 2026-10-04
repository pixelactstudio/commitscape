import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { monthName, PRODUCT, type Board } from "@commitscape/data";
import { compact, date, Face, grouped, many, Page, PageHead, Panel } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { boardsQuery, peopleBoardsQuery } from "#/lib/queries";

type Window = "season" | "last-season" | "90d" | "all";
const WINDOWS: [Window, string][] = [
  ["season", "This Season"],
  ["last-season", "Last Season"],
  ["90d", "90 days"],
  ["all", "All time"],
];

type Search = { window?: Window; repo?: string; tab?: "people" | "repositories" };

export const Route = createFileRoute("/leaderboards")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(WINDOWS.some(([w]) => w === s.window) ? { window: s.window as Window } : {}),
    ...(typeof s.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(s.repo) ? { repo: s.repo } : {}),
    ...(s.tab === "repositories" ? { tab: "repositories" as const } : {}),
  }),
  loaderDeps: ({ search }) => ({ window: search.window ?? "season", repo: search.repo ?? null, tab: search.tab ?? "people" }),
  loader: ({ context, deps }) => (deps.tab === "people" ? context.queryClient.ensureQueryData(peopleBoardsQuery(deps.window, deps.repo)) : context.queryClient.ensureQueryData(boardsQuery())),
  head: () => ({ meta: [{ title: `Leaderboards · ${PRODUCT}` }, { name: "description", content: "Who merged, reviewed and wrote the most in the most starred repositories on GitHub, view by view. People who chose to stay out are not on them." }] }),
  component: Leaderboards,
});

function Leaderboards() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? "people";
  return (
    <Page className="pb-16">
      <PageHead
        title="Leaderboards"
        description="People view by view, never by one score, then the repositories themselves. The people boards start again each Season, a calendar month; anyone who chose to stay out is left off."
      />
      <div className="mb-6 border-b border-line">
        <TabList value={tab} onChange={(t) => void navigate({ search: (s) => ({ ...s, tab: t === "people" ? undefined : (t as "repositories") }), resetScroll: false })}>
          <Tab value="people" label="People" />
          <Tab value="repositories" label="Repositories" />
        </TabList>
      </div>
      {tab === "people" ? (
        <Section fallback={<PeopleSkeleton />}>
          <People window={search.window ?? "season"} repo={search.repo ?? null} />
        </Section>
      ) : (
        <Section fallback={<RepositoriesSkeleton />}>
          <Repositories />
        </Section>
      )}
    </Page>
  );
}

function PeopleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton height={36} width="60%" radius={3} />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={760} index={i} radius={4} />
        ))}
      </div>
    </div>
  );
}

function RepositoriesSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={420} index={i} radius={4} />
      ))}
    </div>
  );
}

function People({ window, repo }: { window: Window; repo: string | null }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(peopleBoardsQuery(window, repo));
  const span = data.from && data.to ? (window === "season" || window === "last-season" ? `${monthName(data.from.slice(0, 7))}${window === "season" ? ", so far" : ""}` : `${data.from} to ${data.to}`) : "All time";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-lg font-semibold tracking-tight">{span}</span>
          <span className="text-sm text-secondary">{repo ? `In ${repo}` : `Across ${many(data.repositories.length, "repository", "repositories")} read nightly`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Window" size="sm" value={window} onChange={(w) => void navigate({ search: (s) => ({ ...s, window: w === "season" ? undefined : (w as Window) }), resetScroll: false })}>
            {WINDOWS.map(([w, label]) => (
              <SegmentedControlItem key={w} value={w} label={label} />
            ))}
          </SegmentedControl>
          <Selector
            label="Repository"
            isLabelHidden
            size="sm"
            value={repo ?? "all"}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, repo: v === "all" ? undefined : v }), resetScroll: false })}
            options={[{ value: "all", label: "Every repository" }, ...data.repositories.map((r) => ({ value: r, label: r }))]}
            width={240}
          />
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {data.boards.map((b) => (
          <PersonBoard key={b.id} board={b} repo={repo} />
        ))}
      </div>
    </div>
  );
}

const MEDALS = ["#e8b931", "#b8bec7", "#c98a54"];

function PersonBoard({ board, repo }: { board: { id: string; title: string; how: string; unit: [string, string]; short: [string, string]; rows: { login: string; value: number; repositories: number }[] }; repo: string | null }) {
  const [all, setAll] = useState(false);
  const podium = board.rows.slice(0, 3);
  const rest = board.rows.slice(3, all ? undefined : 10);
  const href = (login: string) => (repo ? `/u/${login}/${repo}` : `/u/${login}`);
  const order = ["order-2", "order-1", "order-3"];
  return (
    <Panel padding={0} title={board.title} description={board.how}>
      {board.rows.length === 0 ? (
        <p className="m-0 px-5 pb-8 pt-4 text-center text-sm text-secondary">Nobody in this window yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2 px-5 pt-2 pb-5">
            {podium.map((r, place) => {
              const height = [96, 72, 56][place];
              return (
                <Link key={r.login} to={href(r.login) as "/"} className={`group flex min-w-0 flex-col items-center gap-2 text-primary no-underline ${order[place]}`}>
                  <span className="relative">
                    <Face login={r.login} name={r.login} size={place === 0 ? 64 : 48} />
                    <span className="absolute -end-1 -bottom-1 grid size-5 place-items-center rounded-full text-[0.65rem] font-bold text-[#141416] shadow-[0_0_0_2px_var(--color-background-surface)]" style={{ background: MEDALS[place] }}>
                      {place + 1}
                    </span>
                  </span>
                  <span className="w-full truncate text-center text-xs font-medium group-hover:underline">{r.login}</span>
                  <span className="podium flex w-full flex-col items-center justify-start rounded-t-[10px] pt-2 text-sm font-semibold tnum" style={{ height }}>
                    {compact(r.value)}
                  </span>
                </Link>
              );
            })}
          </div>
          <ol className="m-0 list-none border-t border-line p-0" start={4}>
            {rest.map((r, i) => (
              <li key={r.login} className="border-b border-line last:border-b-0">
                <Link to={href(r.login) as "/"} className="flex items-center gap-3 px-5 py-2 text-sm text-primary no-underline transition-colors hover:bg-[var(--color-overlay-hover)]">
                  <span className="w-5 text-end text-xs text-secondary tnum">{i + 4}</span>
                  <Face login={r.login} name={r.login} size={24} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.login}</span>
                  <span className="text-secondary tnum" title={many(r.value, ...board.unit)}>
                    {grouped(r.value)}
                    {!repo && r.repositories > 1 && <span className="text-xs"> · {r.repositories} repos</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {board.rows.length > 10 && (
            <div className="border-t border-line px-5 py-2">
              <Button label={all ? "Show fewer" : `Show all ${board.rows.length}`} variant="ghost" size="sm" onClick={() => setAll(!all)} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Repositories() {
  const { data: boards } = useSuspenseQuery(boardsQuery());
  if (boards.boards.length === 0) return <p className="py-16 text-center text-secondary">No boards yet: they are written once the first night's repositories are read.</p>;
  return (
    <div className="flex flex-col gap-4">
      {boards.from > 0 && (
        <p className="m-0 text-sm text-secondary">
          Ranked by what commitscape measures in their history. Updated {date(boards.builtAt)}, from {grouped(boards.from)} of the most starred repositories on GitHub in each language.
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {boards.boards.map((b) => (
          <RepoBoard key={b.id} board={b} />
        ))}
      </div>
    </div>
  );
}

function RepoBoard({ board }: { board: Board }) {
  return (
    <Panel padding={0} title={board.title} description={board.how} id={board.id}>
      {board.rows.length === 0 ? (
        <p className="m-0 px-5 pb-6 text-sm text-secondary">None yet.</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {board.rows.map((r, i) => (
            <li key={`${r.owner}/${r.name}`} className="border-t border-line">
              <Link to="/gh/$owner/$repo" params={{ owner: r.owner, repo: r.name }} className="flex items-center gap-3 px-5 py-2.5 text-sm text-primary no-underline transition-colors hover:bg-[var(--color-overlay-hover)]">
                <span className="w-5 text-end text-xs text-secondary tnum">{i + 1}</span>
                <Face login={r.owner} name={r.owner} size={24} shape="rounded" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    <span className="text-secondary">{r.owner}/</span>
                    {r.name}
                  </span>
                  <span className="text-xs text-secondary">
                    {[r.language, r.stars > 0 ? `★ ${compact(r.stars)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex-none text-end text-secondary tnum">{r.shown}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
