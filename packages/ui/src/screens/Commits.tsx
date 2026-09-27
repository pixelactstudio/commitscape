import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { CommitList } from "@commitscape/data";
import { Figure } from "../charts/common";
import { Key } from "../components/Key";
import { Name } from "../components/Name";
import { useData } from "../data";
import { Explain } from "../explain";
import { compact, date, grouped, many, WINDOW_WORDS } from "../format";
import { useLeading } from "../leading";
import { searcher } from "../searcher";
import type { ScreenProps } from "./props";
import { ScreenSkeleton } from "../components/Loading";

const ROW = 46;
const SHOWN = 14;
const DAY = 86_400;
const SPANS: Record<string, number> = { "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };

export function Commits({ meta, route, params, go }: ScreenProps) {
  const { data: list, error } = useData<CommitList>("/api/commits", {});
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
  if (error) return <p className="error">{error}</p>;
  if (!list) return <ScreenSkeleton />;
  const span = route.from !== undefined || route.to !== undefined ? "the dates chosen" : WINDOW_WORDS[String(params.window)] ?? "all time";
  const first = Math.max(0, Math.floor(top / ROW) - 4);
  const last = Math.min(found.rows.length, first + SHOWN + 8);
  const drawn: number[] = [];
  for (let k = first; k < last; k++) drawn.push(found.rows[k] ?? 0);
  return (
    <div className="screen">
      <Figure
        title="Commits"
        note={`${grouped(found.rows.length)} of ${many(list.ids.length, "commit", "commits")}, over ${span}. Newest first.`}
      >
        <div className="commit-tools">
          <SearchBox initial={route.q ?? ""} onAsk={setAsked} go={go} />
          <Selector
            label="Kind"
            isLabelHidden
            size="md"
            hasClear
            placeholder="every kind"
            value={kind}
            onChange={(v: string | null) => setKind(v)}
            options={list.kinds.map((k, i) => ({ value: String(i), label: k }))}
            width={180}
          />
        </div>
        {route.folder && (
          <p className="note small">The folder filter is left out here: the Commit List does not keep each commit's files.</p>
        )}
        <div
          className="commit-list"
          style={{ height: Math.min(found.rows.length, SHOWN) * ROW || ROW }}
          onScroll={(e) => setTop(e.currentTarget.scrollTop)}
          role="list"
          aria-label="Commits found"
        >
          <div style={{ height: found.rows.length * ROW, position: "relative" }}>
            {drawn.map((i, k) => (
              <CommitRow key={i} list={list} i={i} y={(first + k) * ROW} onPerson={onPerson} />
            ))}
          </div>
          {found.rows.length === 0 && <p className="note empty">No commit matches.</p>}
        </div>
        <Explain>
          Every word typed must appear in a commit's subject line, or in the name, GitHub login or address of who made it,
          in any case. The filters above and the Window narrow it further; the folder filter cannot, as the list keeps
          no files. Lines are what the commit added and removed{list.lines ? "" : ", once they are counted"}.
        </Explain>
      </Figure>
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

function useFound(
  list: CommitList | null,
  q: { text: string; person?: number; kind?: number; range: { from?: number; to?: number } },
): { rows: Int32Array } {
  const s = useMemo(() => (list ? searcher(list) : null), [list]);
  useEffect(() => () => s?.close(), [s]);
  const [rows, setRows] = useState<Int32Array>(new Int32Array());
  const person = list && q.person !== undefined ? list.people.findIndex((p) => p.person.id === q.person) : undefined;
  const key = JSON.stringify([q.text, person, q.kind, q.range.from, q.range.to]);
  useEffect(() => {
    if (!s) return;
    let current = true;
    void s
      .run({ text: q.text, person: person === -1 ? -2 : person, kind: q.kind, from: q.range.from, to: q.range.to })
      .then((r) => current && setRows(r));
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
    <div className="commit-search">
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
      <Key keys="/" />
    </div>
  );
}

const CommitRow = memo(function CommitRow({
  list,
  i,
  y,
  onPerson,
}: {
  list: CommitList;
  i: number;
  y: number;
  onPerson: (id: number) => void;
}) {
  const id = list.ids[i] ?? "";
  const who = list.people[list.person[i] ?? 0]?.person;
  const kind = list.kinds[list.kind[i] ?? 0];
  const added = list.added[i];
  const removed = list.removed[i];
  const when = (list.times[i] ?? 0) + (list.offsets[i] ?? 0) * 60;
  return (
    <div className="commit-row" role="listitem" style={{ top: y, height: ROW }}>
      <span className="commit-when">{date(when)}</span>
      <span className="commit-who">
        {who && who.id !== 0xffffffff ? <Name p={who} onOpen={onPerson} /> : <Name p={who} />}
      </span>
      <span className="commit-subject" title={list.subjects[i]}>
        {list.subjects[i] || <span className="note">(no subject)</span>}
      </span>
      <span className="commit-tags">
        {list.merge[i] && <Badge label="merge" variant="neutral" />}
        {kind && kind !== "other" && <Badge label={kind} variant="info" />}
      </span>
      <span className="commit-size note">
        {many(list.files[i] ?? 0, "file", "files")}
        {added !== null && added !== undefined && (
          <>
            {" "}
            <span className="added">+{compact(added)}</span> <span className="removed">−{compact(removed ?? 0)}</span>
          </>
        )}
      </span>
      {list.link ? (
        <a className="commit-id" href={`${list.link}${id}`} target="_blank" rel="noreferrer noopener" title="Open on GitHub">
          {id.slice(0, 8)}
        </a>
      ) : (
        <code className="commit-id">{id.slice(0, 8)}</code>
      )}
    </div>
  );
});
