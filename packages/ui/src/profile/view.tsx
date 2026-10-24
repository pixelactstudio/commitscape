import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Award, Building2, CalendarDays, Eye, Lock, MapPin, Play, Swords, Users } from "lucide-react";
import type { Archetype, EngineRepo, EngineView, Identity, Profile, ProfileRepo, UnreadRepo } from "@commitscape/data";
import { avatarUrl } from "../components/avatar";
import { Face } from "../components/Face";
import { compact, grouped, many } from "../format";
import { A } from "../kit/A";
import { ICON } from "../design/tokens";
import { AddedRemoved, Chip, Eyebrow, LangDot, Meter, Page, Panel, Stat } from "../kit/layout";
import { CountUp, Nothing } from "../motion";
import { Cell } from "./cell";
import { StreakCell } from "./streak";
import { coverage, survival, type Coverage } from "./survival";
import { ARCHETYPE_ICONS } from "./icons";

export { Cell } from "./cell";
export { CommitClock } from "./clock";
export { LanguagesOverTime } from "./languages";
export { StreakCell } from "./streak";
export { AchievementsPanel, ArchetypePanel, TraitsPanel } from "./traits";
export { LastYear } from "./year";
export { OverTheYears } from "./years";

export function hours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function joined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** A person's face, name, Archetype and what GitHub says of them, over a glow made from their own avatar. */
export function ProfileHeader({ identity, archetype, also = [], badges, actions }: { identity: Identity; archetype?: Archetype | null; also?: string[]; badges?: ReactNode; actions?: ReactNode }) {
  const name = identity.name ?? identity.login;
  const facts: [typeof MapPin, string][] = [
    ...(identity.company ? [[Building2, identity.company] as [typeof MapPin, string]] : []),
    ...(identity.location ? [[MapPin, identity.location] as [typeof MapPin, string]] : []),
    [CalendarDays, `Joined GitHub ${joined(identity.createdAt)}`],
    ...(identity.followers > 0 ? [[Users, many(identity.followers, "follower", "followers")] as [typeof MapPin, string]] : []),
  ];
  return (
    <section className="face-backdrop relative overflow-hidden border-b border-line" style={{ "--face": `url(${avatarUrl(identity.login, 64)})` } as CSSProperties}>
      <Page className="relative flex flex-col gap-6 pt-page-top pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
          <Face login={identity.login} name={name} size={96} wide={112} edge="body" lift="md" className="self-start sm:self-center" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="m-0 type-display">{name}</h1>
              {archetype && <ArchetypePill archetype={archetype} also={also} />}
              {badges}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 type-caption">
              <a href={`https://github.com/${identity.login}`} className="font-medium text-secondary no-underline hover:text-primary">
                @{identity.login}
              </a>
              {facts.map(([Glyph, text]) => (
                <span key={text} className="inline-flex items-center gap-1.5">
                  <Glyph size={ICON.sm} aria-hidden />
                  {text}
                </span>
              ))}
            </div>
            {identity.bio && <p className="m-0 max-w-2xl text-md text-pretty text-primary">{identity.bio}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-cluster">{actions}</div>}
      </Page>
    </section>
  );
}

/** A person's Archetype as a small label, its rule on hover. */
export function ArchetypePill({ archetype, also }: { archetype: Archetype; also: string[] }) {
  const Glyph = ARCHETYPE_ICONS[archetype.id] ?? Award;
  return (
    <HoverCard
      label={`Archetype: ${archetype.title}`}
      placement="below"
      content={
        <div className="flex max-w-72 flex-col gap-1.5 p-1">
          <Eyebrow>Archetype, by a written rule</Eyebrow>
          <strong className="type-panel">{archetype.title}</strong>
          <span className="type-caption">{archetype.rule}</span>
          {also.length > 0 && <span className="type-micro">Also: {also.join(", ")}</span>}
        </div>
      }
    >
      <button type="button" className="archetype-pill inline-flex h-7 cursor-help items-center gap-1.5 rounded-full px-3 text-sm font-semibold">
        <Glyph size={ICON.sm} aria-hidden />
        {archetype.title}
      </button>
    </HoverCard>
  );
}

const counted = (n: number) => <CountUp value={n} format={grouped} />;

/** The headline numbers: four large, each saying what it counts, and four smaller beneath ending with the streak; the slower ones arrive in their own slots. */
export function HeadlineNumbers({ profile, surviving, slow }: { profile: Profile; surviving: ReactNode; slow: ReactNode }) {
  const t = profile.totals;
  const rate = t.prsOpened > 0 ? t.prsMerged / t.prsOpened : 0;
  return (
    <div className="grid overflow-hidden surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <Cell reserve>
          <Stat size="lg" value={counted(t.prsMerged)} label="Pull requests merged" note={t.prsOpened > 0 ? `${Math.round(rate * 100)}% of ${grouped(t.prsOpened)} opened` : "none opened yet"}>
            <Meter value={rate} label="Share of pull requests merged" className="mt-1 max-w-40" />
          </Stat>
        </Cell>
        <Cell reserve>
          <Stat size="lg" value={counted(t.reviews)} label="Reviews given" note="on other people’s pull requests" />
        </Cell>
        <Cell reserve>{surviving}</Cell>
        <Cell reserve>
          <Stat size="lg" value={counted(t.commits)} label="Commits" note={profile.privateWork ? privateNote(profile.privateWork) : t.hidden > 0 ? `with ${grouped(t.hidden)} private contributions` : "as GitHub counts them"} />
        </Cell>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-4">
        {slow}
        <Cell small bare reserve>
          <Stat size="sm" value={grouped(t.activeDays)} label="Active days" note={`${many(t.contributions, "contribution", "contributions")} in all`} />
        </Cell>
        <Cell small bare reserve>
          <StreakCell profile={profile} />
        </Cell>
      </div>
    </div>
  );
}

function privateNote(w: NonNullable<Profile["privateWork"]>): string {
  const parts = [w.commits > 0 ? many(w.commits, "commit", "commits") : null, w.prsMerged > 0 ? many(w.prsMerged, "merged pull request", "merged pull requests") : null].filter(Boolean);
  const where = many(w.repositories, "private repository", "private repositories");
  return parts.length > 0 ? `plus ${parts.join(" and ")} in ${where} they show` : `and ${where} they show`;
}

/** The two headline numbers that need a person's pull requests read. */
export function PullRequestNumbers({ profile }: { profile: Profile }) {
  const t = profile.totals;
  const capped = profile.read.prs < profile.read.prsTotal;
  const none = t.linesAdded !== null && t.linesAdded + (t.linesRemoved ?? 0) === 0;
  return (
    <>
      <Cell small bare reserve>
        <Stat size="sm" value={t.linesAdded === null || none ? "—" : <span className="tnum whitespace-nowrap">+{compact(t.linesAdded)} <span className="text-secondary">/</span> −{compact(t.linesRemoved ?? 0)}</span>} label="Lines merged" note={none ? "no merged pull requests yet" : t.linesAdded === null ? "their pull requests are not read yet" : capped ? `in the newest ${grouped(profile.read.prs)} pull requests` : "added and removed in merged pull requests"}>
          {t.linesAdded !== null && !none && <AddedRemoved added={t.linesAdded} removed={t.linesRemoved ?? 0} className="mt-1 max-w-40" />}
        </Stat>
      </Cell>
      <Cell small bare reserve>
        <Stat size="sm" value={t.hoursToMerge === null ? "—" : hours(t.hoursToMerge)} label="Time to merge" note="their middle pull request" />
      </Cell>
    </>
  );
}

function coveredWords(c: Coverage): string {
  const of = c.repositories === null ? many(c.counted.length, "repository", "repositories") : `${grouped(c.counted.length)} of ${many(c.repositories, "repository", "repositories")}`;
  return `in ${of} they committed to`;
}

/** The headline Surviving Lines: only ever the sum of the repositories counted so far, saying how many of theirs that is. */
export function SurvivingNumber({ engine, suggest }: { engine: EngineView; suggest?: string | null }) {
  const c = coverage(engine);
  const label = "Lines that still run";
  const more = (
    <a href="#survived" className="w-fit text-xs font-medium text-brand no-underline hover:underline">
      {c.total === null ? "See which repositories" : "See what it covers"} →
    </a>
  );
  if (c.total === null && c.busy)
    return (
      <Stat size="lg" value={<span className="inline-flex items-center gap-2 text-secondary"><Spinner size="sm" /> <span className="type-stat-sm">Counting</span></span>} label={label} note={`${many(c.waiting.length + c.unread.filter((r) => r.state === "reading").length, "repository", "repositories")} being read or counted`}>
        {more}
      </Stat>
    );
  if (c.total === null)
    return (
      <Stat size="lg" value={<span className="text-secondary">—</span>} label={label} note={c.repositories ? `none of their ${many(c.repositories, "repository", "repositories")} read yet` : "no repository of theirs read here yet"}>
        {c.unread.length > 0 ? more : suggest ? (
          <A href={`/gh/${suggest}`} className="w-fit text-xs font-medium text-brand no-underline hover:underline">
            Read {suggest} to count them →
          </A>
        ) : null}
      </Stat>
    );
  return (
    <Stat size="lg" tone="brand" value={compact(c.total)} label={label} note={coveredWords(c)}>
      {more}
    </Stat>
  );
}

type Row = { owner: string; name: string; colour: string | null; language: string | null; stars: number; private: boolean; prsMerged: number; commits: number; reviews: number; linesAdded: number; linesRemoved: number; engine: EngineRepo | null; unread: UnreadRepo | null };

const PAGE = 12;
const ROW = "h-14";

function rowsOf(repos: ProfileRepo[], engine: EngineView | null): Row[] {
  const byName = new Map((engine?.repos ?? []).map((e) => [`${e.owner}/${e.name}`.toLowerCase(), e]));
  const unread = new Map((engine?.unread ?? []).map((u) => [`${u.owner}/${u.name}`.toLowerCase(), u]));
  const rows: Row[] = repos.map((r) => {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    const e = byName.get(key) ?? null;
    byName.delete(key);
    return { ...r, engine: e, unread: unread.get(key) ?? null };
  });
  for (const e of byName.values()) rows.push({ owner: e.owner, name: e.name, colour: null, language: null, stars: 0, private: e.private, prsMerged: 0, commits: e.commits, reviews: 0, linesAdded: e.linesAdded ?? 0, linesRemoved: e.linesRemoved ?? 0, engine: e, unread: null });
  return rows;
}

const quiet = <span className="text-tertiary">—</span>;

/** Where a person's work is: each repository with their pull requests, commits, reviews and lines, and their lines still running where commitscape has read it; each opens their Standing there. */
export function RepositoryTable({ profile, engine }: { profile: Profile; engine: EngineView | null }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => rowsOf(profile.repositories, engine), [profile.repositories, engine]);
  const filtered = query ? rows.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(query.toLowerCase())) : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const at = Math.min(page, pages);
  const shown = filtered.slice((at - 1) * PAGE, at * PAGE);
  const fill = rows.length > PAGE ? PAGE - shown.length : 0;
  const most = Math.max(1, ...rows.map((r) => r.prsMerged * 4 + r.commits + r.reviews));
  const login = profile.identity.login;
  return (
    <Panel
      padding={0}
      title="Where their work is"
      description={`${many(rows.length, "repository", "repositories")}, by merged pull requests, then commits and reviews. Open one to see where they stand in it.`}
      actions={
        rows.length > PAGE ? (
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Find a repository"
            aria-label="Find a repository"
            className="h-8 w-48 max-w-full rounded-md border border-strong bg-body px-2.5 text-base text-primary placeholder:text-tertiary sm:text-xs"
          />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="px-panel pb-panel">
          <Nothing title="No public work on GitHub yet" words="Repositories they commit to, open pull requests in or review show up here." compact />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="type-caption">
                <th className="py-2 ps-5 pe-3 text-start font-medium">Repository</th>
                <th className="w-px whitespace-nowrap px-3 py-2 text-end font-medium">Merged PRs</th>
                <th className="hidden w-px whitespace-nowrap px-3 py-2 text-end font-medium sm:table-cell">Commits</th>
                <th className="hidden w-px whitespace-nowrap px-3 py-2 text-end font-medium sm:table-cell">Reviews</th>
                <th className="hidden w-px whitespace-nowrap px-3 py-2 text-end font-medium md:table-cell">Lines merged</th>
                <th className="w-px whitespace-nowrap py-2 ps-3 pe-5 text-end font-medium">Still running</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RepoRow key={`${r.owner}/${r.name}`} r={r} login={login} weight={(r.prsMerged * 4 + r.commits + r.reviews) / most} />
              ))}
              {shown.length === 0 && (
                <tr className={`border-t border-line ${ROW}`}>
                  <td colSpan={6} className="px-5 text-center type-caption">
                    No repository of theirs has “{query}” in its name.
                  </td>
                </tr>
              )}
              {Array.from({ length: Math.max(0, fill - (shown.length === 0 ? 1 : 0)) }, (_, i) => (
                <tr key={`fill${i}`} aria-hidden className={ROW}>
                  <td colSpan={6} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 || profile.totals.hidden > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-3">
          {pages > 1 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Pagination page={at} onChange={setPage} totalItems={filtered.length} pageSize={PAGE} size="sm" siblingCount={1} label="Pages of repositories" />
              <span className="type-caption tnum">
                {grouped((at - 1) * PAGE + 1)}–{grouped(Math.min(filtered.length, at * PAGE))} of {grouped(filtered.length)}
              </span>
            </div>
          ) : (
            <span />
          )}
          {profile.totals.hidden > 0 && (
            <span className="inline-flex items-center gap-1.5 type-caption">
              <Lock size={ICON.xs} aria-hidden /> {many(profile.totals.hidden, "private contribution", "private contributions")} counted in the totals, never named
            </span>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function RepoRow({ r, login, weight }: { r: Row; login: string; weight: number }) {
  const n = (v: number) => (v > 0 ? grouped(v) : quiet);
  return (
    <tr className={`group border-t border-line transition-colors hover:bg-hover ${ROW}`}>
      <td className="max-w-0 py-2 ps-5 pe-3">
        <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-3 text-primary no-underline">
          <Face login={r.owner} name={r.owner} size={32} shape="rounded" className="max-sm:hidden" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="leading-snug font-medium [overflow-wrap:anywhere]">
              <span className="text-secondary max-sm:hidden">{r.owner}/</span>
              {r.name}
            </span>
            <span className="flex items-center gap-3 type-caption">
              <span className="min-w-0 [overflow-wrap:anywhere] sm:hidden">{r.owner}</span>
              {r.language && (
                <span className="inline-flex items-center gap-1.5 max-sm:hidden">
                  <LangDot colour={r.colour} />
                  {r.language}
                </span>
              )}
              {r.stars > 0 && <span className="whitespace-nowrap max-sm:hidden">★ {compact(r.stars)}</span>}
              {r.private && (
                <span className="inline-flex items-center gap-1">
                  <Lock size={ICON.xs} aria-hidden /> only you see this
                </span>
              )}
              <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-(--color-track) lg:inline-block" aria-hidden>
                <span className="block h-full rounded-full bg-tertiary" style={{ width: `${Math.max(4, weight * 100)}%` }} />
              </span>
            </span>
          </span>
        </A>
      </td>
      <td className="px-3 py-2 text-end tnum">{n(r.prsMerged)}</td>
      <td className="hidden px-3 py-2 text-end tnum sm:table-cell">{n(r.commits)}</td>
      <td className="hidden px-3 py-2 text-end tnum sm:table-cell">{n(r.reviews)}</td>
      <td className="hidden px-3 py-2 text-end text-xs whitespace-nowrap tnum md:table-cell">
        {r.linesAdded + r.linesRemoved > 0 ? (
          <>
            <span className="text-added">+{compact(r.linesAdded)}</span> <span className="text-removed">−{compact(r.linesRemoved)}</span>
          </>
        ) : (
          quiet
        )}
      </td>
      <td className="py-2 ps-3 pe-5 text-end tnum">
        <SurvivingCell repo={r.engine} unread={r.unread} />
      </td>
    </tr>
  );
}

const UNREAD_WORDS: Record<UnreadRepo["state"], string> = {
  not_read: "not read yet",
  reading: "reading",
  failed: "could not be read",
  not_in_it: "none of theirs found",
};

const COUNT_WORDS: Partial<Record<EngineRepo["surviving"]["status"], string>> = {
  failed: "could not count",
  over_budget: "too big to count here",
  not_counted: "read without lines",
  stale: "read again soon",
};

function SurvivingCell({ repo, unread }: { repo: EngineRepo | null; unread?: UnreadRepo | null }) {
  if (!repo) {
    if (unread?.state === "reading")
      return (
        <span className="inline-flex items-center gap-1.5 type-caption">
          <Spinner size="sm" /> reading
        </span>
      );
    return <span className="type-caption text-tertiary" title={unread ? UNREAD_WORDS[unread.state] : "commitscape has not read this repository’s history yet"}>{unread ? UNREAD_WORDS[unread.state] : "—"}</span>;
  }
  const s = repo.surviving;
  if (s.status === "counted" && s.lines !== null) return <span className="font-medium text-brand">{compact(s.lines)}</span>;
  if (s.status !== "counting") return <span className="type-caption">{COUNT_WORDS[s.status] ?? "not counted"}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 type-caption">
      <Spinner size="sm" /> counting
    </span>
  );
}

const UNREAD_PAGE = 6;

type Waiting = { key: string; owner: string; name: string; commits: number; words: string; busy: boolean; unread: UnreadRepo | null };

function waitingOf(c: Coverage): Waiting[] {
  return [
    ...c.waiting.map((r) => ({ key: `${r.owner}/${r.name}`, owner: r.owner, name: r.name, commits: r.commits, words: r.surviving.status === "counting" ? "counting" : (COUNT_WORDS[r.surviving.status] ?? "not counted"), busy: r.surviving.status === "counting", unread: null })),
    ...c.unread.map((r) => ({ key: `${r.owner}/${r.name}`, owner: r.owner, name: r.name, commits: r.commits, words: r.state === "failed" && r.reason ? `${UNREAD_WORDS.failed}: ${FAILURE_SHORT[r.reason]}` : r.private && r.state === "not_read" ? "private: open it to connect" : UNREAD_WORDS[r.state], busy: r.state === "reading", unread: r })),
  ];
}

/** Lines that still run, repository by repository: one number a row, the rest behind an eye; the total is the sum of the counted rows listed, and every other repository they committed to waits beneath it, with a way to read it. */
export function SurvivalPanel({ engine, login, onRead }: { engine: EngineView; login: string; onRead?: (repos: { owner: string; name: string }[]) => Promise<unknown> }) {
  const c = coverage(engine);
  const [open, setOpen] = useState<EngineRepo | null>(null);
  const [all, setAll] = useState(false);
  if (engine.repos.length === 0 && c.unread.length === 0) return null;
  const counted = [...c.counted].sort((a, b) => (b.surviving.lines ?? 0) - (a.surviving.lines ?? 0));
  const most = Math.max(1, ...counted.map((r) => r.surviving.lines ?? 0));
  const share = survival(c.total, c.added);
  const waiting = waitingOf(c);
  const readable = c.unread.filter((r) => r.canRead);
  const reading = c.unread.filter((r) => r.state === "reading").length;
  const counting = c.waiting.filter((r) => r.surviving.status === "counting").length;
  const next = readable.slice(0, 5);
  const readNext = onRead && next.length > 0 ? <ReadButton onClick={() => onRead(next.map((r) => ({ owner: r.owner, name: r.name })))} name={next.map((r) => `${r.owner}/${r.name}`).join(", ")} label={next.length === 1 ? `Read ${next[0]?.name}` : `Read the next ${next.length}`} /> : null;
  return (
    <Panel
      title="Code that survived"
      description="Lines of theirs still at the head of each repository commitscape has read, under every address they commit with. Reformats and generated files are left out, and a repository counts once it is read and counted."
      actions={
        c.busy ? (
          <Chip tone="brand" icon={<Spinner size="sm" />}>
            {[counting > 0 && `counting ${grouped(counting)}`, reading > 0 && `reading ${grouped(reading)}`].filter(Boolean).join(", ")}; updates by itself
          </Chip>
        ) : null
      }
    >
      <div className="flex flex-col gap-stack">
        <div className="grid grid-cols-1 items-end gap-x-10 gap-y-4 border-b border-line pb-stack md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`type-stat-lg ${c.total === null ? "text-secondary" : "text-brand"}`}>{c.total === null ? "—" : compact(c.total)}</span>
              <span className="type-label">lines still running</span>
            </span>
            <span className="type-caption">
              {c.total === null ? (c.busy ? "None counted yet; the first arrive in a few minutes." : "No repository of theirs counted yet.") : `The sum of the ${many(c.counted.length, "repository", "repositories")} below${share ? `: ${share} of the ${compact(c.added ?? 0)} lines they added there` : ""}.`}
            </span>
          </div>
          <CoverageBar c={c} />
        </div>
        {counted.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-label">In the total</span>
              <span className="type-micro">lines still running, most first</span>
            </div>
            <ol className="m-0 grid min-w-0 list-none grid-cols-1 gap-x-8 p-0 lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[repeat(var(--rows),auto)]" style={{ "--rows": Math.ceil(counted.length / 2) } as CSSProperties}>
              {counted.map((r, i) => (
                <SurvivalRow key={`${r.owner}/${r.name}`} r={r} place={i + 1} most={most} onOpen={() => setOpen(r)} />
              ))}
            </ol>
          </div>
        )}
        {waiting.length > 0 && (
          <div className={`flex flex-col gap-3 ${counted.length > 0 ? "border-t border-line pt-stack" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label">Not in the total yet</span>
                <span className="type-caption">{many(waiting.length, "repository", "repositories")} they committed to that commitscape has not counted. Each joins the total once it is read and counted.</span>
              </div>
              {readNext}
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {waiting.slice(0, UNREAD_PAGE).map((w) => (
                <WaitingChip key={w.key} w={w} login={login} />
              ))}
              {waiting.length > UNREAD_PAGE && (
                <li>
                  <button type="button" onClick={() => setAll(true)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-primary transition-colors hover:bg-hover">
                    <Eye size={ICON.xs} aria-hidden />
                    See all {grouped(waiting.length)}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {open && <SurvivalDialog r={open} login={login} onClose={() => setOpen(null)} />}
      {all && (
        <Dialog isOpen={all} onOpenChange={setAll} width="min(640px, 96vw)" maxHeight="85dvh" padding={5}>
          <DialogHeader title="Not in the total yet" subtitle={`${many(waiting.length, "repository", "repositories")} they committed to, by their commits there`} onOpenChange={setAll} />
          <div className="flex flex-col gap-3 pt-2">
            {readNext && <div>{readNext}</div>}
            <ul className="m-0 flex list-none flex-col p-0">
              {[...waiting].sort((a, b) => b.commits - a.commits).map((w) => (
                <WaitingRow key={w.key} w={w} login={login} onRead={onRead} />
              ))}
            </ul>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

function CoverageBar({ c }: { c: Coverage }) {
  if (c.repositories === null || c.repositories === 0) return null;
  const parts = [
    { n: c.counted.length, colour: "bg-brand", word: "counted" },
    { n: c.waiting.length, colour: "bg-brand-line", word: "read, counting or not countable" },
    { n: c.unread.length, colour: "bg-(--color-track)", word: "not read" },
  ].filter((p) => p.n > 0);
  return (
    <div className="flex flex-col gap-2">
      <span role="img" aria-label={parts.map((p) => `${p.n} ${p.word}`).join(", ")} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.word} className={`block h-full min-w-1 ${p.colour}`} style={{ flexGrow: p.n }} />
        ))}
      </span>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-0.5 p-0 type-caption">
        {parts.map((p) => (
          <li key={p.word} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${p.colour}`} aria-hidden />
            <span className="tnum font-medium text-primary">{grouped(p.n)}</span> {p.word}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SurvivalRow({ r, place, most, onOpen }: { r: EngineRepo; place: number; most: number; onOpen: () => void }) {
  const lines = r.surviving.lines ?? 0;
  const rate = survival(r.surviving.lines, r.surviving.added);
  return (
    <li className="group flex h-12 items-center gap-3 border-b border-line">
      <span className="w-5 flex-none text-end type-micro tnum">{place}</span>
      <Face login={r.owner} name={r.owner} size={24} shape="rounded" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">
          <span className="text-secondary max-sm:hidden">{r.owner}/</span>
          {r.name}
        </span>
        <span className="block h-1 w-full overflow-hidden rounded-full bg-(--color-track)" aria-hidden>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(1.5, (lines * 100) / most)}%` }} />
        </span>
      </span>
      <span className="flex w-16 flex-none flex-col items-end tnum">
        <span className="text-sm font-semibold text-primary" title={`${grouped(lines)} lines still running`}>
          {compact(lines)}
        </span>
        {rate && <span className="type-micro">{rate} kept</span>}
      </span>
      <IconButton label={`Details of ${r.owner}/${r.name}`} tooltip="Details" variant="ghost" size="sm" icon={<Icon icon={Eye} size="sm" />} onClick={onOpen} />
    </li>
  );
}

function SurvivalDialog({ r, login, onClose }: { r: EngineRepo; login: string; onClose: () => void }) {
  const lines = r.surviving.lines ?? 0;
  const added = r.surviving.added;
  const rate = survival(r.surviving.lines, added);
  const more = added !== null && lines > added;
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width="min(520px, 96vw)" padding={5}>
      <DialogHeader title={`${r.owner}/${r.name}`} subtitle="Their lines here, as commitscape counted them" onOpenChange={(o) => !o && onClose()} />
      <div className="flex flex-col gap-4 pt-2">
        <div className="grid grid-cols-2 gap-2.5">
          <Fact label="Lines still running" value={grouped(lines)} note="at the head, theirs by blame" tone="brand" />
          <Fact label="Kept" value={rate ?? "—"} note={rate ? "of the lines they added" : more ? "not a share: see below" : "lines added not counted"} />
          <Fact label="Lines added" value={added === null ? "—" : grouped(added)} note={r.linesRemoved !== null ? `${grouped(r.linesRemoved)} removed` : undefined} />
          <Fact label="Commits" value={grouped(r.commits)} note={yearsBetween(r.first, r.last)} />
        </div>
        {more && (
          <p className="m-0 rounded-md bg-sunken px-3 py-2.5 type-description">
            More of their lines run here than were counted as added. Lines added leave out bulk commits, such as an import or a vendored drop, and generated files; blame still gives the lines of a bulk commit of theirs to them. So the two count different things, and no share is shown.
          </p>
        )}
        <A href={`/u/${login}/${r.owner}/${r.name}`} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand no-underline hover:underline">
          Where they stand in {r.name}
        </A>
      </div>
    </Dialog>
  );
}

function yearsBetween(first: number | null, last: number | null): string | undefined {
  if (!first || !last) return undefined;
  const [a, b] = [new Date(first * 1000).getUTCFullYear(), new Date(last * 1000).getUTCFullYear()];
  return a === b ? `all in ${a}` : `${a} to ${b}`;
}

function Fact({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "brand" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line bg-body px-3.5 py-3">
      <span className="type-caption font-medium">{label}</span>
      <span className={`type-stat-sm ${tone === "brand" ? "text-brand" : ""}`}>{value}</span>
      {note && <span className="truncate type-micro">{note}</span>}
    </div>
  );
}

function WaitingChip({ w, login }: { w: Waiting; login: string }) {
  return (
    <li>
      <A href={`/u/${login}/${w.owner}/${w.name}`} title={`${w.owner}/${w.name}: ${many(w.commits, "commit", "commits")}, ${w.words}`} className="inline-flex min-h-8 max-w-64 items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-3 text-xs text-primary no-underline transition-colors hover:bg-hover">
        <Face login={w.owner} name={w.owner} size={20} shape="rounded" />
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{w.name}</span>
        {w.busy ? <Spinner size="sm" /> : <span className="flex-none text-secondary">{w.words}</span>}
      </A>
    </li>
  );
}

function WaitingRow({ w, login, onRead }: { w: Waiting; login: string; onRead?: (repos: { owner: string; name: string }[]) => Promise<unknown> }) {
  return (
    <li className="flex h-12 items-center gap-3 border-b border-line">
      <A href={`/u/${login}/${w.owner}/${w.name}`} className="flex min-w-0 flex-1 items-center gap-2.5 text-primary no-underline hover:underline">
        <Face login={w.owner} name={w.owner} size={24} shape="rounded" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            <span className="text-secondary max-sm:hidden">{w.owner}/</span>
            {w.name}
          </span>
          <span className="truncate type-micro">
            {many(w.commits, "commit", "commits")} · {w.words}
          </span>
        </span>
      </A>
      {w.busy ? <Spinner size="sm" /> : w.unread?.canRead && onRead ? <ReadButton onClick={() => onRead([{ owner: w.owner, name: w.name }])} name={`${w.owner}/${w.name}`} /> : null}
    </li>
  );
}

function ReadButton({ onClick, name, label = "Read" }: { onClick: () => Promise<unknown>; name: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={label === "Read" ? `Read ${name}` : undefined}
      onClick={() => {
        setBusy(true);
        void onClick().finally(() => setBusy(false));
      }}
      className="inline-flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-primary transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? <Spinner size="sm" /> : <Play size={ICON.xs} aria-hidden />}
      {label}
    </button>
  );
}

const FAILURE_SHORT: Record<NonNullable<UnreadRepo["reason"]>, string> = {
  not_found: "GitHub has no such repository",
  private: "private",
  too_big: "too big for the Site",
  timed_out: "took too long",
  error: "something went wrong",
  paused: "Builds are paused",
};

/** The people who review their pull requests, and whose they review, each a Versus away. */
export function PeoplePanel({ profile, versus, wide = false }: { profile: Profile; versus?: (login: string) => string; wide?: boolean }) {
  const people = profile.partners.slice(0, 12);
  const most = Math.max(1, ...people.map((p) => p.reviewedTheirs + p.reviewedYours));
  return (
    <Panel title="The people they work with most" description="Who reviewed their pull requests, and whose they reviewed" className="h-full [&>*]:h-full">
      {people.length === 0 ? (
        <Nothing title="No reviews either way yet" words="When someone reviews their pull requests, or they review someone else’s, those people show up here." compact />
      ) : (
        <ul className={`m-0 grid list-none gap-2 p-0 sm:grid-cols-2 ${wide ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {people.map((p) => (
            <li key={p.login} className="group relative flex items-center gap-3 rounded-md border border-line p-2.5 transition-colors hover:border-line-strong">
              <A href={`/u/${p.login}`} className="flex min-w-0 flex-1 items-center gap-3 pe-6 text-primary no-underline">
                <Face login={p.login} name={p.login} size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate type-ui font-medium">{p.login}</span>
                  <span className="flex h-1 w-full overflow-hidden rounded-full bg-(--color-track)" aria-hidden>
                    <span className="h-full bg-(--s1)" style={{ width: `${(p.reviewedYours * 100) / most}%` }} />
                    <span className="h-full bg-(--s3)" style={{ width: `${(p.reviewedTheirs * 100) / most}%` }} />
                  </span>
                  <span className="flex flex-col type-micro">
                    {p.reviewedYours > 0 && <span>{grouped(p.reviewedYours)} to them</span>}
                    {p.reviewedTheirs > 0 && <span>{grouped(p.reviewedTheirs)} from them</span>}
                  </span>
                </span>
              </A>
              {versus && (
                <A href={versus(p.login)} aria-label={`Versus ${p.login}`} title={`Versus ${p.login}`} className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-md text-tertiary no-underline transition-colors hover:bg-hover hover:text-primary">
                  <Swords size={ICON.sm} aria-hidden />
                </A>
              )}
            </li>
          ))}
        </ul>
      )}
      {people.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 type-micro">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-(--s1)" /> reviews of their pull requests
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-(--s3)" /> their reviews of others
          </span>
        </div>
      )}
    </Panel>
  );
}
