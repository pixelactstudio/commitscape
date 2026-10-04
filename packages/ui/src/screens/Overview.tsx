import { useContext } from "react";
import { Button } from "@astryxdesign/core/Button";
import { useSuspenseQueries } from "@tanstack/react-query";
import { ChevronRight, File, Folder, Trophy } from "lucide-react";
import type { MapBlock, MapLevel, Overview as Data, People, PersonRow } from "@commitscape/data";
import { dataQuery, StaleContext, useSource } from "../data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useStanding } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, duration, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { personColour } from "../theme";
import { BarList, Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime, within } from "./kit";
import { openers, type ScreenProps } from "./props";

export const CONTRIBUTORS_SHOWN = 8;
export const FOLDERS_SHOWN = 5;
export const LANGUAGES_SHOWN = 6;

/** The repository at a glance: its size and age, who built it, where the work is now, its languages, and how its commits fell over time. */
export function Overview({ params, go }: ScreenProps) {
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
  return (
    <ScreenFrame stale={stale}>
      <KeyNumbers o={o} span={span} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <WhoBuiltIt rows={people.data.data?.people ?? []} everyone={o.window === "all" ? o.totals.people : null} commits={o.commits} span={span} onPerson={open.person} onAll={() => go({ screen: "people", id: undefined })} />
        <div className="flex min-w-0 flex-col gap-4">
          <WhereWorkIs level={map.data.data} span={span} onOpen={(b) => (b.file ? open.file(b.path) : open.folder(b.path))} />
          <Languages o={o} />
        </div>
      </div>
      <Panel
        title="Commits over time"
        description={`${many(o.commits, "commit", "commits")} ${span}, merges left out`}
        actions={inWindow.length > 0 ? <span className="text-xs text-secondary">{many(inWindow.length, "release", "releases")}, newest {inWindow.at(-1)?.label}</span> : undefined}
      >
        {o.commits === 0 ? (
          <p className="m-0 grid h-[264px] place-items-center text-sm text-secondary">No commits in this Window. Choose a longer one above.</p>
        ) : (
          <TrendOverTime firstDay={o.first_day} days={o.days} unit="commits" releases={releases} />
        )}
        <Explain>Commits that are not merges, by the day they landed on their author's clock. The ticks beneath are releases: hover one for its name.</Explain>
      </Panel>
    </ScreenFrame>
  );
}

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

function WhoBuiltIt({ rows, everyone, commits, span, onPerson, onAll }: { rows: PersonRow[]; everyone: number | null; commits: number; span: string; onPerson: (id: number) => void; onAll: () => void }) {
  const people = everyone !== null && everyone > rows.length ? grouped(everyone) : counted(rows.length);
  const shown = rows.slice(0, CONTRIBUTORS_SHOWN);
  const lines = rows.some((r) => r.lines_added !== null);
  const most = Math.max(1, ...shown.map((r) => r.commits));
  return (
    <Panel padding={0} title="Who built it" description={rows.length === 0 ? `Nobody committed ${span}` : `${people} ${rows.length === 1 ? "person" : "people"} ${span}, most commits first`}>
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
        <span className="hidden text-xs text-secondary sm:inline">{lines ? "Lines leave out lockfiles and generated files" : "Click a name for what they did here"}</span>
        {rows.length > 0 && (
          <span className="ms-auto">
            <Button label={rows.length > CONTRIBUTORS_SHOWN ? `All ${people} people` : "People"} variant="ghost" size="sm" onClick={onAll} endContent={<ChevronRight size={14} aria-hidden />} />
          </span>
        )}
      </div>
    </Panel>
  );
}

function Contributor({ r, place, commits, most, lines, onPerson }: { r: PersonRow; place: number; commits: number; most: number; lines: boolean; onPerson: (id: number) => void }) {
  const login = useLogin(r.person);
  const standing = useStanding(login);
  return (
    <li className="flex h-[60px] items-center gap-3 border-t border-line px-5">
      <span className="w-4 flex-none text-end text-xs text-secondary tnum">{place}</span>
      <Face login={login} name={r.person.name} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <button type="button" onClick={() => onPerson(r.person.id)} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start font-[inherit] text-sm font-medium text-primary underline-offset-[3px] hover:underline">
            {r.person.name}
          </button>
          {login && <span className="hidden truncate text-xs text-secondary sm:inline">@{login}</span>}
        </span>
        <span className="block h-1 w-full max-w-72 overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${(r.commits * 100) / most}%`, background: personColour(r.person.colour) }} />
        </span>
      </span>
      <span className="flex w-14 flex-none flex-col items-end text-sm tnum sm:w-20">
        <span className="font-medium">{grouped(r.commits)}</span>
        <span className="text-xs text-secondary">
          {share(r.commits, commits)}
          <span className="hidden sm:inline"> of commits</span>
        </span>
      </span>
      {lines && (
        <span className="hidden w-24 flex-none flex-col items-end text-xs tnum sm:flex">
          {r.lines_added === null ? (
            <span className="text-[var(--color-text-disabled)]">—</span>
          ) : (
            <>
              <span className="text-added">+{compact(r.lines_added)}</span>
              <span className="text-removed">−{compact(r.lines_removed ?? 0)}</span>
            </>
          )}
        </span>
      )}
      {standing ? (
        <A href={standing} title={`Where ${r.person.name} stands here`} aria-label={`Where ${r.person.name} stands here`} className="grid size-8 flex-none place-items-center rounded-[var(--radius-element)] text-secondary transition-colors hover:bg-[var(--color-overlay-hover)] hover:text-primary">
          <Trophy size={15} aria-hidden />
        </A>
      ) : (
        <span className="hidden w-8 flex-none sm:block" aria-hidden />
      )}
    </li>
  );
}

function WhereWorkIs({ level, span, onOpen }: { level: MapLevel | null; span: string; onOpen: (b: MapBlock) => void }) {
  if (!level) return null;
  const busy = [...level.children].filter((b) => b.churn > 0).sort((a, b) => b.churn - a.churn);
  const all = level.children.reduce((n, b) => n + b.churn, 0);
  return (
    <Panel title="Where the work is" description={`The folders and files changed most ${span}`}>
      {busy.length === 0 ? (
        <Quiet>Nothing changed in this Window.</Quiet>
      ) : (
        <BarList
          label="Folders by commits"
          items={busy.slice(0, FOLDERS_SHOWN).map((b) => ({
            key: b.path,
            label: <span className="font-mono text-[0.82rem]">{b.file ? b.name : `${b.name}/`}</span>,
            lead: b.file ? <File size={14} className="flex-none text-secondary" aria-hidden /> : <Folder size={14} className="flex-none text-secondary" aria-hidden />,
            value: b.churn,
            colour: "var(--brand)",
            shown: (
              <span className="inline-flex items-center gap-1.5">
                {b.owner && <Owner p={b.owner} />}
                {many(b.churn, "commit", "commits")} · {share(b.churn, all)}
              </span>
            ),
            title: b.owner ? `Most commits by ${b.owner.name}` : undefined,
            onClick: () => onOpen(b),
          }))}
        />
      )}
      <Explain>Commits in the Window that touched each top folder, merges and bulk commits left out; a commit touching two folders counts in both. The face is who made most of them. Click one to open it on the Map.</Explain>
    </Panel>
  );
}

function Owner({ p }: { p: NonNullable<MapBlock["owner"]> }) {
  const login = useLogin(p);
  return <Face login={login} name={p.name} size={16} />;
}

function Languages({ o }: { o: Data }) {
  const total = Math.max(1, o.languages.reduce((n, l) => n + l.lines, 0));
  const named = o.languages.slice(0, LANGUAGES_SHOWN);
  const rest = o.languages.slice(LANGUAGES_SHOWN).reduce((n, l) => n + l.lines, 0);
  const parts = [...named.map((l, i) => ({ name: l.name, lines: l.lines, colour: `var(--s${i + 1})` })), ...(rest > 0 ? [{ name: "Other", lines: rest, colour: "var(--other)" }] : [])];
  return (
    <Panel title="Languages" description="Lines of code at HEAD">
      {parts.length === 0 ? (
        <Quiet>No code at HEAD in a language this tool knows.</Quiet>
      ) : (
        <div className="flex flex-col gap-4">
          <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {parts.map((p) => (
              <span key={p.name} className="block h-full min-w-[3px]" style={{ width: `${(p.lines * 100) / total}%`, background: p.colour }} />
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
