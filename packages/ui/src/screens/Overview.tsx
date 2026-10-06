import { useContext } from "react";
import { Button } from "@astryxdesign/core/Button";
import { useSuspenseQueries } from "@tanstack/react-query";
import { ChevronRight, Trophy } from "lucide-react";
import type { MapLevel, Overview as Data, People, PersonRow, QuarterLines } from "@commitscape/data";
import { dataQuery, StaleContext, useSource } from "../data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useStanding } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, duration, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { personColour } from "../theme";
import { useTip } from "../charts/tip";
import { Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime, within } from "./kit";
import { openers, type ScreenProps } from "./props";
import { WhereWork } from "./WhereWork";

export const CONTRIBUTORS_SHOWN = 8;
export const LANGUAGES_SHOWN = 6;

/** The repository at a glance: its size and age, who built it, its languages, where the work is as a sunburst, and how its commits fell over time; laid out to fit how many people and how much history it has. */
export function Overview({ meta, params, go }: ScreenProps) {
  const source = useSource();
  const stale = useContext(StaleContext);
  const [overview, people, map] = useSuspenseQueries({
    queries: [dataQuery<Data>(source, "/api/overview", params), dataQuery<People>(source, "/api/people", params), dataQuery<MapLevel>(source, "/api/map", { ...params, path: "" })],
  });
  const o = overview.data.data;
  if (!o) return <Failed words={overview.data.error} />;
  const open = openers(go);
  const span = within(o.window);
  const releases = o.timeline.filter((m) => m.kind === "release").map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name ?? "a release" }));
  const inWindow = releases.filter((r) => r.day >= o.first_day && r.day < o.first_day + o.days.length);
  const rows = people.data.data?.people ?? [];
  const few = rows.length > 0 && rows.length <= FEW;
  const ages = ageBuckets(o.code_age);
  const who = <WhoBuiltIt rows={rows} everyone={o.window === "all" ? o.totals.people : null} commits={o.commits} span={span} onPerson={open.person} onAll={() => go({ screen: "people", id: undefined })} few={few} />;
  const name = meta.name.split("/").at(-1) || meta.name;
  return (
    <ScreenFrame stale={stale}>
      <KeyNumbers o={o} span={span} />
      <div className="grid gap-gutter lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {who}
        <div className="flex min-w-0 flex-col gap-gutter">
          <Languages o={o} fill={few || ages.length < 3} />
          {!few && ages.length >= 3 && <CodeAge ages={ages} />}
        </div>
      </div>
      <WhereWork root={map.data.data} name={name} params={params} span={span} commits={o.commits} onFile={open.file} onFolder={open.folder} />
      <Panel
        title="Commits over time"
        description={`${many(o.commits, "commit", "commits")} ${span}, merges left out`}
        actions={inWindow.length > 0 ? <span className="type-micro">{many(inWindow.length, "release", "releases")}, newest {inWindow.at(-1)?.label}</span> : undefined}
      >
        {o.commits === 0 ? (
          <p className="m-0 grid h-[264px] place-items-center type-caption">No commits in this Window. Choose a longer one above.</p>
        ) : (
          <TrendOverTime firstDay={o.first_day} days={o.days} unit="commits" releases={releases} />
        )}
        <Explain>Commits that are not merges, by the day they landed on their author's clock. The ticks beneath are releases: hover one for its name.</Explain>
      </Panel>
    </ScreenFrame>
  );
}

export const FEW = 3;

export const LISTED = 1000;

function counted(n: number): string {
  return n >= LISTED ? `${grouped(n)}+` : grouped(n);
}

function KeyNumbers({ o, span }: { o: Data; span: string }) {
  const t = o.totals;
  const age = t.first_commit !== null && t.last_commit !== null ? (t.last_commit - t.first_commit) / 86_400 : null;
  return (
    <section aria-label="The repository in numbers" className="flex flex-col gap-2">
      <NumberStrip columns={6}>
        <NumberCell id="commits" value={grouped(t.commits - t.merges)} label="commits" note={o.window === "all" ? "merges left out" : `${grouped(o.commits)} ${span}`} />
        <NumberCell id="people" value={grouped(t.people)} label="people" note={o.window === "all" ? "bots left out" : `${counted(o.people.length)} ${span}`} />
        <NumberCell id="lines" value={compact(t.code_lines)} label="lines of code" note={`and ${compact(t.prose_lines)} of prose`} />
        <NumberCell id="files" value={grouped(t.files)} label="files" note={`${grouped(t.code_files)} of them code`} />
        <NumberCell id="history" value={age === null ? "—" : duration(age)} label="of history" note={t.first_commit === null ? "no commits" : `since ${date(t.first_commit)}`} />
        <NumberCell id="days" value={grouped(o.active_days)} label="active days" note={span} />
      </NumberStrip>
      <Explain>
        Commits leave out merges; people count each person once, however many addresses they used, and leave out bots. Files and lines are at HEAD, the newest commit: code is what is not prose, generated, vendored or binary,
        and blank lines are left out. Active days are days with a commit, on each author's own clock.
      </Explain>
    </section>
  );
}

function WhoBuiltIt({ rows, everyone, commits, span, onPerson, onAll, few }: { rows: PersonRow[]; everyone: number | null; commits: number; span: string; onPerson: (id: number) => void; onAll: () => void; few: boolean }) {
  const people = everyone !== null && everyone > rows.length ? grouped(everyone) : counted(rows.length);
  const shown = rows.slice(0, CONTRIBUTORS_SHOWN);
  const lines = rows.some((r) => r.lines_added !== null);
  const most = Math.max(1, ...shown.map((r) => r.commits));
  const description = rows.length === 0 ? `Nobody committed ${span}` : rows.length === 1 ? `One person ${span}` : `${people} people ${span}, most commits first`;
  if (few)
    return (
      <Panel title="Who built it" description={description} className="h-full [&>*]:h-full [&>*>*]:h-full" actions={<Button label="People" variant="ghost" size="sm" onClick={onAll} endContent={<ChevronRight size={14} aria-hidden />} />}>
        <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Contributors">
          {shown.map((r) => (
            <Builder key={r.person.id} r={r} commits={commits} lines={lines} solo={rows.length === 1} onPerson={onPerson} />
          ))}
        </ol>
      </Panel>
    );
  return (
    <Panel padding={0} title="Who built it" description={description} className="h-full [&>*]:h-full [&>*>*]:h-full">
      {shown.length === 0 ? (
        <div className="px-5 pb-5">
          <Quiet>No commits in this Window. Choose a longer one above.</Quiet>
        </div>
      ) : (
        <ol className="m-0 list-none p-0" aria-label="Contributors">
          {shown.map((r, i) => (
            <Contributor key={r.person.id} r={r} place={i + 1} commits={commits} most={most} lines={lines} onPerson={onPerson} />
          ))}
        </ol>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-5 py-2.5">
        <span className="hidden type-micro sm:inline">{lines ? "Lines leave out lockfiles and generated files" : "Click a name for what they did here"}</span>
        {rows.length > 0 && (
          <span className="ms-auto">
            <Button label={rows.length > CONTRIBUTORS_SHOWN ? `All ${people} people` : "People"} variant="ghost" size="sm" onClick={onAll} endContent={<ChevronRight size={14} aria-hidden />} />
          </span>
        )}
      </div>
    </Panel>
  );
}

function Builder({ r, commits, lines, solo, onPerson }: { r: PersonRow; commits: number; lines: boolean; solo: boolean; onPerson: (id: number) => void }) {
  const login = useLogin(r.person);
  const standing = useStanding(login);
  const facts: [string, string, string?][] = [
    [grouped(r.commits), r.commits === 1 ? "commit" : "commits", solo ? undefined : `${share(r.commits, commits)} of all`],
    [grouped(r.active_days), r.active_days === 1 ? "active day" : "active days"],
    ...(lines && r.lines_added !== null ? ([[`+${compact(r.lines_added)}`, "lines added", `−${compact(r.lines_removed ?? 0)} removed`]] as [string, string, string][]) : []),
    ...(r.prs_merged !== null && r.prs_merged > 0 ? ([[grouped(r.prs_merged), r.prs_merged === 1 ? "PR merged" : "PRs merged"]] as [string, string][]) : []),
  ];
  return (
    <li className="flex flex-col gap-4 rounded-md border border-line bg-sunken p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Face login={login} name={r.person.name} size={solo ? 48 : 40} ring={personColour(r.person.colour)} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <button type="button" onClick={() => onPerson(r.person.id)} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start font-[inherit] text-md font-semibold text-primary underline-offset-[3px] hover:underline">
            {r.person.name}
          </button>
          <span className="truncate type-caption">
            {login ? `@${login} · ` : ""}
            {date(r.first)} – {date(r.last)}
          </span>
        </span>
        {standing && (
          <A href={standing} title={`Where ${r.person.name} stands here`} aria-label={`Where ${r.person.name} stands here`} className="ms-auto grid size-8 flex-none place-items-center rounded-md text-secondary transition-colors hover:bg-sunken hover:text-primary sm:hidden">
            <Trophy size={14} aria-hidden />
          </A>
        )}
      </div>
      <dl className="m-0 grid flex-none grid-cols-3 gap-x-5 gap-y-2 sm:flex sm:items-center">
        {facts.slice(0, 3).map(([value, label, note]) => (
          <div key={label} className="flex min-w-0 flex-col">
            <dd className={`order-1 m-0 type-stat-sm ${value.startsWith("+") ? "text-added" : ""}`}>{value}</dd>
            <dt className="order-2 mt-1 type-caption whitespace-nowrap">{note ?? label}</dt>
          </div>
        ))}
      </dl>
      {standing && (
        <A href={standing} title={`Where ${r.person.name} stands here`} aria-label={`Where ${r.person.name} stands here`} className="hidden size-8 flex-none place-items-center rounded-md text-secondary transition-colors hover:bg-sunken hover:text-primary sm:grid">
          <Trophy size={14} aria-hidden />
        </A>
      )}
    </li>
  );
}

function Contributor({ r, place, commits, most, lines, onPerson }: { r: PersonRow; place: number; commits: number; most: number; lines: boolean; onPerson: (id: number) => void }) {
  const login = useLogin(r.person);
  const standing = useStanding(login);
  return (
    <li className="flex h-15 items-center gap-3 border-t border-line px-5">
      <span className="w-4 flex-none text-end type-micro tnum">{place}</span>
      <Face login={login} name={r.person.name} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <button type="button" onClick={() => onPerson(r.person.id)} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start font-[inherit] text-sm font-medium text-primary underline-offset-[3px] hover:underline">
            {r.person.name}
          </button>
          {login && <span className="hidden truncate type-micro sm:inline">@{login}</span>}
        </span>
        <span className="block h-1 w-full max-w-72 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${(r.commits * 100) / most}%`, background: personColour(r.person.colour) }} />
        </span>
      </span>
      <span className="flex w-14 flex-none flex-col items-end text-sm whitespace-nowrap tnum sm:w-24">
        <span className="font-medium">{grouped(r.commits)}</span>
        <span className="type-micro">
          {share(r.commits, commits)}
          <span className="hidden sm:inline"> of commits</span>
        </span>
      </span>
      {lines && (
        <span className="hidden w-20 flex-none flex-col items-end text-xs tnum sm:flex">
          {r.lines_added === null ? (
            <span className="text-tertiary">—</span>
          ) : (
            <>
              <span className="text-added">+{compact(r.lines_added)}</span>
              <span className="text-removed">−{compact(r.lines_removed ?? 0)}</span>
            </>
          )}
        </span>
      )}
      {standing ? (
        <A href={standing} title={`Where ${r.person.name} stands here`} aria-label={`Where ${r.person.name} stands here`} className="grid size-8 flex-none place-items-center rounded-md text-secondary transition-colors hover:bg-sunken hover:text-primary">
          <Trophy size={14} aria-hidden />
        </A>
      ) : (
        <span className="hidden w-8 flex-none sm:block" aria-hidden />
      )}
    </li>
  );
}

function Languages({ o, fill = false }: { o: Data; fill?: boolean }) {
  const total = Math.max(1, o.languages.reduce((n, l) => n + l.lines, 0));
  const named = o.languages.slice(0, LANGUAGES_SHOWN);
  const rest = o.languages.slice(LANGUAGES_SHOWN).reduce((n, l) => n + l.lines, 0);
  const parts = [...named.map((l, i) => ({ name: l.name, lines: l.lines, colour: `var(--s${i + 1})` })), ...(rest > 0 ? [{ name: "Other", lines: rest, colour: "var(--other)" }] : [])];
  return (
    <Panel title="Languages" description="Lines of code at HEAD" className={fill ? "flex-1 [&>*]:h-full [&>*>*]:h-full" : ""}>
      {parts.length === 0 ? (
        <Quiet>No code at HEAD in a language this tool knows.</Quiet>
      ) : (
        <div className="flex flex-col gap-4">
          <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {parts.map((p) => (
              <span key={p.name} className="block h-full min-w-0.75" style={{ width: `${(p.lines * 100) / total}%`, background: p.colour }} />
            ))}
          </span>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-0" aria-label="Languages by lines of code">
            {parts.map((p) => (
              <li key={p.name} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="size-2.5 flex-none rounded-full" style={{ background: p.colour }} aria-hidden />
                <span className="truncate">{p.name}</span>
                <span className="ms-auto text-xs text-secondary tnum" title={`${grouped(p.lines)} lines`}>
                  {share(p.lines, total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

type Age = { key: string; label: string; short: string; lines: number };

function ageBuckets(quarters: QuarterLines[]): Age[] {
  if (quarters.length === 0) return [];
  const sorted = [...quarters].sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return [];
  const span = (last.year - first.year) * 4 + last.quarter - first.quarter + 1;
  if (span <= 12) {
    const out: Age[] = [];
    for (let i = 0; i < span; i++) {
      const year = first.year + Math.floor((first.quarter - 1 + i) / 4);
      const quarter = ((first.quarter - 1 + i) % 4) + 1;
      const lines = sorted.find((q) => q.year === year && q.quarter === quarter)?.lines ?? 0;
      out.push({ key: `${year}q${quarter}`, label: `Q${quarter} ${year}`, short: quarter === 1 || i === 0 ? `Q${quarter} ’${String(year).slice(2)}` : `Q${quarter}`, lines });
    }
    return out;
  }
  const out: Age[] = [];
  for (let year = first.year; year <= last.year; year++) {
    const lines = sorted.filter((q) => q.year === year).reduce((n, q) => n + q.lines, 0);
    out.push({ key: String(year), label: String(year), short: `’${String(year).slice(2)}`, lines });
  }
  return out;
}

function CodeAge({ ages }: { ages: Age[] }) {
  const tip = useTip();
  const total = Math.max(1, ages.reduce((n, a) => n + a.lines, 0));
  const most = Math.max(1, ...ages.map((a) => a.lines));
  const old = ages.slice(0, Math.max(1, Math.floor(ages.length / 2))).reduce((n, a) => n + a.lines, 0);
  const label = (i: number) => ages.length <= 8 || i % Math.ceil(ages.length / 7) === 0 || i === ages.length - 1;
  return (
    <Panel title="How old the code is" description={`Lines of code at HEAD by when their file first appeared; ${share(old, total)} from the first half of its history`} className="flex-1 [&>*]:h-full [&>*>*]:h-full">
      <div className="flex min-h-[9rem] flex-1 flex-col gap-1.5">
        <div className="relative min-h-[7.5rem] flex-1">
        <div className="absolute inset-0 flex items-end gap-0.75" role="img" aria-label="Lines of code at HEAD by when their file first appeared">
          {ages.map((a) => (
            <span key={a.key} className="group flex h-full min-w-0 flex-1 cursor-default items-end" {...tip(<><strong>{a.label}</strong><div className="note">{compact(a.lines)} lines still at HEAD · {share(a.lines, total)}</div></>)}>
              <span className="block w-full rounded-t-cell bg-(--s1) opacity-80 transition-opacity group-hover:opacity-100" style={{ height: `${Math.max(a.lines > 0 ? 2 : 0, (a.lines * 100) / most)}%` }} />
            </span>
          ))}
        </div>
        </div>
        <div className="flex gap-0.75 border-t border-line pt-1.5 type-micro tnum">
          {ages.map((a, i) => (
            <span key={a.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
              {label(i) ? a.short : ""}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}
