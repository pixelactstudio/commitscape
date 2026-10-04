import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { GitMerge } from "lucide-react";
import type { CommitList } from "@commitscape/data";
import { Key } from "../components/Key";
import { Name } from "../components/Name";
import { useLazyData } from "../data";
import { Explain } from "../explain";
import { compact, date, grouped, many, WINDOW_WORDS } from "../format";
import { useLeading } from "../leading";
import { searcher } from "../searcher";
import { Failed, ScreenFrame } from "./kit";
import type { ScreenProps } from "./props";

export const ROW = 52;
export const SHOWN = 13;
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

/** Every commit, newest first, searched in the browser by words, person, kind and the Window. */
export function Commits({ meta, route, params, go }: ScreenProps) {
  const { data: list, error } = useLazyData<CommitList>("/api/commits", {});
  const [asked, setAsked] = useState(route.q ?? "");
  const [kind, setKind] = useState<string | null>(null);
  const found = useFound(list, {
    text: asked,
    person: route.person,
    kind: kind === null ? undefined : Number(kind),
    range: rangeOf(params, meta.anchor),
  });
  const onPerson = useCallback((id: number) => go({ screen: "people", id }), [go]);
  const [top, setTop] = useState(0);
  if (error) return <Failed words={error} />;
  if (!list) return <CommitsLoading />;
  const span = route.from !== undefined || route.to !== undefined ? "the dates chosen" : (WINDOW_WORDS[String(params.window)] ?? "all time");
  const first = Math.max(0, Math.floor(top / ROW) - 4);
  const last = Math.min(found.rows.length, first + SHOWN + 8);
  const drawn: number[] = [];
  for (let k = first; k < last; k++) drawn.push(found.rows[k] ?? 0);
  return (
    <ScreenFrame>
      <section aria-label="Commits" className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface">
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="m-0 text-[1.02rem] font-semibold tracking-[-0.01em]">Commits</h2>
            <p className="m-0 text-sm text-secondary tnum">
              {grouped(found.rows.length)} of {many(list.ids.length, "commit", "commits")}, over {span}. Newest first.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchBox initial={route.q ?? ""} onAsk={setAsked} go={go} />
            <Selector label="Kind" isLabelHidden size="md" hasClear placeholder="Every kind" value={kind} onChange={(v: string | null) => setKind(v)} options={list.kinds.map((k, i) => ({ value: String(i), label: k }))} width={200} />
          </div>
          {route.folder && <p className="m-0 text-xs text-secondary">The folder filter is left out here: the Commit List does not keep each commit's files.</p>}
        </div>
        <div className={`${GRID} border-t border-line px-4 py-2 text-xs font-medium text-secondary sm:px-5`} aria-hidden>
          <span className="hidden md:block">When</span>
          <span className="hidden md:block">Who</span>
          <span>What</span>
          <span className="hidden text-end md:block">Size</span>
          <span className="text-end">Commit</span>
        </div>
        <div className="relative overflow-y-auto border-t border-line" style={{ height: SHOWN * ROW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} role="list" aria-label="Commits found">
          <div className="relative" style={{ height: found.rows.length * ROW }}>
            {drawn.map((i, k) => (
              <CommitRow key={i} list={list} i={i} y={(first + k) * ROW} onPerson={onPerson} />
            ))}
          </div>
          {found.rows.length === 0 && <p className="absolute inset-x-0 top-10 m-0 text-center text-sm text-secondary">No commit matches. Try fewer words, or a longer Window.</p>}
        </div>
      </section>
      <Explain>
        Every word typed must appear in a commit's subject line, or in the name, GitHub login or address of who made it, in any case. The kind and the Window narrow it further; the folder filter cannot, as the list keeps no files.
        Lines are what the commit added and removed{list.lines ? "" : ", once they are counted"}.
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

function useFound(list: CommitList | null, q: { text: string; person?: number; kind?: number; range: { from?: number; to?: number } }): { rows: Int32Array } {
  const s = useMemo(() => (list ? searcher(list) : null), [list]);
  useEffect(() => () => s?.close(), [s]);
  const [rows, setRows] = useState<Int32Array>(new Int32Array());
  const person = list && q.person !== undefined ? list.people.findIndex((p) => p.person.id === q.person) : undefined;
  const key = JSON.stringify([q.text, person, q.kind, q.range.from, q.range.to]);
  useEffect(() => {
    if (!s) return;
    let current = true;
    void s.run({ text: q.text, person: person === -1 ? -2 : person, kind: q.kind, from: q.range.from, to: q.range.to }).then((r) => current && setRows(r));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, key]);
  return { rows };
}

function SearchBox({ initial, onAsk, go }: { initial: string; onAsk: (text: string) => void; go: ScreenProps["go"] }) {
  const [text, setText] = useState(initial);
  const ask = useLeading(onAsk, 100);
  return (
    <div data-commit-search className="relative min-w-0 flex-1">
      <TextInput
        label="Search commits"
        isLabelHidden
        value={text}
        placeholder="Search by message, person or address"
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

const CommitRow = memo(function CommitRow({ list, i, y, onPerson }: { list: CommitList; i: number; y: number; onPerson: (id: number) => void }) {
  const id = list.ids[i] ?? "";
  const who = list.people[list.person[i] ?? 0]?.person;
  const kind = list.kinds[list.kind[i] ?? 0];
  const added = list.added[i];
  const removed = list.removed[i];
  const when = (list.times[i] ?? 0) + (list.offsets[i] ?? 0) * 60;
  const subject = list.subjects[i];
  return (
    <div role="listitem" data-commit className={`${GRID} absolute inset-x-0 border-b border-line px-4 text-sm transition-colors hover:bg-[var(--color-overlay-hover)] sm:px-5`} style={{ top: y, height: ROW }}>
      <span className="hidden text-xs text-secondary tnum md:block">{date(when)}</span>
      <span className="hidden min-w-0 md:block">{who && who.id !== 0xffffffff ? <Name p={who} onOpen={onPerson} /> : <Name p={who} />}</span>
      <span className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {list.merge[i] && <GitMerge size={14} className="flex-none text-secondary" aria-label="merge" />}
          {kind && kind !== "other" && (
            <span className={`hidden flex-none rounded-full px-2 py-px text-[0.7rem] font-medium sm:inline ${KIND_TONE[KIND_COLOURS[kind] ?? "gray"]}`}>{kind}</span>
          )}
          <span className="truncate" title={subject}>
            {subject || <span className="text-secondary">(no subject)</span>}
          </span>
        </span>
        <span className="truncate text-xs text-secondary md:hidden">
          {who?.name ?? "someone unknown"} · {date(when)}
        </span>
      </span>
      <span className="hidden text-end text-xs whitespace-nowrap text-secondary tnum md:block">
        {added !== null && added !== undefined ? (
          <>
            <span className="text-added">+{compact(added)}</span> <span className="text-removed">−{compact(removed ?? 0)}</span>
          </>
        ) : (
          many(list.files[i] ?? 0, "file", "files")
        )}
      </span>
      {list.link ? (
        <a className="text-end font-mono text-xs text-secondary no-underline hover:text-brand" href={`${list.link}${id}`} target="_blank" rel="noreferrer noopener" title="Open on GitHub">
          {id.slice(0, 7)}
        </a>
      ) : (
        <code className="text-end font-mono text-xs text-secondary">{id.slice(0, 7)}</code>
      )}
    </div>
  );
});

const KIND_TONE: Record<string, string> = {
  green: "bg-[color-mix(in_srgb,var(--s3)_16%,transparent)] text-[color-mix(in_srgb,var(--s3)_62%,var(--color-text-primary))]",
  red: "bg-[color-mix(in_srgb,var(--s8)_16%,transparent)] text-[color-mix(in_srgb,var(--s8)_62%,var(--color-text-primary))]",
  blue: "bg-[color-mix(in_srgb,var(--s1)_16%,transparent)] text-[color-mix(in_srgb,var(--s1)_62%,var(--color-text-primary))]",
  purple: "bg-[color-mix(in_srgb,var(--s7)_16%,transparent)] text-[color-mix(in_srgb,var(--s7)_62%,var(--color-text-primary))]",
  teal: "bg-[color-mix(in_srgb,var(--s6)_16%,transparent)] text-[color-mix(in_srgb,var(--s6)_62%,var(--color-text-primary))]",
  orange: "bg-[color-mix(in_srgb,var(--s2)_16%,transparent)] text-[color-mix(in_srgb,var(--s2)_62%,var(--color-text-primary))]",
  yellow: "bg-[color-mix(in_srgb,var(--s4)_16%,transparent)] text-[color-mix(in_srgb,var(--s4)_62%,var(--color-text-primary))]",
  pink: "bg-[color-mix(in_srgb,var(--s5)_16%,transparent)] text-[color-mix(in_srgb,var(--s5)_62%,var(--color-text-primary))]",
  gray: "bg-[var(--color-background-muted)] text-secondary",
};

/** The Commits screen while its list is fetched, the same size as the screen. */
export function CommitsLoading() {
  return (
    <ScreenFrame label="Loading">
      <section className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface" aria-busy="true">
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="m-0 text-[1.02rem] font-semibold tracking-[-0.01em]">Commits</h2>
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
            <div key={k} className={`${GRID} border-b border-line px-4 sm:px-5`} style={{ height: ROW }}>
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
          ))}
        </div>
      </section>
    </ScreenFrame>
  );
}
