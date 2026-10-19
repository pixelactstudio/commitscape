import { useContext } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQueries } from "@tanstack/react-query";
import { OVERVIEW_TOP, type MapLevel, type Overview as Data, type People, type QuarterLines } from "@commitscape/data";
import { TableView, ChartFrame } from "../charts/common";
import { useTip } from "../charts/tip";
import { TipCard } from "../charts/Tip";
import { dataQuery, StaleContext, useSource } from "../data";
import { Explain } from "../explain";
import { compact, date, duration, grouped, many, share, within } from "../format";
import { Panel } from "../kit/layout";
import { FILL_PANEL } from "../reading/classes";
import { ROW_HEIGHT, WhoBuiltIt } from "../reading/who";
import { BarList, EmptyWindow, Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime } from "./kit";
import { useReload } from "./reload";
import { openers, type ScreenProps } from "./props";
import { LISTED, WhereWork } from "./WhereWork";

export const CONTRIBUTORS_SHOWN = OVERVIEW_TOP;

type Listed<T> = T & { count?: number };

export const LANGUAGES_SHOWN = 6;

/** The repository at a glance: its size and age, who built it and where the work is, how its commits fell over time, its languages and how old its code is. */
export function Overview({ params, route, go }: ScreenProps) {
  const source = useSource();
  const stale = useContext(StaleContext);
  const reload = useReload();
  const asked = { ...params, top: OVERVIEW_TOP };
  const [overview, people, map] = useSuspenseQueries({
    queries: [dataQuery<Listed<Data>>(source, "/api/overview", asked), dataQuery<Listed<People>>(source, "/api/people", asked), dataQuery<MapLevel>(source, "/api/map", { ...params, path: "" })],
  });
  const o = overview.data.data;
  if (!o) return <Failed words={overview.data.error} retry={reload} />;
  const open = openers(go, route);
  const span = within(o.window);
  const releases = o.timeline.filter((m) => m.kind === "release").map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name ?? "a release" }));
  const inWindow = releases.filter((r) => r.day >= o.first_day && r.day < o.first_day + o.days.length);
  const rows = people.data.data?.people ?? [];
  const listedPeople = people.data.data?.count ?? rows.length;
  const ages = ageBuckets(o.code_age);
  return (
    <ScreenFrame stale={stale}>
      <KeyNumbers o={o} listed={o.count ?? o.people.length} span={span} />
      <div className="grid gap-gutter @min-[58rem]:grid-cols-2">
        <WhoBuiltIt rows={rows} listed={listedPeople} everyone={o.window === "all" ? o.totals.people : null} commits={o.commits} span={span} empty={<EmptyWindow window={o.window} what="Choose a longer Window to see who built it." go={go} />} onPerson={open.person} onCommits={(who) => open.commits({ who })} onAll={() => go({ screen: "people", id: undefined, tab: undefined })} />
        <WhereWork root={map.data.data} params={params} span={span} commits={o.commits} onFile={open.code} onMap={open.folder} onCode={open.code} />
      </div>
      {o.commits > 0 && (
        <Panel
          title="Commits over time"
          description={`${many(o.commits, "commit", "commits")} ${span}, merges left out`}
          actions={inWindow.length > 0 ? <span className="type-caption">{many(inWindow.length, "release", "releases")}, newest {inWindow.at(-1)?.label}</span> : undefined}
        >
          <TrendOverTime firstDay={o.first_day} days={o.days} unit="commits" releases={releases} onPick={(d) => open.commits(d)} />
          <Explain>Commits that are not merges, by the day they landed on their author’s clock. Select a period for its commits. The ticks beneath are releases: hover one for its name.</Explain>
        </Panel>
      )}
      <div className="grid items-start gap-gutter @min-[58rem]:grid-cols-2">
        <Languages o={o} />
        <CodeAge ages={ages} />
      </div>
    </ScreenFrame>
  );
}

function KeyNumbers({ o, listed, span }: { o: Data; listed: number; span: string }) {
  const t = o.totals;
  const age = t.first_commit !== null && t.last_commit !== null ? (t.last_commit - t.first_commit) / 86_400 : null;
  return (
    <section aria-label="The repository in numbers" className="flex flex-col gap-2">
      <NumberStrip>
        <NumberCell id="commits" value={grouped(t.commits - t.merges)} label="commits" note={o.window === "all" ? "merges left out" : `${grouped(o.commits)} ${span}`} />
        <NumberCell id="people" value={grouped(t.people)} label="people" note={o.window === "all" ? "bots left out" : `${grouped(listed)} ${span}`} />
        <NumberCell id="lines" value={compact(t.code_lines)} label="lines of code" note={`and ${compact(t.prose_lines)} of prose`} />
        <NumberCell id="files" value={grouped(t.files)} label="files" note={`${grouped(t.code_files)} of them code`} />
        <NumberCell id="history" value={age === null ? "—" : duration(age)} label="of history" note={t.first_commit === null ? "no commits" : `since ${date(t.first_commit)}`} />
        <NumberCell id="days" value={grouped(o.active_days)} label="active days" note={span} />
      </NumberStrip>
      <Explain>
        Commits leave out merges; people count each person once, however many addresses they used, and leave out bots. Files and lines are at HEAD, the newest commit: code is what is not prose, generated, vendored or binary,
        and blank lines are left out. Active days are days with a commit, on each author’s own clock.
      </Explain>
    </section>
  );
}

function Languages({ o }: { o: Data }) {
  const total = Math.max(1, o.languages.reduce((n, l) => n + l.lines, 0));
  const named = o.languages.slice(0, LANGUAGES_SHOWN);
  const rest = o.languages.slice(LANGUAGES_SHOWN).reduce((n, l) => n + l.lines, 0);
  const items = [
    ...named.map((l) => ({ key: l.name, label: l.name, value: l.lines, shown: `${share(l.lines, total)} · ${compact(l.lines)} lines`, title: `${grouped(l.lines)} lines` })),
    ...(rest > 0 ? [{ key: "other", label: "Other languages", value: rest, shown: `${share(rest, total)} · ${compact(rest)} lines`, title: `${grouped(rest)} lines`, colour: "var(--other)" }] : []),
  ];
  return (
    <Panel title="Languages" description="Lines of code at HEAD">
      {items.length === 0 ? <Quiet>No code at HEAD in a language this tool knows.</Quiet> : <BarList label="Languages by lines of code" items={items} />}
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

const AGE_HEIGHT = "h-40";

function CodeAge({ ages }: { ages: Age[] }) {
  const tip = useTip();
  const total = Math.max(1, ages.reduce((n, a) => n + a.lines, 0));
  const most = Math.max(1, ...ages.map((a) => a.lines));
  const old = ages.slice(0, Math.max(1, Math.floor(ages.length / 2))).reduce((n, a) => n + a.lines, 0);
  const label = (i: number) => ages.length <= 8 || i % Math.ceil(ages.length / 7) === 0 || i === ages.length - 1;
  return (
    <Panel title="How old the code is" description={ages.length === 0 ? "Lines of code at HEAD by when their file first appeared" : `${share(old, total)} of the lines at HEAD are in files from the first half of its history`}>
      {ages.length === 0 ? (
        <Quiet>No dated code at HEAD.</Quiet>
      ) : (
        <ChartFrame
          label="How old the code is"
          summary={`Lines of code at HEAD by when their file first appeared, from ${ages[0]?.label} to ${ages.at(-1)?.label}; ${share(old, total)} are from the first half`}
          table={
            <TableView title="How old the code is" head={["Files first seen", "Lines at HEAD", "Share"]} rows={ages.map((a) => [a.label, a.lines, share(a.lines, total)])} />
          }
        >
          <div className="flex flex-col gap-1.5">
            <div className={`flex items-end gap-0.5 border-b border-separator ${AGE_HEIGHT}`}>
              {ages.map((a) => (
                <span key={a.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" {...tip(<TipCard kicker="Files first seen" title={a.label} value={compact(a.lines)} unit="lines at HEAD" note={`${share(a.lines, total)} of all`} />)}>
                  {a.lines === most && <span className="type-micro tnum">{compact(a.lines)}</span>}
                  <span className="block w-full max-w-6 rounded-t-xs bg-heat-3 group-hover:bg-heat-4" style={{ height: `${Math.max(a.lines > 0 ? 2 : 0, (a.lines * 100) / most) * 0.82}%` }} />
                </span>
              ))}
            </div>
            <div className="flex gap-0.5 type-micro tnum" aria-hidden>
              {ages.map((a, i) => (
                <span key={a.key} className="min-w-0 flex-1 text-center whitespace-nowrap">
                  {label(i) ? a.short : ""}
                </span>
              ))}
            </div>
          </div>
        </ChartFrame>
      )}
    </Panel>
  );
}

function Line() {
  return (
    <span className="block h-5">
      <Skeleton height={14} width={220} radius={1} />
    </span>
  );
}

/** The Overview while its answers are fetched, in the shape of the screen they fill. */
export function OverviewSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <NumberStrip>
        {["commits", "people", "lines of code", "files", "of history", "active days"].map((l, i) => (
          <NumberCell key={l} id={l} value={<Skeleton height={29} width="55%" radius={2} index={i} />} label={l} note={<Skeleton height={13} width="70%" radius={1} index={i} />} />
        ))}
      </NumberStrip>
      <div className="grid gap-gutter @min-[58rem]:grid-cols-2">
        <SkeletonList title="Who built it" rows={CONTRIBUTORS_SHOWN} />
        <SkeletonList title="Where the work is" rows={LISTED} />
      </div>
      <Panel title="Commits over time" description={<Line />}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-1">
            <Skeleton height={240} index={3} />
            <div className="h-5" />
          </div>
          <div className="h-7" />
        </div>
      </Panel>
      <div className="grid items-start gap-gutter @min-[58rem]:grid-cols-2">
        <Panel title="Languages" description="Lines of code at HEAD">
          <div className="flex flex-col">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5 px-2 py-2">
                <div className="flex h-5 items-center justify-between">
                  <Skeleton height={14} width={`${25 + ((i * 17) % 25)}%`} radius={1} index={i} />
                  <Skeleton height={13} width={96} radius={1} index={i} />
                </div>
                <Skeleton height={6} radius={3} index={i} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="How old the code is" description={<Line />}>
          <Skeleton height={214} index={2} />
        </Panel>
      </div>
    </ScreenFrame>
  );
}

function SkeletonList({ title, rows }: { title: string; rows: number }) {
  return (
    <Panel padding={0} title={title} description={<Line />} className={FILL_PANEL}>
      <div className="h-13 @max-[40rem]:h-17.5" />
      <div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={`flex ${ROW_HEIGHT} items-center gap-3 border-t border-separator px-5`}>
            <Skeleton height={32} width={32} radius="rounded" index={i} />
            <span className="flex flex-1 flex-col gap-2">
              <Skeleton height={14} width={`${30 + ((i * 17) % 30)}%`} radius={1} index={i} />
              <Skeleton height={6} radius={3} index={i} />
            </span>
            <Skeleton height={14} width={64} radius={1} index={i} />
          </div>
        ))}
      </div>
      <div className="mt-auto box-content h-12 border-t border-separator" />
    </Panel>
  );
}
