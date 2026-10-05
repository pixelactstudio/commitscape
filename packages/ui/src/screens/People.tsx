import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Check, Copy, Trophy } from "lucide-react";
import { NOT_IN_REPORT, type People as Data, type Person, type PersonRow } from "@commitscape/data";
import { useData } from "../data";
import { WeekGrid } from "../charts/Grid";
import { YearGrid } from "../charts/Year";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { Name, Path, useStanding } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, githubWhy, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { personColour } from "../theme";
import { BarList, Failed, NumberCell, NumberStrip, Quiet, ScreenFrame, TrendOverTime, within } from "./kit";
import { openers, type ScreenProps } from "./props";

type Column = {
  key: string;
  label: string;
  value: (r: PersonRow) => number | null;
  shown: (r: PersonRow) => ReactNode;
  why: string;
  wide?: boolean;
};

function hoursWords(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function known(n: number | null, words: (n: number) => string = grouped): string {
  return n === null ? "—" : words(n);
}

const dash = <span className="text-[var(--color-text-disabled)]">—</span>;

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
  { key: "prs", label: "PRs merged", value: (r) => r.prs_merged, shown: (r) => known(r.prs_merged), why: "Their pull requests merged in the Window. — when GitHub knows no account for them." },
  { key: "reviews", label: "Reviews", value: (r) => r.reviews, shown: (r) => known(r.reviews), why: "Reviews they gave on others' pull requests." },
  { key: "hours", label: "Time to merge", value: (r) => r.hours_to_merge, shown: (r) => known(r.hours_to_merge, hoursWords), why: "From opening to merging, the middle of their merged pull requests." },
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
                  <th scope="col" className="sticky start-0 z-[1] bg-surface py-2 ps-5 pe-3 text-start font-medium">
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
            <p className="m-0">{meta.github_history === "complete" ? "— under pull requests means GitHub knows no account for the person." : githubWhy(meta.github, meta.github_history)}</p>
          </Explain>
        </div>
      </Panel>

      {(data.suspects.length > 0 || data.bots.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.suspects.length > 0 && (
            <Panel title="May be one person" description="Names that look alike but were not joined: nothing strong enough links them.">
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.suspects.map((g) => (
                  <li key={g.map((p) => p.id).join("-")} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-element)] border border-line px-3 py-2 text-sm">
                    {g.map((p) => (
                      <Name key={p.id} p={p} onOpen={open.person} />
                    ))}
                  </li>
                ))}
              </ul>
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
    <tr className="group border-t border-line transition-colors hover:bg-[var(--color-overlay-hover)]">
      <td className="sticky start-0 z-[1] max-w-[15rem] min-w-[11rem] bg-surface py-2 ps-5 pe-3 group-hover:bg-[color-mix(in_srgb,var(--color-background-surface)_94%,var(--color-text-primary))]">
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
              <span className="block h-1 w-16 overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(r.commits * 100) / most}%`, background: personColour(r.person.colour) }} />
              </span>
              <span className="truncate text-xs text-secondary">
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
          <Face login={login} name={p.person.name} size={64} />
          <div className="flex min-w-0 flex-col gap-1">
            <Heading level={2}>
              <span className="block truncate text-[1.6rem] leading-tight font-semibold tracking-[-0.025em]">{p.person.name}</span>
            </Heading>
            <p className="m-0 flex flex-wrap items-center gap-x-3 text-sm text-secondary">
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
      <div className={`grid items-start gap-4 ${p.areas.length > 0 || p.addresses.length > 0 || p.traits.length > 0 || p.mailmap ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" : ""}`}>
        <Panel title="What they work on" description="The files they changed most">
          {p.work.length === 0 ? (
            <Quiet>No files changed in this Window.</Quiet>
          ) : (
            <BarList
              label="Files they changed most"
              items={p.work.slice(0, 10).map((w) => ({
                key: w.path,
                label: <span className="font-mono text-[0.8rem]">{w.path}</span>,
                value: w.commits,
                shown: many(w.commits, "commit", "commits"),
                colour: personColour(p.person.colour),
                title: w.path,
                onClick: () => open.file(w.path),
              }))}
            />
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-4 empty:hidden">
        {p.areas.length > 0 && (
          <Panel title="Their folders" description="Their share of each folder's commits">
            <BarList
              label="Their folders"
              max={1}
              items={p.areas.map((a) => ({
                key: a.folder,
                label: <span className="font-mono text-[0.8rem]">{a.folder}</span>,
                value: a.theirs / Math.max(1, a.all),
                shown: `${grouped(a.theirs)} of ${many(a.all, "commit", "commits")}`,
                colour: personColour(p.person.colour),
                onClick: () => open.folder(a.folder === "(root)" ? "" : a.folder),
              }))}
            />
          </Panel>
        )}
        {(p.addresses.length > 0 || p.traits.length > 0 || p.mailmap) && (
          <Panel title="Who they are" description={p.addresses.length > 0 ? "The addresses joined into this person, and why" : "How their commits were joined into one person"}>
            {p.addresses.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {p.addresses.map((a) => (
                  <li key={a.email} className="flex items-center justify-between gap-3">
                    <Path path={a.email} />
                    <span className="flex-none text-xs text-secondary tnum">{many(a.commits, "commit", "commits")}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.traits.map((t) => (
              <p key={t} className="m-0 text-sm text-secondary">
                {TRAITS[t] ?? t}
              </p>
            ))}
            {p.mailmap && (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm text-secondary">To make this merge permanent for everyone, add these lines to the repository's .mailmap:</p>
                <pre className="m-0 overflow-auto rounded-[var(--radius-element)] border border-line bg-[var(--color-background-body)] p-3 font-mono text-[0.8rem]">{p.mailmap}</pre>
                <div>
                  <Button label={copied ? "Copied" : "Copy the .mailmap lines"} variant="secondary" size="sm" icon={<Icon icon={copied ? Check : Copy} size="sm" />} onClick={copy} />
                </div>
              </div>
            )}
            <Explain>Addresses are joined only on strong evidence: a .mailmap, the same GitHub account, or the same full name.</Explain>
          </Panel>
        )}
        </div>
      </div>
    </ScreenFrame>
  );
}

function PersonNumbers({ r, streak }: { r: PersonRow; streak: number | null }) {
  const cells: { id: string; value: string; label: string; note?: string }[] = [
    { id: "commits", value: grouped(r.commits), label: "commits", note: `${date(r.first)} – ${date(r.last)}` },
    { id: "days", value: grouped(r.active_days), label: "active days", note: `${share(r.active_days, Math.max(1, Math.round((r.last - r.first) / 86_400) + 1))} of the days in that span` },
    ...(streak !== null ? [{ id: "streak", value: many(streak, "day", "days"), label: "longest streak", note: "days in a row with a commit" }] : []),
    ...(r.lines_added !== null ? [{ id: "added", value: compact(r.lines_added), label: "lines added", note: `${compact(r.lines_removed ?? 0)} removed` }] : []),
    ...(r.prs_merged !== null ? [{ id: "prs", value: grouped(r.prs_merged), label: "PRs merged", note: r.hours_to_merge !== null ? `${hoursWords(r.hours_to_merge)} to merge, typically` : undefined }] : []),
    ...(r.reviews !== null ? [{ id: "reviews", value: grouped(r.reviews), label: "reviews given" }] : []),
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
