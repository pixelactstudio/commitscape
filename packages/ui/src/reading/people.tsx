import { memo, useContext, useMemo, useState, type ReactNode } from "react";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ArrowDownUp, Search, Trophy } from "lucide-react";
import { RANKING_LIMIT, type People as Data, type PersonRow } from "@commitscape/data";
import { LoginsContext } from "../help";
import { useCounting } from "../data";
import { Face } from "../components/Face";
import { useStanding } from "../components/Name";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { compact, date, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { AddedRemoved } from "../kit/layout";
import { Counting } from "../kit/pending";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { NoMatch } from "../screens/kit";
import { personColour } from "../theme";
import { useWindowRows } from "./rows";
import { SortHead, Spacer } from "./table";
import { useWidth } from "./width";

type Key = "person" | "commits" | "days" | "lines" | "last";

const ORDERS: { value: Key; label: string }[] = [
  { value: "commits", label: "Most commits" },
  { value: "days", label: "Most active days" },
  { value: "lines", label: "Most lines" },
  { value: "last", label: "Latest activity" },
  { value: "person", label: "Name, A to Z" },
];

const ROW = 60;
const ROW_NARROW = 84;
const NARROW = 544;

const WHY: Record<Key, string> = {
  person: "Their name, A to Z.",
  commits: "Commits that are not merges.",
  days: "Days with at least one of their commits, on their own clock.",
  lines: "Lines their commits added and removed, lockfiles and generated files left out.",
  last: "When their first and last commit in the Window were made.",
};

const value = (r: PersonRow, key: Key): number | string | null => {
  if (key === "person") return r.person.name.toLowerCase();
  if (key === "commits") return r.commits;
  if (key === "days") return r.active_days;
  if (key === "lines") return r.lines_added;
  return r.last;
};

function order(rows: PersonRow[], key: Key, down: boolean): PersonRow[] {
  const sign = down ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
    return c !== 0 ? sign * c : b.commits - a.commits || a.person.name.localeCompare(b.person.name);
  });
}

/** Everyone who committed in the Window as a sortable table you can search; only the rows near the screen are drawn, so thousands of people cost no more than a few. */
export function EveryoneTable({ data, lines, empty, onOpen, onCommits }: { data: Data; lines: boolean; empty: ReactNode; onOpen: (id: number) => void; onCommits: (id: number) => void }) {
  const logins = useContext(LoginsContext);
  const [sort, setSort] = useState<{ key: Key; down: boolean }>({ key: "commits", down: true });
  const [text, setText] = useState("");
  const asked = text.trim().toLowerCase();
  const rows = useMemo(() => {
    const found = asked === "" ? data.people : data.people.filter((r) => r.person.name.toLowerCase().includes(asked) || (r.person.login ?? logins.get(r.person.id) ?? "").toLowerCase().includes(asked));
    return order(found, sort.key, sort.down);
  }, [data.people, asked, sort, logins]);
  const by = (key: Key) => setSort((s) => (s.key === key ? { key, down: !s.down } : { key, down: key !== "person" }));
  const most = useMemo(() => Math.max(1, ...data.people.map((r) => r.commits)), [data.people]);
  const commits = useMemo(() => data.people.reduce((n, r) => n + r.commits, 0), [data.people]);
  const span = useMemo<[number, number]>(() => [Math.min(...data.people.map((r) => r.first)), Math.max(...data.people.map((r) => r.last))], [data.people]);
  const [boxRef, width] = useWidth<HTMLElement>();
  const narrow = width > 0 && width < NARROW;
  const height = narrow ? ROW_NARROW : ROW;
  const [bodyRef, rowsWindow] = useWindowRows(rows.length, height, `${sort.key}${sort.down}${asked}`);
  const listed = data.people.length;
  const capped = listed >= RANKING_LIMIT;
  return (
    <>
      <Toolbar label="Find a person">
        <ToolbarField kind="find">
          <TextInput label="Find a person" isLabelHidden placeholder="Find a person" value={text} onChange={setText} hasClear width="100%" autoComplete="off" startIcon={<Search size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />} />
        </ToolbarField>
        <ToolbarField kind="order" className="@min-[34rem]:hidden">
          <Selector
            label="Sort by"
            isLabelHidden
            width="100%"
            startIcon={<ArrowDownUp size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />}
            value={sort.key}
            onChange={(v: string | null) => v && setSort({ key: v as Key, down: v !== "person" })}
            options={ORDERS.filter((o) => o.value !== "lines" || lines)}
          />
        </ToolbarField>
      </Toolbar>
      <section ref={boxRef} aria-label="Everyone" className="@container min-w-0 overflow-clip surface">
        <p role="status" className="m-0 px-4 py-3 type-caption tnum sm:px-5">
          {asked === "" ? (
            capped ? (
              <>
                The <strong className="font-semibold text-primary">{grouped(listed)} people</strong> with most commits
              </>
            ) : (
              <strong className="font-semibold text-primary">{many(listed, "person", "people")}</strong>
            )
          ) : (
            <>
              <strong className="font-semibold text-primary">{grouped(rows.length)}</strong> of {capped ? `the ${grouped(listed)} listed` : many(listed, "person", "people")} match “{text.trim()}”
            </>
          )}
        </p>
        <table className="w-full table-fixed border-collapse text-start">
          <caption className="sr-only">People</caption>
          <thead>
            <tr>
              <SortHead label="Person" why={WHY.person} active={sort.key === "person"} down={sort.down} onSort={() => by("person")} align="start" className="ps-4 sm:ps-5" />
              <SortHead label="Commits" why={WHY.commits} active={sort.key === "commits"} down={sort.down} onSort={() => by("commits")} className="w-24 @min-[34rem]:w-32" />
              <SortHead label="Active days" why={WHY.days} active={sort.key === "days"} down={sort.down} onSort={() => by("days")} className="hidden w-28 @min-[34rem]:table-cell" />
              {lines && <SortHead label="Lines" why={WHY.lines} active={sort.key === "lines"} down={sort.down} onSort={() => by("lines")} className="hidden w-36 @min-[44rem]:table-cell" />}
              <SortHead label="When they were active" why={WHY.last} active={sort.key === "last"} down={sort.down} onSort={() => by("last")} align="start" className="hidden w-60 @min-[58rem]:table-cell" />
              <th aria-hidden className="sticky top-(--chrome-top) z-(--z-raised) w-2 border-b border-separator bg-surface p-0" />
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            <Spacer height={rowsWindow.before} />
            {rows.slice(rowsWindow.from, rowsWindow.to).map((r) => (
              <PersonLine key={r.person.id} r={r} lines={lines} most={most} commits={commits} span={span} onOpen={onOpen} onCommits={onCommits} />
            ))}
            <Spacer height={rowsWindow.after} />
          </tbody>
        </table>
        {rows.length === 0 && <div className="border-t border-separator px-5">{listed === 0 ? empty : <NoMatch what="people" query={text.trim()} words="Search by a name or a GitHub login." onClear={() => setText("")} clear="Clear the search" />}</div>}
        <div className="border-t border-separator px-4 py-3 empty:hidden sm:px-5">
          <Explain>
            <ul>
              {(["commits", "days", "lines", "last"] as Key[]).map((k) => (
                <li key={k}>{WHY[k]}</li>
              ))}
            </ul>
          </Explain>
        </div>
      </section>
    </>
  );
}

const PersonLine = memo(function PersonLine({ r, lines, most, commits, span, onOpen, onCommits }: { r: PersonRow; lines: boolean; most: number; commits: number; span: [number, number]; onOpen: (id: number) => void; onCommits: (id: number) => void }) {
  const logins = useContext(LoginsContext);
  const login = r.person.login ?? logins.get(r.person.id) ?? null;
  const standing = useStanding(login);
  const counting = useCounting();
  const colour = personColour(r.person.colour);
  const length = Math.max(1, span[1] - span[0]);
  const from = ((r.first - span[0]) * 100) / length;
  const width = Math.max(1.5, ((r.last - r.first) * 100) / length);
  const link = "plain-button hit type-ui font-medium text-primary hover:underline hover:decoration-line-strong hover:underline-offset-4";
  return (
    <tr className="row-hover h-15 border-t border-separator first:border-t-0 @max-[34rem]:h-21">
      <th scope="row" className="py-0 ps-4 pe-3 text-start font-normal sm:ps-5">
        <span className="flex min-w-0 items-center gap-3">
          <Face login={login} name={r.person.name} size={32} tint={colour} decorative />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={() => onOpen(r.person.id)} className={`${link} w-fit max-w-full truncate`}>
                <bdi>{r.person.name}</bdi>
              </button>
              {standing && (
                <A href={standing} aria-label={`Where ${r.person.name} stands here`} title={`Where ${r.person.name} stands here`} className="hit grid size-6 flex-none place-items-center rounded-md text-secondary no-underline hover:bg-hover hover:text-primary">
                  <Trophy size={ICON.sm} aria-hidden />
                </A>
              )}
            </span>
            <span className="truncate type-caption">
              {login ? <bdi className="type-id">@{login}</bdi> : "no GitHub account known"}
              {r.identities > 1 ? ` · ${r.identities} addresses` : ""}
            </span>
            <span className="truncate type-caption tnum @min-[34rem]:hidden">{many(r.active_days, "active day", "active days")}</span>
          </span>
        </span>
      </th>
      <td className="px-3 py-0 text-end tnum">
        <span className="inline-flex flex-col items-end gap-1">
          <button type="button" onClick={() => onCommits(r.person.id)} aria-label={`${many(r.commits, "commit", "commits")} by ${r.person.name}`} title={`${r.person.name}’s commits`} className={link}>
            {grouped(r.commits)}
          </button>
          <span className="flex items-center gap-1.5">
            <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-track @min-[34rem]:block" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (r.commits * 100) / most)}%`, background: colour }} />
            </span>
            <span className="type-caption @min-[34rem]:w-9">{share(r.commits, commits)}</span>
          </span>
        </span>
      </td>
      <td className="hidden px-3 py-0 text-end type-ui tnum @min-[34rem]:table-cell">{grouped(r.active_days)}</td>
      {lines && (
        <td className="hidden px-3 py-0 text-end tnum @min-[44rem]:table-cell">
          {r.lines_added === null ? (
            counting ? (
              <span className="inline-flex flex-col items-end gap-1.5">
                <Counting width={72} height={14} />
                <Counting width={56} height={4} index={1} />
              </span>
            ) : (
              <span title="Not counted in this Report" className="type-ui text-tertiary">
                —<span className="sr-only">not counted</span>
              </span>
            )
          ) : (
            <span className="inline-flex flex-col items-end gap-1">
              <span className="type-caption">
                <span className="text-added">+{compact(r.lines_added)}</span> <span className="text-removed">−{compact(r.lines_removed ?? 0)}</span>
              </span>
              <AddedRemoved added={r.lines_added} removed={r.lines_removed ?? 0} className="h-1 w-14" />
            </span>
          )}
        </td>
      )}
      <td className="hidden px-3 py-0 @min-[58rem]:table-cell">
        <span className="flex flex-col gap-1.5">
          <span className="relative block h-1.5 rounded-full bg-track" aria-hidden>
            <span className="absolute inset-y-0 rounded-full" style={{ left: `${Math.min(from, 100 - width)}%`, width: `${width}%`, background: colour }} />
          </span>
          <span className="flex justify-between gap-2 type-micro whitespace-nowrap tnum">
            <span>{date(r.first)}</span>
            {r.last - r.first >= 86_400 && <span>{date(r.last)}</span>}
          </span>
        </span>
      </td>
      <td aria-hidden className="w-2 p-0" />
    </tr>
  );
});
