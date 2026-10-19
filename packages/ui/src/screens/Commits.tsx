import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { CalendarRange, Clock, FileCode, FolderTree, GitMerge, Search, Users, X } from "lucide-react";
import { UNKNOWN_PERSON, type CommitPage, type CommitQuery, type CommitRow as Row, type People, type PersonRef } from "@commitscape/data";
import { Face } from "../components/Face";
import { Key } from "../components/Key";
import { Name } from "../components/Name";
import { useCounting, useLazyData, useSource } from "../data";
import { PullChip } from "../git/PullChip";
import { useGitOptional } from "../git/source";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { compact, date, day, grouped, many, WINDOW_WORDS } from "../format";
import { Pill } from "../kit/primitives";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { Counting } from "../kit/pending";
import { useLeading } from "../leading";
import { useWindowRows } from "../reading/rows";
import { PlainHead, Spacer } from "../reading/table";
import { useWidth } from "../reading/width";
import { NO_DRILL, type Route } from "../route";
import { EmptyWindow, Failed, NoMatch, ScreenFrame } from "./kit";
import { useReload } from "./reload";
import { openers, type ScreenProps } from "./props";

const ROW = 52;
const ROW_PHONE = 80;
const NARROW = 640;
const DAY = 86_400;
const SPANS: Record<string, number> = { "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };
const AHEAD = 24;
const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const hhmm = (at: number, offset: number) => {
  const local = (((at + offset * 60) % DAY) + DAY) % DAY;
  return `${String(Math.floor(local / 3600)).padStart(2, "0")}:${String(Math.floor((local % 3600) / 60)).padStart(2, "0")}`;
};

/** Every commit, newest first, as a table: found by words, person and kind, narrowed by the Window and by what a chart was clicked for, a page at a time from where the last one ended. */
export function Commits({ meta, route, params, go }: ScreenProps) {
  const source = useSource();
  const reload = useReload();
  const [boxRef, width] = useWidth<HTMLElement>();
  const roomy = !(width > 0 && width < NARROW);
  const [asked, setAsked] = useState(route.q ?? "");
  const range = rangeOf(params, meta.anchor);
  const query: CommitQuery = {
    q: asked.trim() || undefined,
    person: route.who ?? route.person,
    kind: route.kind === undefined ? undefined : Number(route.kind),
    from: range.from,
    to: range.to,
    since: route.since,
    until: route.until,
    weekday: route.weekday,
    hour: route.hour,
    merges: route.merges === "out" ? 0 : undefined,
    under: route.under,
  };
  const pages = useInfiniteQuery({
    queryKey: ["commits", source.id, query],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => source.commits(query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: CommitPage) => last.next ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const git = useGitOptional();
  const open = openers(go, route);
  const onPerson = useCallback((id: number) => go({ screen: "people", id, tab: undefined }), [go]);
  const onPull = useCallback((pr: number) => go({ screen: "pulls", pr, id: undefined, ...NO_DRILL, q: undefined }), [go]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const rows = pages.data?.pages.flatMap((p) => p.rows) ?? [];
  const asking = JSON.stringify(query);
  const [bodyRef, slice] = useWindowRows(rows.length, roomy ? ROW : ROW_PHONE, asking);
  const near = slice.to >= rows.length - AHEAD;
  useEffect(() => {
    if (near && hasNextPage && !isFetchingNextPage && !pages.isPlaceholderData) void fetchNextPage();
  }, [near, hasNextPage, isFetchingNextPage, pages.isPlaceholderData, fetchNextPage]);
  if (pages.error && !pages.data) return <Failed words={pages.error.message} retry={reload} />;
  const first = pages.data?.pages[0];
  if (!pages.data || !first) return <CommitsLoading />;
  const people: Record<string, PersonRef> = Object.assign({}, ...pages.data.pages.map((p) => p.people));
  const span = route.since !== undefined || route.until !== undefined ? "the days chosen" : route.from !== undefined || route.to !== undefined ? "the dates chosen" : (WINDOW_WORDS[String(params.window)] ?? "all time");
  const filtered =
    asked.trim() !== "" ||
    route.who !== undefined ||
    route.person !== undefined ||
    route.kind !== undefined ||
    route.since !== undefined ||
    route.until !== undefined ||
    route.weekday !== undefined ||
    route.hour !== undefined ||
    route.merges === "out" ||
    !!route.under;
  const total = first.total ?? rows.length;
  const clear = () => {
    setAsked("");
    go({ ...NO_DRILL, person: undefined, q: undefined }, true);
  };
  return (
    <ScreenFrame>
      <CommitFilters route={route} params={params} first={first} people={people} onAsk={setAsked} go={go} filtered={filtered} onClear={clear} />
      <DrillChips route={route} go={go} onCode={git ? (path) => open.code(path) : undefined} />
      {route.folder && <p className="m-0 type-caption">The folder filter is left out here: the Commit List does not keep each commit’s files.</p>}
      <section
        ref={boxRef}
        aria-label="Commits"
        aria-busy={pages.isFetching || undefined}
        className={`@container min-w-0 overflow-clip surface transition-opacity duration-(--duration-instant) ${pages.isPlaceholderData ? "opacity-60" : ""}`}
      >
        <p role="status" className="m-0 px-4 py-3 type-caption tnum sm:px-5">
          <strong className="font-semibold text-primary">{filtered ? `${grouped(total)} of ${many(first.all, "commit", "commits")}` : many(total, "commit", "commits")}</strong> over {span}
          {route.merges === "out" ? ", merges left out" : ", merges included"}
        </p>
        <table className="w-full table-fixed border-separate border-spacing-0 text-start">
          <caption className="sr-only">Commits, newest first</caption>
          <Head />
          <tbody ref={bodyRef} className="[&_td]:border-b [&_td]:border-separator">
            <Spacer height={slice.before} />
            {rows.slice(slice.from, slice.to).map((r) => (
              <CommitRow key={r.sha} row={r} who={people[r.personId]} kinds={first.kinds} link={first.link} onPerson={onPerson} onPull={git ? onPull : undefined} />
            ))}
            {isFetchingNextPage && Array.from({ length: 3 }, (_, k) => <SkeletonRow key={k} k={k} />)}
            <Spacer height={slice.after} />
          </tbody>
        </table>
        {rows.length === 0 &&
          (filtered ? (
            <NoMatch what="commits" query={asked.trim()} words="Try fewer words, or a longer Window." onClear={clear} />
          ) : (
            <EmptyWindow
              window={range.from !== undefined || range.to !== undefined ? (route.from !== undefined || route.to !== undefined ? "range" : String(params.window)) : String(params.window ?? "all")}
              what="Choose a longer Window to see its commits."
              go={go}
            />
          ))}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator px-4 py-3 sm:px-5">
            <p role="status" className="m-0 type-caption tnum">
              {hasNextPage ? `${grouped(rows.length)} of ${grouped(total)} loaded` : rows.length === 1 ? "That is the only commit." : `That is all ${grouped(rows.length)} commits.`}
            </p>
            {hasNextPage && <Button label="Show 50 more" variant="secondary" size="sm" isLoading={isFetchingNextPage} onClick={() => void fetchNextPage()} />}
          </div>
        )}
      </section>
      <Explain>
        Every word typed must appear in a commit’s subject line, or in the name or GitHub login of who made it, in any case. The kind, the person and the Window narrow it further; the folder filter cannot, as the list
        keeps no files. They come fifty at a time, newest first, and more load as you scroll. Lines are what the commit added and removed{first.lines ? "" : ", once they are counted"}. The time is the hour on the
        author’s own clock.
      </Explain>
    </ScreenFrame>
  );
}

function Head() {
  return (
    <thead>
      <tr>
        <PlainHead className="hidden w-32 ps-5 @min-[40rem]:table-cell">When</PlainHead>
        <PlainHead className="hidden w-52 @min-[40rem]:table-cell">Who</PlainHead>
        <PlainHead className="ps-4 @min-[40rem]:ps-3">Commit</PlainHead>
        <PlainHead align="end" className="hidden w-28 @min-[56rem]:table-cell">
          Size
        </PlainHead>
        <PlainHead align="end" className="w-24 pe-4 sm:pe-5">
          SHA
        </PlainHead>
      </tr>
    </thead>
  );
}

function CommitFilters({
  route,
  params,
  first,
  people,
  onAsk,
  go,
  filtered,
  onClear,
}: {
  route: Route;
  params: ScreenProps["params"];
  first: CommitPage;
  people: Record<string, PersonRef>;
  onAsk: (text: string) => void;
  go: ScreenProps["go"];
  filtered: boolean;
  onClear: () => void;
}) {
  const who = route.who ?? route.person;
  const everyone = useLazyData<People>("/api/people", params);
  const listed = (everyone.data?.people ?? []).slice(0, 300).map((r) => ({ id: r.person.id, name: r.person.name, login: r.person.login, commits: r.commits }));
  const chosen = who === undefined ? undefined : people[String(who)];
  if (who !== undefined && !listed.some((p) => p.id === who) && chosen) listed.unshift({ id: chosen.id, name: chosen.name, login: chosen.login, commits: 0 });
  return (
    <Toolbar label="Filter the commits">
      <ToolbarField kind="search">
        <SearchBox initial={route.q ?? ""} onAsk={onAsk} go={go} />
      </ToolbarField>
      <ToolbarField kind="person">
        <Selector
          label="Person"
          isLabelHidden
          placeholder="Everyone"
          hasClear
          hasSearch
          searchPlaceholder="Find a person"
          emptySearchText="No one among the 300 with most commits. Search the commits by name instead."
          width="100%"
          startIcon={<Users size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />}
          value={who === undefined ? null : String(who)}
          onChange={(v: string | null) => go({ who: v === null ? undefined : Number(v), person: undefined }, true)}
          options={listed.map((p) => ({
            value: String(p.id),
            label: p.name,
            description: p.commits > 0 ? many(p.commits, "commit", "commits") : undefined,
            icon: <Face login={p.login} name={p.name} size={20} decorative />,
          }))}
        />
      </ToolbarField>
      <ToolbarField kind="option">
        <Selector
          label="Kind"
          isLabelHidden
          hasClear
          placeholder="Every kind"
          width="100%"
          value={route.kind ?? null}
          onChange={(v: string | null) => go({ kind: v ?? undefined }, true)}
          options={first.kinds.map((k, i) => ({ value: String(i), label: k }))}
        />
      </ToolbarField>
      <Switch size="sm" label="Hide merges" value={route.merges === "out"} onChange={(on: boolean) => go({ merges: on ? "out" : undefined }, true)} />
      {filtered && <Button label="Clear filters" variant="ghost" size="sm" onClick={onClear} />}
    </Toolbar>
  );
}

function SearchBox({ initial, onAsk, go }: { initial: string; onAsk: (text: string) => void; go: ScreenProps["go"] }) {
  const [text, setText] = useState(initial);
  const ask = useLeading(onAsk, 150);
  return (
    <div data-commit-search className="relative min-w-0">
      <TextInput
        label="Search commits"
        isLabelHidden
        value={text}
        placeholder="Search by message or person"
        startIcon={<Search size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />}
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

function Chip({ icon, children, onClear, label }: { icon: ReactNode; children: ReactNode; onClear: () => void; label: string }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-sunken ps-2.5 pe-1 type-caption font-medium text-primary">
      <span className="flex flex-none text-secondary">{icon}</span>
      <span className="truncate">{children}</span>
      <button type="button" aria-label={label} title={label} onClick={onClear} className="plain-button hit grid size-6 flex-none place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary">
        <X size={ICON.xs} aria-hidden />
      </button>
    </span>
  );
}

function DrillChips({ route, go, onCode }: { route: Route; go: ScreenProps["go"]; onCode?: ((path: string) => void) | undefined }) {
  const ranged = route.since !== undefined || route.until !== undefined;
  const timed = route.weekday !== undefined || route.hour !== undefined;
  if (!ranged && !timed && !route.under) return null;
  const days = ranged
    ? route.since === route.until && route.since !== undefined
      ? day(route.since)
      : `${route.since === undefined ? "the start" : day(route.since)} to ${route.until === undefined ? "now" : day(route.until)}`
    : null;
  const when = [route.weekday !== undefined ? WEEKDAY_NAMES[route.weekday] : route.hour !== undefined ? "Every day" : null, route.hour !== undefined ? `${hh(route.hour)} to ${hh(route.hour + 1)}` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters from the chart clicked">
      {days && (
        <Chip icon={<CalendarRange size={ICON.xs} aria-hidden />} label="Show every day of the Window" onClear={() => go({ since: undefined, until: undefined }, true)}>
          {days}
        </Chip>
      )}
      {timed && (
        <Chip icon={<Clock size={ICON.xs} aria-hidden />} label="Show every hour" onClear={() => go({ weekday: undefined, hour: undefined }, true)}>
          {when}, on the author’s clock
        </Chip>
      )}
      {route.under && (
        <>
          <Chip icon={<FolderTree size={ICON.xs} aria-hidden />} label="Show commits to every file" onClear={() => go({ under: undefined }, true)}>
            Touching <span className="mono">{route.under}</span>
          </Chip>
          {onCode && <Button label="Open it in Code" variant="ghost" size="sm" icon={<FileCode size={ICON.sm} aria-hidden />} onClick={() => onCode(route.under ?? "/")} />}
        </>
      )}
    </div>
  );
}

function rangeOf(params: ScreenProps["params"], anchor: number): { from?: number; to?: number } {
  if (params.from !== undefined || params.to !== undefined) {
    return { from: params.from === undefined ? undefined : Number(params.from), to: params.to === undefined ? undefined : Number(params.to) };
  }
  const span = SPANS[String(params.window)];
  return span === undefined ? {} : { from: anchor - span, to: anchor };
}

const CommitRow = memo(function CommitRow({
  row,
  who,
  kinds,
  link,
  onPerson,
  onPull,
}: {
  row: Row;
  who: PersonRef | undefined;
  kinds: string[];
  link: string | null;
  onPerson: (id: number) => void;
  onPull?: ((pr: number) => void) | undefined;
}) {
  const kind = kinds[row.kind];
  const counting = useCounting();
  const when = row.at + row.offset * 60;
  const short = row.sha.slice(0, 7);
  const text = onPull || link ? row.subject.replace(/\s*\(#\d+\)\s*$/, "") : row.subject;
  return (
    <tr data-commit className="row-hover h-13 @max-[40rem]:h-20">
      <td className="hidden py-0 ps-5 pe-3 @min-[40rem]:table-cell">
        <span className="flex flex-col">
          <span className="type-ui tnum">{date(when)}</span>
          <span className="type-caption tnum" title="The hour on the author’s own clock">
            {hhmm(row.at, row.offset)}
          </span>
        </span>
      </td>
      <td className="hidden px-3 py-0 @min-[40rem]:table-cell">
        <span className="flex min-w-0 type-ui">{who && who.id !== UNKNOWN_PERSON ? <Name p={who} onOpen={onPerson} /> : <Name p={who} />}</span>
      </td>
      <td className="py-0 ps-4 pe-3 @min-[40rem]:ps-3">
        <span className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            {row.merge && (
              <span className="inline-flex flex-none text-secondary" title="A merge commit">
                <GitMerge size={ICON.sm} aria-hidden />
                <span className="sr-only">Merge: </span>
              </span>
            )}
            {kind && kind !== "other" && (
              <span className="hidden flex-none @min-[40rem]:inline-flex">
                <Pill tone="quiet">{kind}</Pill>
              </span>
            )}
            <span className="line-clamp-2 min-w-0 type-ui text-primary">{text || <span className="text-secondary">(no subject)</span>}</span>
            <PullChip subject={row.subject} onOpen={onPull} github={link ? link.replace(/\/commit\/$/, "") : null} />
          </span>
          <span className="truncate type-caption @min-[40rem]:hidden">
            {who?.name ?? "someone unknown"} · {date(when)}{kind && kind !== "other" ? ` · ${kind}` : ""}
          </span>
        </span>
      </td>
      <td className="hidden px-3 py-0 text-end type-caption whitespace-nowrap tnum @min-[56rem]:table-cell">
        {row.added !== null ? (
          <>
            <span className="text-added">+{compact(row.added)}</span> <span className="text-removed">−{compact(row.removed ?? 0)}</span>
          </>
        ) : counting ? (
          <Counting width={60} height={12} />
        ) : (
          many(row.files, "file", "files")
        )}
      </td>
      <td className="py-0 ps-2 pe-4 text-end sm:pe-5">
        {link ? (
          <a
            className="mono hit type-caption text-secondary no-underline hover:text-primary hover:underline hover:underline-offset-4"
            href={`${link}${row.sha}`}
            target="_blank"
            rel="noreferrer noopener"
            title="Open this commit on GitHub"
            aria-label={`Commit ${short}, open on GitHub`}
          >
            {short}
          </a>
        ) : (
          <code className="mono type-caption text-secondary">{short}</code>
        )}
      </td>
    </tr>
  );
});

function SkeletonRow({ k }: { k: number }) {
  return (
    <tr aria-hidden className="h-13 @max-[40rem]:h-20">
      <td className="hidden ps-5 @min-[40rem]:table-cell">
        <Skeleton height={14} width="70%" radius={1} index={k} />
      </td>
      <td className="hidden px-3 @min-[40rem]:table-cell">
        <Skeleton height={14} width="70%" radius={1} index={k} />
      </td>
      <td className="ps-4 pe-3 @min-[40rem]:ps-3">
        <Skeleton height={14} width={`${50 + ((k * 37) % 40)}%`} radius={1} index={k} />
      </td>
      <td className="hidden px-3 @min-[56rem]:table-cell">
        <Skeleton height={13} width="60%" radius={1} index={k} />
      </td>
      <td className="ps-2 pe-4 sm:pe-5">
        <Skeleton height={13} width="90%" radius={1} index={k} />
      </td>
    </tr>
  );
}

/** The Commits screen while its list is fetched: the toolbar, the heading of the table and rows of the height the real ones have. */
export function CommitsLoading() {
  return (
    <ScreenFrame label="Loading">
      <div aria-hidden>
        <Toolbar label="Loading the filters">
          <ToolbarField kind="search">
            <Skeleton height={32} index={1} />
          </ToolbarField>
          <ToolbarField kind="person">
            <Skeleton height={32} index={2} />
          </ToolbarField>
          <ToolbarField kind="option">
            <Skeleton height={32} index={3} />
          </ToolbarField>
          <Skeleton height={20} width={112} index={4} />
        </Toolbar>
      </div>
      <section aria-busy="true" aria-label="Loading the commits" className="@container min-w-0 overflow-clip surface">
        <div className="flex h-10.5 items-center px-4 sm:px-5">
          <Skeleton height={14} width={240} radius={1} />
        </div>
        <table className="w-full table-fixed border-separate border-spacing-0">
          <Head />
          <tbody className="[&_td]:border-b [&_td]:border-separator">
            {Array.from({ length: 14 }, (_, k) => (
              <SkeletonRow key={k} k={k} />
            ))}
          </tbody>
        </table>
      </section>
    </ScreenFrame>
  );
}
