import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowLeft, Check, Copy, Folder, Trophy } from "lucide-react";
import { NOT_IN_REPORT, type PathCount, type Person, type PersonRow } from "@commitscape/data";
import { WeekGrid } from "../charts/Grid";
import { YearGrid } from "../charts/Year";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { useLogin } from "../components/login";
import { Path, useStanding } from "../components/Name";
import { useCounting, useData } from "../data";
import { Explain } from "../explain";
import { compact, date, grouped, many, share, within } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { Counting } from "../kit/pending";
import { personColour } from "../theme";
import { BarList, Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime } from "../screens/kit";
import { useReload } from "../screens/reload";
import { folderOf, openers, type ScreenProps } from "../screens/props";

const TRAITS: Record<string, string> = {
  same_name: "Joined because the addresses share a name.",
  same_account: "Joined because GitHub links the addresses to one account.",
  kept_apart: "A merge was undone here: these addresses are kept apart.",
  bot: "An automation account.",
};

const WORK_SHOWN = 10;

/** One person in full: their numbers, their days and week, the files they changed most, the folders they hold, and the addresses joined into them. */
export function Profile({ params, go, route, id }: ScreenProps & { id: number }) {
  const { data: p, error, stale } = useData<Person>("/api/person", { ...params, id });
  const reload = useReload();
  const [copied, setCopied] = useState(false);
  const login = useLogin(p?.person);
  const standing = useStanding(login);
  const open = openers(go, route);
  const heading = useRef<HTMLHeadingElement>(null);
  const arrived = p !== null;
  useEffect(() => {
    if (arrived && navigator.userActivation?.hasBeenActive && (document.activeElement === document.body || document.activeElement === null)) heading.current?.focus();
  }, [arrived, id]);
  const back = <Button label="Everyone" variant="ghost" size="sm" icon={<Icon icon={ArrowLeft} size="sm" />} onClick={() => go({ id: undefined })} />;
  if (error || !p) {
    const missing = error === NOT_IN_REPORT;
    return <Failed words={missing ? "This Report keeps each Window’s details for the people with most commits in it; this person is not among them here. Try All time, or another person." : error} retry={missing ? undefined : reload} action={back} />;
  }
  const r = p.row;
  const span = within(params.window === undefined ? "range" : String(params.window));
  const copy = () => void navigator.clipboard?.writeText(p.mailmap).then(() => setCopied(true));
  const total = p.days.reduce((a, b) => a + b, 0);
  const colour = personColour(p.person.colour);
  return (
    <ScreenFrame stale={stale}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        {standing && <Button label="Their Standing here" variant="secondary" size="sm" icon={<Icon icon={Trophy} size="sm" />} href={standing} />}
      </div>
      <div className="flex min-w-0 items-center gap-4">
        <Face login={login} name={p.person.name} size={64} ring={p.person.colour !== null ? colour : undefined} tint={colour} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 ref={heading} tabIndex={-1} className="m-0 truncate type-title outline-offset-4">
            <bdi>{p.person.name}</bdi>
          </h2>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 type-caption">
            {login && (
              <A href={`/u/${login}`} className="inline-link type-id">
                @{login}
              </A>
            )}
            {p.email && <span className="truncate">{p.email}</span>}
            <span>{span}</span>
          </p>
        </div>
      </div>
      {r ? <PersonNumbers r={r} streak={p.longest_streak} onCommits={() => open.commits({ who: id })} /> : <Quiet>No commits in this Window. Choose a longer one in the sidebar.</Quiet>}
      <Explain>The same measures as the People table, for this person alone; the longest streak is the most days in a row with a commit. A dash means not known: lines before they are counted.</Explain>

      <Panel title="Their days" description={`${many(total, "commit", "commits")} ${span}`}>
        {p.days.length > 120 && p.days.length <= 371 ? (
          <YearGrid firstDay={p.first_day} days={p.days} unit="commits" label="Their commits a day" onPick={(d) => open.commits({ who: id, since: d, until: d })} hint="Select for their commits that day" />
        ) : (
          <TrendOverTime firstDay={p.first_day} days={p.days} unit="commits" height={200} label="Their commits over time" onPick={(d) => open.commits({ who: id, ...d })} />
        )}
      </Panel>
      <Panel title="Their week" description="Commits by weekday and hour, on their own clock">
        <div className="max-w-5xl">
          <WeekGrid week={p.week} onPick={(w) => open.commits({ who: id, ...w })} />
        </div>
      </Panel>
      <WorkOn work={p.work} commits={r?.commits ?? 0} span={span} colour={colour} onFile={open.code} />
      {(p.areas.length > 0 || p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) && (
        <div className={`grid items-start gap-gutter ${p.areas.length > 0 && (p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) ? "@min-[62rem]:grid-cols-2" : ""}`}>
          {p.areas.length > 0 && (
            <Panel title="Folders they hold" description="Folders where most commits are theirs: their share of each folder’s commits">
              <BarList
                label="Folders they hold"
                max={1}
                items={p.areas.map((a) => ({
                  key: a.folder,
                  label: <span className="mono">{a.folder}</span>,
                  lead: <Folder size={ICON.sm} className="flex-none text-secondary" aria-hidden />,
                  value: a.theirs / Math.max(1, a.all),
                  shown: `${grouped(a.theirs)} of ${many(a.all, "commit", "commits")}`,
                  colour,
                  onClick: () => open.folder(a.folder === "(root)" ? "" : a.folder),
                }))}
              />
            </Panel>
          )}
          {(p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) && (
            <Panel title="Who they are" description={p.addresses.length > 0 ? "The addresses joined into this person, and why" : "How their commits were joined into one person"}>
              {p.addresses.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 type-ui">
                  {p.addresses.map((a) => (
                    <li key={a.email} className="flex items-center justify-between gap-3">
                      <Path path={a.email} />
                      <span className="flex-none type-caption tnum">{many(a.commits, "commit", "commits")}</span>
                    </li>
                  ))}
                </ul>
              )}
              {p.traits.map((t) => (
                <p key={t} className="m-0 type-description">
                  {TRAITS[t] ?? t}
                </p>
              ))}
              {p.mailmap && (
                <div className="flex flex-col gap-2">
                  <p className="m-0 type-description">To make this merge permanent for everyone, add these lines to the repository’s .mailmap:</p>
                  <pre className="m-0 overflow-auto rounded-md border border-line bg-sunken p-3 type-code">{p.mailmap}</pre>
                  <div>
                    <Button label={copied ? "Copied" : "Copy the .mailmap lines"} variant="secondary" size="sm" icon={<Icon icon={copied ? Check : Copy} size="sm" />} onClick={copy} />
                  </div>
                </div>
              )}
              <Explain>Addresses are joined only on strong evidence: a .mailmap, the same GitHub account, or the same full name.</Explain>
            </Panel>
          )}
        </div>
      )}
    </ScreenFrame>
  );
}

function WorkOn({ work, commits, span, colour, onFile }: { work: PathCount[]; commits: number; span: string; colour: string; onFile: (path: string) => void }) {
  const [all, setAll] = useState(false);
  const most = Math.max(1, ...work.map((w) => w.commits));
  const shown = all ? work : work.slice(0, WORK_SHOWN);
  return (
    <Panel title="What they work on" description={work.length === 0 ? `No files changed ${span}` : `The ${work.length === 1 ? "file" : `${grouped(work.length)} files`} they changed most ${span}; open one in the Code window`}>
      {work.length === 0 ? (
        <Quiet>No files changed in this Window. Choose a longer one in the sidebar.</Quiet>
      ) : (
        <div className="flex flex-col gap-stack">
          <ol className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 @min-[62rem]:grid-cols-2" aria-label="Files they changed most">
            {shown.map((w, i) => (
              <WorkRow key={w.path} place={i + 1} path={w.path} value={w.commits} commits={commits} most={most} colour={colour} onOpen={onFile} />
            ))}
          </ol>
          {work.length > WORK_SHOWN && (
            <div>
              <Button label={all ? `Show the first ${WORK_SHOWN}` : `Show all ${grouped(work.length)}`} variant="ghost" size="sm" onClick={() => setAll((a) => !a)} />
            </div>
          )}
        </div>
      )}
      <Explain>Each file’s bar compares it with the file they changed most; beneath its commits is the share of all their commits {span} that changed it. Lockfiles and generated files are left out.</Explain>
    </Panel>
  );
}

function WorkRow({ place, path, value, commits, most, colour, onOpen }: { place: number; path: string; value: number; commits: number; most: number; colour: string; onOpen: (path: string) => void }) {
  const folder = folderOf(path);
  const name = path.slice(folder.length);
  return (
    <li>
      <button type="button" onClick={() => onOpen(path)} title={`${path}: open it in the Code window`} className="plain-button row-hover grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-2.5">
        <span className="text-end type-caption tnum">{place}</span>
        <span className="flex min-w-0 flex-col">
          <span className="mono truncate type-ui font-medium text-primary">{name}</span>
          {folder && <span className="mono truncate type-caption">{folder}</span>}
        </span>
        <span className="flex flex-col items-end type-ui whitespace-nowrap tnum">
          <span className="font-medium text-primary">{many(value, "commit", "commits")}</span>
          {commits > 0 && <span className="type-caption">{share(value, commits)} of theirs</span>}
        </span>
        <span className="col-span-2 col-start-2 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (value * 100) / most))}%`, background: colour }} />
        </span>
      </button>
    </li>
  );
}

function PersonNumbers({ r, streak, onCommits }: { r: PersonRow; streak: number | null; onCommits: () => void }) {
  const counting = useCounting();
  const cells: { id: string; value: ReactNode; label: string; note?: ReactNode }[] = [
    {
      id: "commits",
      value: (
        <button type="button" onClick={onCommits} title="Their commits" className="plain-button hover:underline hover:decoration-line-strong hover:underline-offset-4">
          {grouped(r.commits)}
        </button>
      ),
      label: "commits",
      note: `${date(r.first)} – ${date(r.last)}`,
    },
    { id: "days", value: grouped(r.active_days), label: "active days", note: `${share(r.active_days, Math.max(1, Math.round((r.last - r.first) / 86_400) + 1))} of the days in that span` },
    ...(streak !== null ? [{ id: "streak", value: many(streak, "day", "days"), label: "longest streak", note: "days in a row with a commit" }] : []),
    ...(r.lines_added !== null
      ? [{ id: "added", value: compact(r.lines_added), label: "lines added", note: `${compact(r.lines_removed ?? 0)} removed` }]
      : counting
        ? [{ id: "added", value: <Counting width={88} height={24} />, label: "lines added", note: <Counting width={72} height={12} index={1} /> }]
        : []),
  ];
  return (
    <NumberStrip>
      {cells.map((c) => (
        <NumberCell key={c.id} id={c.id} value={c.value} label={c.label} note={c.note} />
      ))}
    </NumberStrip>
  );
}
