import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Pagination } from "@astryxdesign/core/Pagination";
import { useQuery } from "@tanstack/react-query";
import type { PullState } from "@commitscape/data";
import { pullAskOf, pullFilterOf, pullReviewFilterOf, pullSizeFilterOf, pullSortOf, pullStatsAskOf } from "../git/ask";
import { useGit } from "../git/source";
import { Explain } from "../explain";
import { grouped, many, WINDOW_WORDS } from "../format";
import { Quiet } from "../kit/primitives";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { Nothing } from "../motion/Nothing";
import { ChartsSkeleton, MergeBands, ReviewerLoad, Throughput } from "../pulls/Charts";
import { PullDetail } from "../pulls/Detail";
import { PullTabs, PullToolbar, type Chosen } from "../pulls/Filters";
import { spanDates, TAB_WORDS } from "../pulls/model";
import { labelsQuery, listQuery, statsQuery } from "../pulls/queries";
import { PullItem, RowsSkeleton } from "../pulls/Rows";
import { Summary, SummarySkeleton } from "../pulls/Summary";
import { NoMatch, ScreenFrame } from "./kit";
import type { ScreenProps } from "./props";

/** The repository's pull requests: what they add up to over the Window, how they flow, the list with its filters, and one pull request at a time in its own view. */
export function PullsScreen({ meta, route, go }: ScreenProps) {
  return route.pr !== undefined ? <PullDetail number={route.pr} route={route} go={go} /> : <PullList meta={meta} route={route} go={go} />;
}

function windowWords(route: ScreenProps["route"], window: string): string {
  if (route.from !== undefined || route.to !== undefined) return "the dates chosen";
  return WINDOW_WORDS[window] ?? window;
}

function PullList({ meta, route, go }: Pick<ScreenProps, "meta" | "route" | "go">) {
  const git = useGit();
  const ask = pullAskOf(route, meta.window);
  const stats = useQuery(statsQuery(git, pullStatsAskOf(route, meta.window)));
  const list = useQuery(listQuery(git, ask));
  const labels = useQuery(labelsQuery(git));
  const tab = pullFilterOf(route.state);
  const chosen: Chosen = {
    author: route.author,
    label: route.label,
    size: pullSizeFilterOf(route.size),
    review: pullReviewFilterOf(route.review),
    draft: route.draft === "yes" || route.draft === "no" ? route.draft : undefined,
    stale: route.stale === "1",
    sort: pullSortOf(route.by) ?? "default",
    q: route.q ?? "",
  };
  const filtered = !!(chosen.author || chosen.label || chosen.size || chosen.review || chosen.draft || chosen.stale || chosen.q);
  const change = (patch: Partial<Record<keyof Chosen, string | boolean | undefined>>) =>
    go(
      {
        page: undefined,
        ...("author" in patch ? { author: patch.author as string | undefined } : {}),
        ...("label" in patch ? { label: patch.label as string | undefined } : {}),
        ...("size" in patch ? { size: patch.size as string | undefined } : {}),
        ...("review" in patch ? { review: patch.review as string | undefined } : {}),
        ...("draft" in patch ? { draft: patch.draft as string | undefined } : {}),
        ...("stale" in patch ? { stale: patch.stale ? "1" : undefined } : {}),
        ...("sort" in patch ? { by: patch.sort === "default" || patch.sort === "" ? undefined : (patch.sort as string | undefined) } : {}),
        ...("q" in patch ? { q: patch.q as string | undefined } : {}),
      },
      true,
    );
  const clear = () => go({ author: undefined, label: undefined, size: undefined, review: undefined, draft: undefined, stale: undefined, q: undefined, page: undefined }, true);
  const data = list.data;
  const summary = stats.data;
  const window = route.window ?? meta.window;
  const anchor = data?.span?.until ?? summary?.span.until ?? 0;
  const hrefOf = (number: number) => git.href({ ...route, pr: number, tab: undefined });
  const numbered = /(^|\s)#\d/.test(chosen.q);
  const caption = (state: PullState): string => {
    if (!data?.span) return "";
    if (numbered) return "Searching by number: every state, whenever it was opened";
    if (state === "open") return "Open now, however long ago they were opened";
    return `${state === "merged" ? "Merged" : "Closed without merging"} in the Window, ${spanDates(data.span)}`;
  };

  return (
    <ScreenFrame stale={stats.isPlaceholderData || list.isPlaceholderData}>
      <section aria-label={`What the pull requests add up to over ${windowWords(route, window)}`} className="flex flex-col gap-3">
        <p className="m-0 min-h-[1.5em] max-w-prose type-description text-pretty" aria-live="polite">
          {summary ? (
            <>
              Over {windowWords(route, window)}, {spanDates(summary.span).replace(/^All time, to/, "to")}.{" "}
              {summary.total === 0 ? "No pull request has been read for this repository yet." : ""}
              {summary.total > 0 && summary.unread === summary.total ? "Their details are still being read from GitHub, so closing dates are taken from each last update for now." : ""}
              {summary.unread * 100 >= summary.total && summary.unread < summary.total ? `${many(summary.unread, "pull request", "pull requests")} not read in full yet: ${summary.unread === 1 ? "its" : "their"} closing date is taken from the last update.` : ""}
            </>
          ) : stats.isError ? (
            "The numbers could not be worked out just now."
          ) : (
            " "
          )}
        </p>
        {stats.isError && !summary ? (
          <div className="flex flex-col items-center gap-3 surface px-5 py-8 text-center">
            <p className="m-0 type-description">{stats.error instanceof Error ? stats.error.message : "The numbers could not be read."}</p>
            <Button label="Try again" variant="secondary" onClick={() => void stats.refetch()} />
          </div>
        ) : summary ? (
          <Summary stats={summary} />
        ) : (
          <SummarySkeleton />
        )}
      </section>
      <div className="grid items-stretch gap-gutter md:grid-cols-2 xl:grid-cols-12">
        {summary ? (
          <>
            <Throughput stats={summary} />
            <MergeBands stats={summary} />
            <ReviewerLoad stats={summary} />
          </>
        ) : stats.isError ? null : (
          <ChartsSkeleton />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <PullTabs tab={tab} counts={data?.counts} onTab={(t) => go({ state: t === "open" ? undefined : t, by: undefined, page: undefined }, true)} />
        <PullToolbar tab={tab} chosen={chosen} labels={labels.data ?? []} filtered={filtered} onChange={change} onClear={clear} />
      </div>
      <section aria-label="Pull requests" className="flex min-w-0 flex-col surface">
        <p className="m-0 flex min-h-11 flex-wrap items-center gap-x-2 px-4 py-3 type-caption tnum sm:px-5" role="status">
          {data ? (
            <>
              <span>
                <strong className="font-semibold text-primary">{many(data.total, "pull request", "pull requests")}</strong> {filtered ? "match" : "in the list"}
              </span>
              <span aria-hidden className="max-sm:hidden">·</span>
              <span>{caption(tab)}</span>
            </>
          ) : (
            " "
          )}
        </p>
        <div id="pull-list" role="tabpanel" aria-label={`${TAB_WORDS[tab]} pull requests`} className="border-t border-separator" aria-busy={list.isFetching || undefined}>
          {list.isError && !data ? (
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <p className="m-0 type-description">{list.error instanceof Error ? list.error.message : "The pull requests could not be read."}</p>
              <Button label="Try again" variant="secondary" size="sm" onClick={() => void list.refetch()} />
            </div>
          ) : !data ? (
            <RowsSkeleton />
          ) : data.rows.length === 0 ? (
            !data.read && data.counts.open + data.counts.merged + data.counts.closed === 0 ? (
              <Quiet>This repository's pull requests have not been read from GitHub yet; they are read a little after a Build.</Quiet>
            ) : filtered ? (
              <NoMatch what="pull requests" query={chosen.q.trim()} onClear={clear} />
            ) : (
              <Nothing
                compact
                title={tab === "open" ? "Nothing is open" : `No pull request was ${tab === "merged" ? "merged" : "closed without merging"} in the Window`}
                action={tab !== "open" && window !== "all" ? <Button label="Show all time" variant="secondary" size="sm" onClick={() => go({ window: "all", from: undefined, to: undefined, page: undefined })} /> : undefined}
              />
            )
          ) : (
            <ol className="m-0 list-none p-0" aria-label={`${TAB_WORDS[tab]} pull requests, page ${data.page} of ${data.pages}`}>
              {data.rows.map((row) => (
                <PullItem key={row.number} row={row} anchor={anchor} href={hrefOf(row.number)} onAuthor={(author) => go({ author, page: undefined }, true)} />
              ))}
            </ol>
          )}
        </div>
        {data && data.pages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator px-4 py-3">
            <span className="type-caption tnum">
              {grouped((data.page - 1) * 30 + 1)} to {grouped(Math.min(data.total, data.page * 30))} of {grouped(data.total)}
            </span>
            <Pagination page={data.page} totalPages={data.pages} onChange={(page) => go({ page: page <= 1 ? undefined : page }, false)} variant="input" size="sm" aria-label="Pages of pull requests" />
          </div>
        )}
      </section>
      <Explain>
        Pull requests are read from GitHub and kept on the Site; a webhook keeps them current. The Window sets the numbers and charts above, and the merged and closed tabs: a pull request counts when it was opened, merged or closed inside it. Open ones are the ones open now, of any age. Time to
        merge runs from opening to merging. The first review is the first from anyone but the author, and reviews are read up to 40 per pull request. Sizes count lines added and removed together: XS under 10, S under 50, M under 250, L under 1,000, XL more. Idle means no update on GitHub for 90 days,
        which a comment or a label also counts as.
      </Explain>
    </ScreenFrame>
  );
}

/** The Pull requests screen while its numbers and list are fetched: the strip, the charts and the rows at the size they will be. */
export function PullsSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <section className="flex flex-col gap-3">
        <p className="m-0 min-h-[2.8em]">{" "}</p>
        <SummarySkeleton />
      </section>
      <div className="grid items-stretch gap-gutter md:grid-cols-2 xl:grid-cols-12">
        <ChartsSkeleton />
      </div>
      <div className="flex flex-col gap-3" aria-hidden>
        <Skeleton height={44} radius={1} />
        <Toolbar label="Loading the filters">
          <ToolbarField kind="search">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <ToolbarField kind="person">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <ToolbarField kind="option">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <Skeleton height={32} width={132} radius={2} />
          <ToolbarField kind="order">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
        </Toolbar>
      </div>
      <section className="flex min-w-0 flex-col surface" aria-busy="true">
        <p className="m-0 min-h-11">{" "}</p>
        <div className="border-t border-separator">
          <RowsSkeleton />
        </div>
      </section>
    </ScreenFrame>
  );
}

