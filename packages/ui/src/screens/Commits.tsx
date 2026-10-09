import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { GitMerge } from "lucide-react";
import { UNKNOWN_PERSON, type CommitPage, type CommitQuery, type CommitRow as Row, type PersonRef } from "@commitscape/data";
import { Key } from "../components/Key";
import { Name } from "../components/Name";
import { useSource } from "../data";
import { Explain } from "../explain";
import { compact, date, grouped, many, WINDOW_WORDS } from "../format";
import { useLeading } from "../leading";
import { Failed, ScreenFrame } from "./kit";
import type { ScreenProps } from "./props";

export const ROW = 52;
export const SHOWN = 13;
const MORE_WITHIN = 6 * ROW;
const DAY = 86_400;
const SPANS: Record<string, number> = { "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };
const GRID = "grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3 md:grid-cols-[6.5rem_11rem_minmax(0,1fr)_7.5rem_5rem]";

const KIND_COLOURS: Record<string, string> = {
  features: "green",
  fixes: "red",
  docs: "blue",
  refactors: "orange",
  tests: "purple",
  performance: "yellow",
  style: "gray",
  "build and CI": "teal",
  chores: "gray",
  reverts: "pink",
};

/** Every commit, newest first, a page at a time, found by words, person, kind and the Window. */
export function Commits({ meta, route, params, go }: ScreenProps) {
  const source = useSource();
  const [asked, setAsked] = useState(route.q ?? "");
  const [kind, setKind] = useState<string | null>(null);
  const range = rangeOf(params, meta.anchor);
  const query: CommitQuery = { q: asked.trim() || undefined, person: route.person, kind: kind === null ? undefined : Number(kind), from: range.from, to: range.to };
  const pages = useInfiniteQuery({
    queryKey: ["commits", source.id, query],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => source.commits(query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: CommitPage) => last.next ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const onPerson = useCallback((id: number) => go({ screen: "people", id }), [go]);
  const box = useRef<HTMLDivElement>(null);
  const asking = JSON.stringify(query);
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [asking]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = useCallback(
    (el: HTMLDivElement) => {
      if (hasNextPage && !isFetchingNextPage && el.scrollTop + el.clientHeight > el.scrollHeight - MORE_WITHIN) void fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );
  if (pages.error && !pages.data) return <Failed words={pages.error.message} />;
  const first = pages.data?.pages[0];
  if (!pages.data || !first) return <CommitsLoading />;
  const rows = pages.data.pages.flatMap((p) => p.rows);
  const people: Record<string, PersonRef> = Object.assign({}, ...pages.data.pages.map((p) => p.people));
  const span = route.from !== undefined || route.to !== undefined ? "the dates chosen" : (WINDOW_WORDS[String(params.window)] ?? "all time");
  return (
    <ScreenFrame>
      <section aria-label="Commits" className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 px-4 pt-5 pb-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="m-0 type-panel">Commits</h2>
            <p className="m-0 type-caption tnum">
              {grouped(first.total ?? rows.length)} of {many(first.all, "commit", "commits")}, over {span}. Newest first.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchBox initial={route.q ?? ""} onAsk={setAsked} go={go} />
            <Selector label="Kind" isLabelHidden size="md" hasClear placeholder="Every kind" value={kind} onChange={(v: string | null) => setKind(v)} options={first.kinds.map((k, i) => ({ value: String(i), label: k }))} width={200} />
          </div>
          {route.folder && <p className="m-0 type-micro">The folder filter is left out here: the Commit List does not keep each commit's files.</p>}
        </div>
        <div className={`${GRID} border-t border-line px-4 py-2 text-xs font-medium text-secondary sm:px-5`} aria-hidden>
          <span className="hidden md:block">When</span>
          <span className="hidden md:block">Who</span>
          <span>What</span>
          <span className="hidden text-end md:block">Size</span>
          <span className="text-end">Commit</span>
        </div>
        <div
          ref={box}
          className={`relative overflow-y-auto border-t border-line transition-opacity duration-(--duration-fast) ${pages.isPlaceholderData ? "opacity-60" : ""}`}
          style={{ height: SHOWN * ROW }}
          onScroll={(e) => more(e.currentTarget)}
          role="list"
          aria-label="Commits found"
          aria-busy={pages.isFetching || undefined}
        >
          {rows.map((r) => (
            <CommitRow key={r.sha} row={r} who={people[r.personId]} kinds={first.kinds} link={first.link} onPerson={onPerson} />
          ))}
          {isFetchingNextPage && Array.from({ length: 3 }, (_, k) => <RowSkeleton key={k} k={k} />)}
          {hasNextPage && !isFetchingNextPage && (
            <div className="flex justify-center py-3">
              <button type="button" className="cursor-pointer rounded-md border border-line bg-surface px-3 py-1 type-caption hover:bg-sunken" onClick={() => void fetchNextPage()}>
                Show more
              </button>
            </div>
          )}
          {rows.length === 0 && <p className="absolute inset-x-0 top-10 m-0 text-center type-caption">No commit matches. Try fewer words, or a longer Window.</p>}
        </div>
      </section>
      <Explain>
        Every word typed must appear in a commit's subject line, or in the name or GitHub login of who made it, in any case. The kind and the Window narrow it further; the folder filter cannot, as the list keeps no files.
        They come fifty at a time, newest first, and more load as you scroll.
        Lines are what the commit added and removed{first.lines ? "" : ", once they are counted"}.
      </Explain>
    </ScreenFrame>
  );
}

function rangeOf(params: ScreenProps["params"], anchor: number): { from?: number; to?: number } {
  if (params.from !== undefined || params.to !== undefined) {
    return { from: params.from === undefined ? undefined : Number(params.from), to: params.to === undefined ? undefined : Number(params.to) };
  }
  const span = SPANS[String(params.window)];
  return span === undefined ? {} : { from: anchor - span, to: anchor };
}

function SearchBox({ initial, onAsk, go }: { initial: string; onAsk: (text: string) => void; go: ScreenProps["go"] }) {
  const [text, setText] = useState(initial);
  const ask = useLeading(onAsk, 150);
  return (
    <div data-commit-search className="relative min-w-0 flex-1">
      <TextInput
        label="Search commits"
        isLabelHidden
        value={text}
        placeholder="Search by message or person"
        onChange={(v) => {
          setText(v);
          ask(v);
          go({ q: v || undefined }, true);
        }}
        hasClear
        width="100%"
      />
      {!text && (
        <span className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex">
          <Key keys="/" />
        </span>
      )}
    </div>
  );
}

const CommitRow = memo(function CommitRow({ row, who, kinds, link, onPerson }: { row: Row; who: PersonRef | undefined; kinds: string[]; link: string | null; onPerson: (id: number) => void }) {
  const kind = kinds[row.kind];
  const when = row.at + row.offset * 60;
  return (
    <div role="listitem" data-commit className={`${GRID} border-b border-line px-4 text-sm transition-colors hover:bg-sunken sm:px-5`} style={{ height: ROW }}>
      <span className="hidden text-xs text-secondary tnum md:block">{date(when)}</span>
      <span className="hidden min-w-0 md:block">{who && who.id !== UNKNOWN_PERSON ? <Name p={who} onOpen={onPerson} /> : <Name p={who} />}</span>
      <span className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {row.merge && <GitMerge size={14} className="flex-none text-secondary" aria-label="merge" />}
          {kind && kind !== "other" && (
            <span className={`hidden flex-none rounded-full px-2 py-px text-xs font-medium sm:inline ${KIND_TONE[KIND_COLOURS[kind] ?? "gray"]}`}>{kind}</span>
          )}
          <span className="truncate" title={row.subject}>
            {row.subject || <span className="text-secondary">(no subject)</span>}
          </span>
        </span>
        <span className="truncate type-micro md:hidden">
          {who?.name ?? "someone unknown"} · {date(when)}
        </span>
      </span>
      <span className="hidden text-end text-xs whitespace-nowrap text-secondary tnum md:block">
        {row.added !== null ? (
          <>
            <span className="text-added">+{compact(row.added)}</span> <span className="text-removed">−{compact(row.removed ?? 0)}</span>
          </>
        ) : (
          many(row.files, "file", "files")
        )}
      </span>
      {link ? (
        <a className="text-end font-mono text-xs text-secondary no-underline hover:text-brand" href={`${link}${row.sha}`} target="_blank" rel="noreferrer noopener" title="Open on GitHub">
          {row.sha.slice(0, 7)}
        </a>
      ) : (
        <code className="text-end font-mono text-xs text-secondary">{row.sha.slice(0, 7)}</code>
      )}
    </div>
  );
});

function RowSkeleton({ k }: { k: number }) {
  return (
    <div className={`${GRID} border-b border-line px-4 sm:px-5`} style={{ height: ROW }}>
      <span className="hidden md:block">
        <Skeleton height={12} width="80%" radius={1} index={k} />
      </span>
      <span className="hidden md:block">
        <Skeleton height={14} width="70%" radius={1} index={k} />
      </span>
      <Skeleton height={14} width={`${55 + ((k * 37) % 40)}%`} radius={1} index={k} />
      <span className="hidden md:block">
        <Skeleton height={12} width="60%" radius={1} index={k} />
      </span>
      <Skeleton height={12} width="90%" radius={1} index={k} />
    </div>
  );
}

const KIND_TONE: Record<string, string> = {
  green: "bg-green-subtle text-green-vivid",
  red: "bg-red-subtle text-red-vivid",
  blue: "bg-blue-subtle text-blue-vivid",
  purple: "bg-purple-subtle text-purple-vivid",
  teal: "bg-teal-subtle text-teal-vivid",
  orange: "bg-orange-subtle text-orange-vivid",
  yellow: "bg-yellow-subtle text-yellow-vivid",
  pink: "bg-pink-subtle text-pink-vivid",
  gray: "bg-sunken text-secondary",
};

/** The Commits screen while its list is fetched, the same size as the screen. */
export function CommitsLoading() {
  return (
    <ScreenFrame label="Loading">
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface" aria-busy="true">
        <div className="flex flex-col gap-3 px-4 pt-5 pb-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="m-0 type-panel">Commits</h2>
            <Skeleton height={14} width={240} radius={1} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Skeleton height={36} index={1} />
            </div>
            <div className="w-[200px]">
              <Skeleton height={36} index={2} />
            </div>
          </div>
        </div>
        <div className="h-[33px] border-t border-line" />
        <div className="flex flex-col border-t border-line" style={{ height: SHOWN * ROW }}>
          {Array.from({ length: SHOWN }, (_, k) => (
            <RowSkeleton key={k} k={k} />
          ))}
        </div>
      </section>
    </ScreenFrame>
  );
}
