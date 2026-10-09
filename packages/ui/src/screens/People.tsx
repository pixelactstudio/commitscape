import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Check, Copy, Folder, Trophy } from "lucide-react";
import { NOT_IN_REPORT, type PathCount, type People as Data, type Person, type PersonRow } from "@commitscape/data";
import { useData } from "../data";
import { WeekGrid } from "../charts/Grid";
import { useTip } from "../charts/tip";
import { COLOR, SERIES } from "../design/tokens";
import { YearGrid } from "../charts/Year";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { Name, Path, useStanding } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { personColour } from "../theme";
import { BarList, Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime, within } from "./kit";
import { folderOf, openers, type ScreenProps } from "./props";

type Column = {
  key: string;
  label: string;
  value: (r: PersonRow) => number | null;
  shown: (r: PersonRow) => ReactNode;
  why: string;
  wide?: boolean;
};

const dash = <span className="text-tertiary">—</span>;

const COLUMNS: Column[] = [
  { key: "commits", label: "Commits", value: (r) => r.commits, shown: (r) => grouped(r.commits), why: "Commits that are not merges." },
  { key: "days", label: "Active days", value: (r) => r.active_days, shown: (r) => grouped(r.active_days), why: "Days with at least one of their commits, on their own clock." },
  {
    key: "added",
    label: "Lines",
    value: (r) => r.lines_added,
    shown: (r) =>
      r.lines_added === null ? (
        dash
      ) : (
        <>
          <span className="text-added">+{compact(r.lines_added)}</span> <span className="text-removed">−{compact(r.lines_removed ?? 0)}</span>
        </>
      ),
    why: "Lines their commits added and removed, lockfiles and generated files left out.",
    wide: true,
  },
];

/** The people of a repository: the page's Standings first when it has them, everyone in the Window, and one person in full. */
export function People(props: ScreenProps & { extra?: ReactNode }) {
  if (props.route.id !== undefined) return <Profile {...props} id={props.route.id} />;
  return <Everyone {...props} />;
}

function Everyone({ meta, params, go, extra }: ScreenProps & { extra?: ReactNode }) {
  const { data, error, stale } = useData<Data>("/api/people", params);
  const [sort, setSort] = useState<{ key: string; down: boolean }>({ key: "commits", down: true });
  const [shown, setShown] = useState(50);
  const [suspects, setSuspects] = useState(8);
  const open = openers(go);
  if (error || !data) return <Failed words={error} />;
  const span = within(data.window);
  const columns = COLUMNS.filter((c) => data.people.some((r) => c.value(r) !== null));
  const column = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
  const rows = [...data.people].sort((a, b) => (column?.value(b) ?? -1) - (column?.value(a) ?? -1));
  if (!sort.down) rows.reverse();
  const most = Math.max(1, ...data.people.map((r) => r.commits));
  const commits = data.people.reduce((n, r) => n + r.commits, 0);
  const by = (key: string) => setSort((s) => (s.key === key ? { key, down: !s.down } : { key, down: true }));
  return (
    <ScreenFrame stale={stale}>
      {extra}
      <Panel
        padding={0}
        title={`Everyone ${span}`}
        description={`${data.people.length >= 1000 ? `The ${grouped(data.people.length)} with most commits` : many(data.people.length, "person", "people")}. No single score: each column is its own measure. Click a heading to sort, a name for what they did here.`}
      >
        {data.people.length === 0 ? (
          <div className="px-5 pb-5">
            <Quiet>Nobody committed in this Window. Choose a longer one above.</Quiet>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">People</caption>
              <thead>
                <tr className="text-xs text-secondary">
                  <th scope="col" className="sticky start-0 z-(--z-raised) bg-surface py-2 ps-5 pe-3 text-start font-medium">
                    Person
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.down ? "descending" : "ascending") : undefined} className={`px-3 py-2 text-end font-medium whitespace-nowrap ${c.wide ? "min-w-28" : ""}`}>
                      <button type="button" title={c.why} onClick={() => by(c.key)} className={`inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] ${sort.key === c.key ? "text-primary" : "text-secondary hover:text-primary"}`}>
                        {c.label}
                        {sort.key === c.key && (sort.down ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="hidden py-2 ps-3 pe-5 text-end font-medium whitespace-nowrap lg:table-cell">
                    First and last commit
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <PersonLine key={r.person.id} r={r} columns={columns} sortKey={sort.key} most={most} commits={commits} onOpen={open.person} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && (
          <div className="border-t border-line px-5 py-3">
            <Button label={`Show ${Math.min(100, rows.length - shown)} more of ${grouped(rows.length - shown)}`} variant="ghost" size="sm" onClick={() => setShown((n) => n + 100)} />
          </div>
        )}
        <div className="px-5 pb-4 empty:hidden">
          <Explain>
            <ul>
              {columns.map((c) => (
                <li key={c.key}>
                  <strong>{c.label}:</strong> {c.why}
                </li>
              ))}
            </ul>
            {meta.lines !== "counted" && <p className="m-0">Lines are {meta.lines === "counting" ? "being counted" : "not counted in this Report"}.</p>}
          </Explain>
        </div>
      </Panel>

      {(data.suspects.length > 0 || data.bots.length > 0) && (
        <div className="grid items-start gap-gutter lg:grid-cols-2">
          {data.suspects.length > 0 && (
            <Panel title="May be one person" description="Names that look alike but were not joined: nothing strong enough links them.">
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.suspects.slice(0, suspects).map((g) => (
                  <li key={g.map((p) => p.id).join("-")} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line px-3 py-2 text-sm">
                    {g.map((p) => (
                      <Name key={p.id} p={p} onOpen={open.person} />
                    ))}
                  </li>
                ))}
              </ul>
              {data.suspects.length > suspects && (
                <div>
                  <Button label={`Show ${grouped(data.suspects.length - suspects)} more`} variant="ghost" size="sm" onClick={() => setSuspects(data.suspects.length)} />
                </div>
              )}
              <Explain>To join them for good, add their lines to the repository's .mailmap: each person's page shows them.</Explain>
            </Panel>
          )}
          {data.bots.length > 0 && (
            <Panel title="Bots" description="Automation accounts, kept out of everyone else's numbers">
              <BarList
                label="Bots by commits"
                items={botsByName(data.bots).map((b) => ({
                  key: `${b.name}-${b.id}`,
                  label: b.accounts > 1 ? `${b.name} (${b.accounts} addresses)` : b.name,
                  lead: <Bot size={14} className="flex-none text-secondary" aria-hidden />,
                  value: b.commits,
                  shown: many(b.commits, "commit", "commits"),
                  colour: "var(--other)",
                  onClick: () => open.person(b.id),
                }))}
              />
            </Panel>
          )}
        </div>
      )}
    </ScreenFrame>
  );
}

function PersonLine({ r, columns, sortKey, most, commits, onOpen }: { r: PersonRow; columns: Column[]; sortKey: string; most: number; commits: number; onOpen: (id: number) => void }) {
  const login = useLogin(r.person);
  const standing = useStanding(login);
  return (
    <tr className="group border-t border-line transition-colors hover:bg-sunken">
      <td className="sticky start-0 z-(--z-raised) max-w-[15rem] min-w-[11rem] bg-surface py-2 ps-5 pe-3 group-hover:bg-[color-mix(in_srgb,var(--color-background-surface)_94%,var(--color-text-primary))]">
        <span className="flex min-w-0 items-center gap-2.5">
          <Face login={login} name={r.person.name} size={32} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <button type="button" onClick={() => onOpen(r.person.id)} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start font-[inherit] font-medium text-primary underline-offset-[3px] hover:underline">
                {r.person.name}
              </button>
              {standing && (
                <A href={standing} title={`Where ${r.person.name} stands here`} aria-label={`Where ${r.person.name} stands here`} className="flex-none text-secondary hover:text-brand">
                  <Trophy size={13} aria-hidden />
                </A>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="block h-1 w-16 overflow-hidden rounded-full bg-track" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(r.commits * 100) / most}%`, background: personColour(r.person.colour) }} />
              </span>
              <span className="truncate type-micro">
                {share(r.commits, commits)}
                {r.identities > 1 ? ` · ${r.identities} addresses` : ""}
              </span>
            </span>
          </span>
        </span>
      </td>
      {columns.map((c) => (
        <td key={c.key} className={`px-3 py-2 text-end whitespace-nowrap tnum ${sortKey === c.key ? "font-medium text-primary" : ""} ${c.wide ? "text-xs" : ""}`}>
          {c.value(r) === null ? dash : c.shown(r)}
        </td>
      ))}
      <td className="hidden py-2 ps-3 pe-5 text-end text-xs whitespace-nowrap text-secondary tnum lg:table-cell">
        {date(r.first)} – {date(r.last)}
      </td>
    </tr>
  );
}

function botsByName(bots: Data["bots"]): { name: string; id: number; commits: number; accounts: number }[] {
  const by = new Map<string, { name: string; id: number; commits: number; accounts: number }>();
  for (const b of bots) {
    const seen = by.get(b.person.name);
    if (seen) {
      seen.commits += b.commits;
      seen.accounts += 1;
    } else {
      by.set(b.person.name, { name: b.person.name, id: b.person.id, commits: b.commits, accounts: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.commits - a.commits);
}

const TRAITS: Record<string, string> = {
  same_name: "Joined because the addresses share a name.",
  same_account: "Joined because GitHub links the addresses to one account.",
  kept_apart: "A merge was undone here: these addresses are kept apart.",
  bot: "An automation account.",
};

function Profile({ params, go, id }: ScreenProps & { id: number }) {
  const { data: p, error, stale } = useData<Person>("/api/person", { ...params, id });
  const [copied, setCopied] = useState(false);
  const login = useLogin(p?.person);
  const standing = useStanding(login);
  const open = openers(go);
  if (error || !p)
    return (
      <Failed
        words={error === NOT_IN_REPORT ? "This Report keeps each Window's details for the people with most commits in it; this person is not among them here. Try All time, or another person." : error}
        action={<Button label="Everyone" variant="secondary" size="sm" icon={<Icon icon={ArrowLeft} size="sm" />} onClick={() => go({ id: undefined })} />}
      />
    );
  const r = p.row;
  const span = within(params.window === undefined ? "range" : String(params.window));
  const copy = () => void navigator.clipboard?.writeText(p.mailmap).then(() => setCopied(true));
  const total = p.days.reduce((a, b) => a + b, 0);
  return (
    <ScreenFrame stale={stale}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button label="Everyone" variant="ghost" size="sm" icon={<Icon icon={ArrowLeft} size="sm" />} onClick={() => go({ id: undefined })} />
      </div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Face login={login} name={p.person.name} size={64} ring={p.person.colour !== null ? personColour(p.person.colour) : undefined} />
          <div className="flex min-w-0 flex-col gap-1">
            <Heading level={2}>
              <span className="block truncate type-stat tracking-heading">{p.person.name}</span>
            </Heading>
            <p className="m-0 flex flex-wrap items-center gap-x-3 type-caption">
              {login && (
                <A href={`/u/${login}`} className="font-medium text-secondary no-underline hover:text-primary">
                  @{login}
                </A>
              )}
              {p.email && <span className="truncate">{p.email}</span>}
              <span>{span}</span>
            </p>
          </div>
        </div>
        {standing && <Button label="Their Standing here" variant="secondary" icon={<Icon icon={Trophy} size="sm" />} href={standing} />}
      </header>
      {r ? (
        <PersonNumbers r={r} streak={p.longest_streak} />
      ) : (
        <Quiet>No commits in this Window. Choose a longer one above.</Quiet>
      )}
      <Explain>
        The same measures as the People table, for this person alone; the longest streak is the most days in a row with a commit. — means not known: lines before they are counted, pull requests when GitHub knows no account for them.
      </Explain>

      <Panel title="Their days" description={`${many(total, "commit", "commits")} ${span}`}>
        {p.days.length > 120 && p.days.length <= 371 ? <YearGrid firstDay={p.first_day} days={p.days} unit="commits" label="Their commits a day" /> : <TrendOverTime firstDay={p.first_day} days={p.days} unit="commits" height={200} />}
      </Panel>
      <Panel title="Their week" description="Commits by weekday and hour, on their own clock">
        <div className="max-w-[54rem]">
          <WeekGrid week={p.week} />
        </div>
      </Panel>
      <WorkOn work={p.work} commits={r?.commits ?? 0} span={span} onFile={open.file} />
      {(p.areas.length > 0 || p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) && (
        <div className={`grid gap-gutter ${p.areas.length > 0 && (p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) ? "lg:grid-cols-2" : ""}`}>
          {p.areas.length > 0 && (
            <Panel title="Folders they hold" description="Folders where most commits are theirs: their share of each folder's commits" className="h-full [&>*]:h-full">
              <BarList
                label="Folders they hold"
                max={1}
                items={p.areas.map((a) => ({
                  key: a.folder,
                  label: <span className="font-mono">{a.folder}</span>,
                  lead: <Folder size={14} className="flex-none text-secondary" aria-hidden />,
                  value: a.theirs / Math.max(1, a.all),
                  shown: `${grouped(a.theirs)} of ${many(a.all, "commit", "commits")}`,
                  colour: personColour(p.person.colour),
                  onClick: () => open.folder(a.folder === "(root)" ? "" : a.folder),
                }))}
              />
            </Panel>
          )}
          {(p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) && (
            <Panel title="Who they are" description={p.addresses.length > 0 ? "The addresses joined into this person, and why" : "How their commits were joined into one person"} className="h-full [&>*]:h-full">
              {p.addresses.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {p.addresses.map((a) => (
                    <li key={a.email} className="flex items-center justify-between gap-3">
                      <Path path={a.email} />
                      <span className="flex-none text-xs text-secondary tnum">{many(a.commits, "commit", "commits")}</span>
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
                  <p className="m-0 type-description">To make this merge permanent for everyone, add these lines to the repository's .mailmap:</p>
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

const WORK_SHOWN = 10;
const FOLDERS_COLOURED = 5;

type WorkFolder = { path: string; files: number; commits: number; colour: string };

function foldersOf(work: PathCount[]): WorkFolder[] {
  const by = new Map<string, { files: number; commits: number }>();
  for (const w of work) {
    const f = folderOf(w.path);
    const seen = by.get(f) ?? { files: 0, commits: 0 };
    seen.files += 1;
    seen.commits += w.commits;
    by.set(f, seen);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].commits - a[1].commits || b[1].files - a[1].files)
    .map(([path, v], i) => ({ path, ...v, colour: i < FOLDERS_COLOURED ? (SERIES[i] ?? COLOR.other) : COLOR.other }));
}

function WorkOn({ work, commits, span, onFile }: { work: PathCount[]; commits: number; span: string; onFile: (path: string) => void }) {
  const tip = useTip();
  const [all, setAll] = useState(false);
  const folders = foldersOf(work);
  const colourOf = new Map(folders.map((f) => [f.path, f.colour]));
  const most = Math.max(1, ...work.map((w) => w.commits));
  const whole = Math.max(1, folders.reduce((n, f) => n + f.commits, 0));
  const named = folders.slice(0, FOLDERS_COLOURED);
  const rest = folders.slice(FOLDERS_COLOURED);
  const legend = [...named, ...(rest.length > 0 ? [{ path: `${many(rest.length, "other folder", "other folders")}`, files: rest.reduce((n, f) => n + f.files, 0), commits: rest.reduce((n, f) => n + f.commits, 0), colour: COLOR.other }] : [])];
  const shown = all ? work : work.slice(0, WORK_SHOWN);
  return (
    <Panel
      title="What they work on"
      description={work.length === 0 ? `No files changed ${span}` : `The ${work.length === 1 ? "file" : `${work.length} files`} they changed most ${span}, and the folders they sit in`}
    >
      {work.length === 0 ? (
        <Quiet>No files changed in this Window. Choose a longer one above.</Quiet>
      ) : (
        <div className="flex flex-col gap-stack">
          {folders.length > 1 && (
            <div className="flex flex-col gap-3">
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Their most changed files by folder">
                {legend.map((f) => (
                  <span
                    key={f.path}
                    className="block h-full min-w-1 transition-opacity hover:opacity-80"
                    style={{ width: `${(f.commits * 100) / whole}%`, background: f.colour }}
                    {...tip(
                      <>
                        <strong className="font-mono">{f.path || "the top folder"}</strong>
                        <div className="note">
                          {many(f.files, "file", "files")} of these · {share(f.commits, whole)} of their changes to them
                        </div>
                      </>,
                    )}
                  />
                ))}
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0" aria-label="Folders of these files">
                {legend.map((f) => (
                  <li key={f.path} className="flex min-w-0 max-w-full items-center gap-2 text-sm">
                    <span aria-hidden className="size-2.5 flex-none rounded-cell" style={{ background: f.colour }} />
                    <span className="truncate font-mono text-primary" title={f.path || "the top folder"}>
                      {f.path || "(root)"}
                    </span>
                    <span className="flex-none text-xs text-secondary tnum">{many(f.files, "file", "files")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ol className="m-0 grid list-none grid-cols-1 p-0 lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[repeat(var(--rows),auto)] lg:gap-x-8" style={{ "--rows": Math.ceil(shown.length / 2) } as CSSProperties} aria-label="Files they changed most">
            {shown.map((w, i) => (
              <WorkRow key={w.path} top={i === Math.ceil(shown.length / 2)} place={i + 1} path={w.path} value={w.commits} commits={commits} most={most} colour={colourOf.get(folderOf(w.path)) ?? COLOR.other} onOpen={onFile} />
            ))}
          </ol>
          {work.length > WORK_SHOWN && (
            <div>
              <Button label={all ? `Show the first ${WORK_SHOWN}` : `Show all ${work.length}`} variant="ghost" size="sm" onClick={() => setAll((a) => !a)} />
            </div>
          )}
        </div>
      )}
      <Explain>
        Each file's bar compares it with the file they changed most; beneath its commits is the share of all their commits {span} that changed it. The bar above sizes each folder by their commits to these files, so a commit that changed two of them counts twice. Lockfiles and generated files are left out.
      </Explain>
    </Panel>
  );
}

function WorkRow({ top, place, path, value, commits, most, colour, onOpen }: { top: boolean; place: number; path: string; value: number; commits: number; most: number; colour: string; onOpen: (path: string) => void }) {
  const folder = folderOf(path);
  const name = path.slice(folder.length);
  const part = value / most;
  return (
    <li className={`border-t border-line first:border-t-0 ${top ? "lg:border-t-0" : ""}`}>
      <button
        type="button"
        onClick={() => onOpen(path)}
        title={`${path}: open it on the Map`}
        className="grid w-full cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md border-0 bg-transparent px-2 py-2.5 text-start font-[inherit] transition-colors hover:bg-sunken sm:grid-cols-[1.25rem_minmax(0,1fr)_7rem_6rem]"
      >
        <span className="col-start-1 row-start-1 text-end type-micro tnum">{place}</span>
        <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="size-2.5 flex-none rounded-cell" style={{ background: colour }} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-sm font-medium text-primary">{name}</span>
            {folder && <span className="truncate font-mono type-micro">{folder}</span>}
          </span>
        </span>
        <span className="col-span-2 col-start-2 row-start-2 block h-1.5 overflow-hidden rounded-full bg-track sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, part * 100))}%`, background: colour }} />
        </span>
        <span className="col-start-3 row-start-1 flex flex-col items-end text-sm whitespace-nowrap tnum sm:col-start-4">
          <span className="font-medium text-primary">{many(value, "commit", "commits")}</span>
          {commits > 0 && <span className="type-micro">{share(value, commits)} of theirs</span>}
        </span>
      </button>
    </li>
  );
}

function PersonNumbers({ r, streak }: { r: PersonRow; streak: number | null }) {
  const cells: { id: string; value: string; label: string; note?: string }[] = [
    { id: "commits", value: grouped(r.commits), label: "commits", note: `${date(r.first)} – ${date(r.last)}` },
    { id: "days", value: grouped(r.active_days), label: "active days", note: `${share(r.active_days, Math.max(1, Math.round((r.last - r.first) / 86_400) + 1))} of the days in that span` },
    ...(streak !== null ? [{ id: "streak", value: many(streak, "day", "days"), label: "longest streak", note: "days in a row with a commit" }] : []),
    ...(r.lines_added !== null ? [{ id: "added", value: compact(r.lines_added), label: "lines added", note: `${compact(r.lines_removed ?? 0)} removed` }] : []),
  ];
  const columns = Math.min(7, Math.max(4, cells.length)) as 4 | 5 | 6 | 7;
  return (
    <NumberStrip columns={columns}>
      {cells.map((c) => (
        <NumberCell key={c.id} id={c.id} value={c.value} label={c.label} note={c.note} />
      ))}
    </NumberStrip>
  );
}
