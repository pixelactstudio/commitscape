import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Star } from "lucide-react";
import { monthName, PRODUCT, type Board } from "@commitscape/data";
import { compact, date, Face, FaceStack, grouped, many, MEDAL, Page, PageHead, Surface } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { CountUp, Nothing } from "@commitscape/ui/motion";
import { Section } from "#/components/Boundary";
import { boardsQuery, peopleBoardsQuery } from "#/lib/queries";
import type { PeopleBoard, PeopleBoards, SeedRepo } from "#/server/people-boards";

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

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function spanOf(data: Pick<PeopleBoards, "window" | "from" | "to" | "today">): { title: string; dates: string | null } {
  if (!data.from || !data.to) return { title: "All time", dates: null };
  const to = data.to > data.today ? data.today : data.to;
  const dates = data.from === to ? shortDay(to) : `${shortDay(data.from)} to ${shortDay(to)}`;
  if (data.window === "season") return { title: `${monthName(data.from.slice(0, 7))}, so far`, dates };
  if (data.window === "last-season") return { title: monthName(data.from.slice(0, 7)), dates };
  return { title: "The last 90 days", dates };
}

function Leaderboards() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? "people";
  const [explaining, setExplaining] = useState(false);
  return (
    <Page className="pb-section">
      <PageHead
        title="Leaderboards"
        description="Who merged, reviewed and wrote the most in the most starred repositories on GitHub, view by view. Never one score, and every board says what it counts."
      />
      <Explainer isOpen={explaining} onOpenChange={setExplaining} />
      <div className="mb-6 border-b border-separator">
        <TabList value={tab} onChange={(t) => void navigate({ search: (s) => ({ ...s, tab: t === "people" ? undefined : (t as "repositories") }), resetScroll: false })}>
          <Tab value="people" label="People" />
          <Tab value="repositories" label="Repositories" />
        </TabList>
      </div>
      {tab === "people" ? (
        <Section fallback={<PeopleSkeleton />}>
          <People window={search.window ?? "season"} repo={search.repo ?? null} onExplain={() => setExplaining(true)} />
        </Section>
      ) : (
        <Section fallback={<RepositoriesSkeleton />}>
          <Repositories onExplain={() => setExplaining(true)} />
        </Section>
      )}
    </Page>
  );
}

function Explainer({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { data } = useQuery({ ...peopleBoardsQuery("season", null), enabled: isOpen });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width="min(680px, 94vw)" maxHeight="88dvh" padding={5}>
      <DialogHeader title="How these boards work" onOpenChange={onOpenChange} />
      <div className="flex flex-col gap-5 pt-4 type-ui">
        <Explain title="Which repositories">
          Each night commitscape asks GitHub for the most starred repositories in each of several languages (JavaScript, TypeScript, Python, Go, Rust and more) and reads their history and pull requests. Every board, people and repositories, counts only those.
          {data ? (
            <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
              {data.repositories.map((r) => (
                <li key={r.id}>
                  <RepoChip r={r} wide />
                </li>
              ))}
            </ul>
          ) : (
            <Skeleton height={96} radius={3} className="mt-3" />
          )}
          {data && data.waiting > 0 && <span className="mt-2 block text-secondary">{many(data.waiting, "more is", "more are")} waiting for a first read and not counted yet.</span>}
        </Explain>
        <Explain title="What each people board counts">
          <ul className="m-0 flex list-disc flex-col gap-1.5 ps-5">
            <li>
              <strong>Pull requests merged</strong>: pull requests merged into those repositories within the window, credited to whoever opened them.
            </li>
            <li>
              <strong>Pull requests reviewed</strong>: other people’s pull requests reviewed at least once, each counted once, on the day of the first review.
            </li>
            <li>
              <strong>Lines still running</strong>: lines at the head of those repositories that a person wrote, all time whatever the window. They are counted for the 30 people with most commits in each repository, and for anyone whose page has been opened.
            </li>
          </ul>
        </Explain>
        <Explain title="The window">
          A Season is a calendar month on UTC’s clock: This Season runs from the 1st to today, and starts again on the 1st. Last Season is the whole previous month; 90 days ends today; All time has no limit.
        </Explain>
        <Explain title="Why a small number can top a board">
          Only work inside those repositories, inside the window, counts. Someone with 12 merged pull requests there this month leads even if they merged thousands elsewhere. For everything a person has done on GitHub, open their Profile or a Versus.
        </Explain>
        <Explain title="Who is left out">Bots, and anyone who chose to stay out of comparisons. People with the same number share a place.</Explain>
      </div>
    </Dialog>
  );
}

function Explain({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 type-label">{title}</h3>
      <div className="text-pretty text-secondary [&_strong]:font-medium [&_strong]:text-primary">{children}</div>
    </section>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 tnum">
      <Star size={ICON.xs} aria-hidden /> {compact(n)}
      <span className="sr-only"> stars</span>
    </span>
  );
}

function RepoChip({ r, wide = false }: { r: SeedRepo; wide?: boolean }) {
  return (
    <Link to="/gh/$owner/$repo" params={{ owner: r.owner, repo: r.name }} className={`group surface row-hover flex min-w-0 items-center gap-2.5 px-2.5 py-2 text-primary no-underline ${wide ? "" : "pe-3"}`}>
      <Face login={r.owner} name={r.owner} size={24} shape="rounded" decorative />
      <span className="flex min-w-0 flex-col">
        <span className="type-ui font-medium [overflow-wrap:anywhere] group-hover:underline">
          <span className="text-secondary">{r.owner}/</span>
          {r.name}
        </span>
        <span className="flex items-center gap-2 type-caption">
          <Stars n={r.stars} />
          {r.language && <span>{r.language}</span>}
          {wide && r.readAt > 0 && <span>read {date(r.readAt)}</span>}
        </span>
      </span>
    </Link>
  );
}

const ROW_PLACES = 7;
const ROW_HEIGHT = 44;
const REPO_ROWS = 5;
const REPO_ROW_HEIGHT = 56;
const BOARD_HEAD = 104;
const PODIUM = 200;

function PeopleSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton height={24} width={220} radius={2} />
          <Skeleton height={13} width={160} radius={1} />
        </div>
        <Skeleton height={32} width={480} radius={3} />
      </div>
      <Skeleton height={24} width={420} radius={1} />
      <div className="grid gap-gutter lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={BOARD_HEAD + PODIUM + ROW_PLACES * ROW_HEIGHT} index={i} radius={4} />
        ))}
      </div>
    </div>
  );
}

function RepositoriesSkeleton() {
  return (
    <div className="grid gap-gutter md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={BOARD_HEAD + REPO_ROWS * REPO_ROW_HEIGHT} index={i} radius={4} />
      ))}
    </div>
  );
}

function People({ window, repo, onExplain }: { window: Window; repo: string | null; onExplain: () => void }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(peopleBoardsQuery(window, repo));
  const [all, setAll] = useState(false);
  const span = spanOf(data);
  const longest = Math.max(0, ...data.boards.map((b) => b.rows.length));
  const places = all ? Math.max(ROW_PLACES, longest - 3) : ROW_PLACES;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 type-title">{span.title}</h2>
          <span className="type-caption">{span.dates ? `${span.dates}${data.window === "all" ? "" : ", UTC"}` : "Every pull request read so far"}</span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="hidden sm:block">
            <SegmentedControl label="Window" size="md" value={window} onChange={(w) => void navigate({ search: (s) => ({ ...s, window: w === "season" ? undefined : (w as Window) }), resetScroll: false })}>
              {WINDOWS.map(([w, label]) => (
                <SegmentedControlItem key={w} value={w} label={label} />
              ))}
            </SegmentedControl>
          </div>
          <div className="sm:hidden">
            <Selector
              label="Window"
              isLabelHidden
              size="md"
              value={window}
              onChange={(w) => void navigate({ search: (s) => ({ ...s, window: w === "season" ? undefined : (w as Window) }), resetScroll: false })}
              options={WINDOWS.map(([w, label]) => ({ value: w, label }))}
              width={170}
            />
          </div>
          <Selector
            label="Repository"
            isLabelHidden
            size="md"
            value={repo && data.repo ? data.repo : "all"}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, repo: v === "all" ? undefined : v }), resetScroll: false })}
            options={[{ value: "all", label: `All ${data.repositories.length} repositories` }, ...data.repositories.map((r) => ({ value: `${r.owner}/${r.name}`, label: `${r.owner}/${r.name}` }))]}
            width={240}
          />
        </div>
      </div>
      <Counted data={data} onExplain={onExplain} />
      <div className="grid gap-gutter lg:grid-cols-3">
        {data.boards.map((b) => (
          <PersonBoard key={b.id} board={b} repo={data.repo} places={places} />
        ))}
      </div>
      {longest > ROW_PLACES + 3 && (
        <div className="flex justify-center">
          <Button label={all ? "Show the top 10" : `Show every place, up to ${longest}`} variant="secondary" size="sm" icon={<Icon icon={ChevronDown} size="sm" className={all ? "rotate-180" : ""} />} onClick={() => setAll(!all)} />
        </div>
      )}
    </div>
  );
}

function Counted({ data, onExplain }: { data: PeopleBoards; onExplain: () => void }) {
  const shown = data.repo ? data.repositories.filter((r) => `${r.owner}/${r.name}` === data.repo) : data.repositories;
  const names = shown.slice(0, 3).map((r) => r.name);
  const rest = shown.length - names.length;
  return (
    <section aria-label="Repositories counted" className="flex items-start gap-3">
      {shown.length > 0 && (
        <span className="mt-0.5 hidden sm:flex">
          <FaceStack people={shown.slice(0, 5).map((r) => ({ login: r.owner }))} size={24} edge="body" />
        </span>
      )}
      <p className="m-0 min-w-0 max-w-4xl type-description text-pretty">
        {shown.length === 0 ? (
          "No repository has been read yet: the boards fill after the first night."
        ) : data.repo ? (
          <>
            Counting <strong className="font-medium text-primary">{data.repo}</strong> only. Pick All repositories to count every one.
          </>
        ) : (
          <>
            Counting <strong className="font-medium text-primary">{many(shown.length, "repository", "repositories")}</strong>: {names.join(", ")}
            {rest > 0 ? ` and ${rest} more` : ""}, the most starred on GitHub in each language. Work elsewhere is not on these boards.
            {data.waiting > 0 && ` ${many(data.waiting, "more waits", "more wait")} for a first read.`}
          </>
        )}{" "}
        <button type="button" onClick={onExplain} className="plain-button inline-link">
          How these boards work
        </button>
      </p>
    </section>
  );
}

function PersonBoard({ board, repo, places }: { board: PeopleBoard; repo: string | null; places: number }) {
  const podium = board.rows.slice(0, 3);
  const rest = board.rows.slice(3, 3 + places);
  const href = (login: string) => (repo ? `/u/${login}/${repo}` : `/u/${login}`);
  const order = ["order-2", "order-1", "order-3"];
  return (
    <Surface as="section" aria-label={board.title} className="grid min-w-0 grid-cols-1 grid-rows-[auto_auto_1fr] overflow-hidden lg:row-span-3 lg:grid-rows-subgrid lg:gap-y-0">
      <header className="flex flex-col gap-1 px-5 pt-5 pb-2">
        <h2 className="m-0 type-panel">{board.title}</h2>
        <p className="m-0 type-description">{board.how}</p>
      </header>
      {board.rows.length === 0 ? (
        <div className="row-span-2 flex items-center justify-center px-5 pb-6">
          <Nothing compact title="Nobody in this window yet." words="Try a longer window, or another repository." />
        </div>
      ) : (
        <>
          <div className="grid min-h-50 grid-cols-3 items-end gap-2 self-end px-5 pb-0">
            {[0, 1, 2].map((place) => {
              const r = podium[place];
              if (!r) return <span key={place} className={order[place]} />;
              const height = [92, 68, 52][place];
              return (
                <Link key={r.login} to={href(r.login) as "/"} className={`group flex min-w-0 flex-col items-center gap-2 text-primary no-underline ${order[place]}`}>
                  <span className="relative">
                    <Face login={r.login} name={r.login} size={place === 0 ? 64 : 48} decorative />
                    <span className="absolute -end-1 -bottom-1 grid size-5 place-items-center rounded-full type-micro font-bold text-on-medal ring-2 ring-surface" style={{ background: MEDAL[r.place - 1] ?? "var(--color-border-emphasized)" }}>
                      <span className="sr-only">Place </span>
                      {r.place}
                    </span>
                  </span>
                  <span className="w-full text-center type-caption font-medium text-balance text-primary [overflow-wrap:anywhere] group-hover:underline">{r.login}</span>
                  <span className="podium flex w-full flex-col items-center justify-start rounded-t-lg pt-2 type-ui font-semibold tnum" style={{ height }} title={many(r.value, ...board.unit)}>
                    <CountUp value={r.value} format={(n) => compact(Math.round(n))} />
                    <span className="type-micro font-normal">{r.value === 1 ? board.short[0] : board.short[1]}</span>
                  </span>
                </Link>
              );
            })}
          </div>
          <ol className="m-0 flex list-none flex-col border-t border-line p-0" style={{ minHeight: places * ROW_HEIGHT }}>
            {rest.map((r) => (
              <li key={r.login} className="border-b border-line last:border-b-0" style={{ height: ROW_HEIGHT }}>
                <Link to={href(r.login) as "/"} className="row-hover flex h-full items-center gap-3 px-5 type-ui text-primary no-underline">
                  <span className="w-6 text-end type-caption tnum">{r.place}</span>
                  <Face login={r.login} name={r.login} size={24} decorative />
                  <span className="min-w-0 flex-1 leading-tight font-medium [overflow-wrap:anywhere]">{r.login}</span>
                  <span className="text-secondary tnum" title={many(r.value, ...board.unit)}>
                    {!repo && r.repositories > 1 && <span className="me-2 type-micro">in {r.repositories}</span>}
                    {grouped(r.value)}
                  </span>
                </Link>
              </li>
            ))}
            {rest.length < places && <li className="flex flex-1 items-center justify-center px-5 py-3 type-caption">{board.rows.length <= 3 ? "Nobody else in this window." : "Nobody else yet."}</li>}
          </ol>
        </>
      )}
    </Surface>
  );
}

function Repositories({ onExplain }: { onExplain: () => void }) {
  const { data: boards } = useSuspenseQuery(boardsQuery());
  const [all, setAll] = useState(false);
  const filled = boards.boards.filter((b) => b.rows.length > 0);
  const empty = boards.boards.filter((b) => b.rows.length === 0);
  if (filled.length === 0) return <Nothing title="No boards yet." words="They are written once the first night’s repositories are read." />;
  const longest = Math.max(...filled.map((b) => b.rows.length));
  const rows = all ? longest : REPO_ROWS;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-title">Repositories, by what their history shows</h2>
        <p className="m-0 max-w-3xl type-description text-pretty">
          The people boards count {many(boards.from, "repository", "repositories")}; here {boards.from === 1 ? "it is" : "they are"} ranked by what commitscape measures in {boards.from === 1 ? "its" : "their"} history. Updated {date(boards.builtAt)}.
          {empty.length > 0 && ` No repository qualifies for ${empty.map((b) => `“${b.title}”`).join(" or ")} yet, so ${empty.length === 1 ? "it is" : "they are"} left out.`}{" "}
          <button type="button" onClick={onExplain} className="plain-button inline-link">
            How these boards work
          </button>
        </p>
      </div>
      <div className="grid gap-gutter md:grid-cols-2">
        {filled.map((b, i) => (
          <RepoBoard key={b.id} board={b} rows={rows} wide={filled.length % 2 === 1 && i === filled.length - 1} />
        ))}
      </div>
      {longest > REPO_ROWS && (
        <div className="flex justify-center">
          <Button label={all ? `Show the top ${REPO_ROWS}` : "Show every repository"} variant="secondary" size="sm" icon={<Icon icon={ChevronDown} size="sm" className={all ? "rotate-180" : ""} />} onClick={() => setAll(!all)} />
        </div>
      )}
    </div>
  );
}

function RepoBoard({ board, rows, wide }: { board: Board; rows: number; wide: boolean }) {
  const lower = board.id === "answers";
  const values = board.rows.map((r) => r.value);
  const best = lower ? Math.min(...values) : Math.max(...values);
  const width = (v: number) => (lower ? best / Math.max(v, 0.001) : v / Math.max(best, 0.001));
  return (
    <Surface as="section" aria-label={board.title} id={board.id} className={`grid min-w-0 scroll-mt-(--chrome-top) grid-cols-1 grid-rows-[auto_1fr] overflow-hidden md:row-span-2 md:grid-rows-subgrid md:gap-y-0 ${wide ? "md:col-span-2" : ""}`}>
      <header className="flex flex-col gap-1 px-5 pt-5 pb-3">
        <h2 className="m-0 type-panel">{board.title}</h2>
        <p className="m-0 type-description">{board.how}</p>
      </header>
      <ol className="m-0 flex flex-1 list-none flex-col border-t border-line p-0">
        {board.rows.slice(0, rows).map((r, i) => (
          <li key={`${r.owner}/${r.name}`} className="border-b border-line last:border-b-0">
            <Link to="/gh/$owner/$repo" params={{ owner: r.owner, repo: r.name }} className="group row-hover flex items-center gap-3 px-5 py-2 text-primary no-underline" style={{ minHeight: REPO_ROW_HEIGHT }}>
              <span className={`grid size-6 flex-none place-items-center rounded-full type-micro font-bold tnum ${i < 3 ? "text-on-medal" : "text-secondary"}`} style={i < 3 ? { background: MEDAL[i] } : undefined}>
                <span className="sr-only">Place </span>
                {i + 1}
              </span>
              <Face login={r.owner} name={r.owner} size={32} shape="rounded" decorative />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="type-ui font-medium [overflow-wrap:anywhere] group-hover:underline">
                    <span className="text-secondary">{r.owner}/</span>
                    {r.name}
                  </span>
                  <span className="flex-none type-ui font-semibold tnum">{r.shown}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="flex flex-none items-center gap-2 type-caption">
                    {r.language && <span>{r.language}</span>}
                    {r.stars > 0 && <Stars n={r.stars} />}
                  </span>
                  <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, width(r.value) * 100)}%`, opacity: i === 0 ? 1 : 0.55 }} />
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
        {board.rows.length < rows && <li className="flex flex-1 items-center justify-center px-5 py-3 type-caption">No other repository qualifies.</li>}
      </ol>
    </Surface>
  );
}
