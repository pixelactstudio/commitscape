import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Award, Building2, CalendarDays, Lock, MapPin, Play, Users } from "lucide-react";
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
      <Page className="relative flex flex-col gap-6 pt-page-top pb-8 md:flex-row md:items-end md:justify-between">
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
    <div className="grid overflow-hidden rounded-lg border border-line bg-surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Stat size="lg" value={counted(t.prsMerged)} label="Pull requests merged" note={t.prsOpened > 0 ? `${Math.round(rate * 100)}% of ${grouped(t.prsOpened)} opened` : "none opened yet"}>
            <Meter value={rate} label="Share of pull requests merged" className="mt-1 max-w-40" />
          </Stat>
        </Cell>
        <Cell>
          <Stat size="lg" value={counted(t.reviews)} label="Reviews given" note="on other people's pull requests" />
        </Cell>
        <Cell>{surviving}</Cell>
        <Cell>
          <Stat size="lg" value={counted(t.commits)} label="Commits" note={t.hidden > 0 ? `with ${grouped(t.hidden)} private contributions` : "as GitHub counts them"} />
        </Cell>
      </div>
      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {slow}
        <Cell small>
          <Stat size="sm" value={grouped(t.activeDays)} label="Active days" note={`${many(t.contributions, "contribution", "contributions")} in all`} />
        </Cell>
        <Cell small>
          <StreakCell profile={profile} />
        </Cell>
      </div>
    </div>
  );
}

/** The two headline numbers that need a person's pull requests read. */
export function PullRequestNumbers({ profile }: { profile: Profile }) {
  const t = profile.totals;
  const capped = profile.read.prs < profile.read.prsTotal;
  const none = t.linesAdded !== null && t.linesAdded + (t.linesRemoved ?? 0) === 0;
  return (
    <>
      <Cell small>
        <Stat size="sm" value={t.linesAdded === null || none ? "—" : <span className="tnum whitespace-nowrap">+{compact(t.linesAdded)} <span className="text-secondary">/</span> −{compact(t.linesRemoved ?? 0)}</span>} label="Lines merged" note={none ? "no merged pull requests yet" : capped ? `in the newest ${grouped(profile.read.prs)} pull requests` : "added and removed in merged pull requests"}>
          {t.linesAdded !== null && !none && <AddedRemoved added={t.linesAdded} removed={t.linesRemoved ?? 0} className="mt-1 max-w-40" />}
        </Stat>
      </Cell>
      <Cell small>
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

const quiet = <span className="text-quiet">—</span>;

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
      id="repositories"
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
            className="h-8 w-48 max-w-full rounded-md border border-line bg-body px-2.5 text-xs text-primary outline-none placeholder:text-secondary focus:border-brand-line"
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
          <Face login={r.owner} name={r.owner} size={32} shape="rounded" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">
              <span className="text-secondary max-sm:hidden">{r.owner}/</span>
              {r.name}
            </span>
            <span className="flex items-center gap-3 overflow-hidden type-caption whitespace-nowrap">
              <span className="truncate sm:hidden">{r.owner}</span>
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
              <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-[var(--color-track)] lg:inline-block" aria-hidden>
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
    return <span className="type-caption text-tertiary" title={unread ? UNREAD_WORDS[unread.state] : "commitscape has not read this repository's history yet"}>{unread ? UNREAD_WORDS[unread.state] : "—"}</span>;
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

/** Lines that still run, repository by repository: the total is the sum of the counted rows listed, and every other repository they committed to is shown as waiting, being read, or not read, with a way to read it. */
export function SurvivalPanel({ engine, login, onRead }: { engine: EngineView; login: string; onRead?: (repos: { owner: string; name: string }[]) => Promise<unknown> }) {
  const c = coverage(engine);
  const [shown, setShown] = useState(UNREAD_PAGE);
  if (engine.repos.length === 0 && c.unread.length === 0) return null;
  const listed = [...c.counted, ...c.waiting];
  const most = Math.max(1, ...c.counted.map((r) => r.surviving.added ?? r.surviving.lines ?? 0));
  const share = survival(c.total, c.added);
  const readable = c.unread.filter((r) => r.canRead);
  const reading = c.unread.filter((r) => r.state === "reading").length;
  const counting = c.waiting.filter((r) => r.surviving.status === "counting").length;
  const next = readable.slice(0, 5);
  return (
    <Panel
      id="survived"
      title="Code that survived"
      description="The lines of theirs still at the head of each repository commitscape has read, under every address they commit with; reformats and generated files left out. A repository counts once it is read and counted."
      actions={
        c.busy ? (
          <Chip tone="brand" icon={<Spinner size="sm" />}>
            {[counting > 0 && `counting ${grouped(counting)}`, reading > 0 && `reading ${grouped(reading)}`].filter(Boolean).join(", ")}; updates by itself
          </Chip>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          <span className={`type-stat-lg ${c.total === null ? "text-secondary" : "text-brand"}`}>{c.total === null ? "—" : compact(c.total)}</span>
          <span className="mt-1 type-label">lines still running</span>
          <span className="type-caption">
            {c.total === null ? (c.busy ? "None counted yet; the first arrive in a few minutes." : "No repository of theirs counted yet.") : `The sum of the ${many(c.counted.length, "repository", "repositories")} listed${share ? `: ${share} of the ${compact(c.added ?? 0)} lines they added there` : ""}.`}
          </span>
          <CoverageBar c={c} />
        </div>
        <div className="flex min-w-0 flex-col gap-stack">
          {listed.length > 0 && (
            <ul className="m-0 flex min-w-0 list-none flex-col gap-3 p-0">
              {listed.map((r) => (
                <SurvivalRow key={`${r.owner}/${r.name}`} r={r} login={login} most={most} />
              ))}
            </ul>
          )}
          {c.unread.length > 0 && (
            <div className={`flex flex-col gap-3 ${listed.length > 0 ? "border-t border-line pt-stack" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-label">Not in the total yet</span>
                  <span className="type-caption">{many(c.unread.length, "repository", "repositories")} they committed to that commitscape has not counted. Each joins the total once it is read.</span>
                </div>
                {onRead && next.length > 0 && <ReadButton onClick={() => onRead(next.map((r) => ({ owner: r.owner, name: r.name })))} name={next.map((r) => `${r.owner}/${r.name}`).join(", ")} label={next.length === 1 ? `Read ${next[0]?.name}` : `Read the next ${next.length}`} />}
              </div>
              <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
                {c.unread.slice(0, shown).map((r) => (
                  <UnreadRow key={`${r.owner}/${r.name}`} r={r} login={login} onRead={onRead} />
                ))}
              </ul>
              {c.unread.length > shown && (
                <button type="button" onClick={() => setShown(shown + UNREAD_PAGE * 2)} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline">
                  Show {grouped(Math.min(UNREAD_PAGE * 2, c.unread.length - shown))} more of {grouped(c.unread.length - shown)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CoverageBar({ c }: { c: Coverage }) {
  if (c.repositories === null || c.repositories === 0) return null;
  const parts = [
    { n: c.counted.length, colour: "bg-brand", word: "counted" },
    { n: c.waiting.length, colour: "bg-brand-line", word: "read, counting or not countable" },
    { n: c.unread.length, colour: "bg-[var(--color-track)]", word: "not read" },
  ].filter((p) => p.n > 0);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <span role="img" aria-label={parts.map((p) => `${p.n} ${p.word}`).join(", ")} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.word} className={`block h-full min-w-1 ${p.colour}`} style={{ flexGrow: p.n }} />
        ))}
      </span>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 type-caption">
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

function SurvivalRow({ r, login, most }: { r: EngineRepo; login: string; most: number }) {
  const counted = r.surviving.status === "counted" && r.surviving.lines !== null;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-2 text-primary no-underline hover:underline">
          <Face login={r.owner} name={r.owner} size={20} shape="rounded" />
          <span className="truncate font-medium">
            {r.owner}/{r.name}
          </span>
        </A>
        <span className="flex-none type-caption tnum">
          {counted ? (
            <>
              <strong className="font-semibold text-primary">{grouped(r.surviving.lines ?? 0)}</strong>
              {r.surviving.added ? ` of ${grouped(r.surviving.added)} · ${survival(r.surviving.lines, r.surviving.added) ?? ""}` : ""}
            </>
          ) : (
            <SurvivingCell repo={r} />
          )}
        </span>
      </div>
      <span className="type-caption tnum">
        {many(r.commits, "commit", "commits")}
        {r.linesAdded !== null && (
          <>
            {" · "}
            <span className="text-added">+{compact(r.linesAdded)}</span> <span className="text-removed">−{compact(r.linesRemoved ?? 0)}</span> lines changed
          </>
        )}
        {!counted && " · not in the total yet"}
      </span>
      <span className="relative block h-1.5 overflow-hidden rounded-full bg-[var(--color-track)]">
        {counted && r.surviving.added ? <span className="absolute inset-y-0 start-0 rounded-full bg-brand-soft" style={{ width: `${(r.surviving.added * 100) / most}%` }} /> : null}
        {counted ? <span className="absolute inset-y-0 start-0 rounded-full bg-brand" style={{ width: `${((r.surviving.lines ?? 0) * 100) / most}%` }} /> : r.surviving.status === "counting" ? <span className="absolute inset-0 animate-pulse bg-[var(--color-skeleton)]" /> : null}
      </span>
    </li>
  );
}

function UnreadRow({ r, login, onRead }: { r: UnreadRepo; login: string; onRead?: (repos: { owner: string; name: string }[]) => Promise<unknown> }) {
  const words = r.state === "failed" && r.reason ? `${UNREAD_WORDS.failed}: ${FAILURE_SHORT[r.reason]}` : r.private && r.state === "not_read" ? "private: open it to connect" : UNREAD_WORDS[r.state];
  return (
    <li className="flex h-12 items-center gap-3 rounded-md border border-line px-3">
      <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 flex-1 items-center gap-2.5 text-primary no-underline hover:underline">
        <Face login={r.owner} name={r.owner} size={24} shape="rounded" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            <span className="text-secondary max-sm:hidden">{r.owner}/</span>
            {r.name}
          </span>
          <span className="truncate type-micro">
            {many(r.commits, "commit", "commits")} · {words}
          </span>
        </span>
      </A>
      {r.state === "reading" ? (
        <Spinner size="sm" />
      ) : r.canRead && onRead ? (
        <ReadButton onClick={() => onRead([{ owner: r.owner, name: r.name }])} name={`${r.owner}/${r.name}`} />
      ) : null}
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
        <Nothing title="No reviews either way yet" words="When someone reviews their pull requests, or they review someone else's, those people show up here." compact />
      ) : (
        <ul className={`m-0 grid list-none gap-2 p-0 sm:grid-cols-2 ${wide ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {people.map((p) => (
            <li key={p.login} className="group flex items-center gap-3 rounded-md border border-line p-2.5 transition-colors hover:border-line-strong">
              <A href={`/u/${p.login}`} className="flex min-w-0 flex-1 items-center gap-3 text-primary no-underline">
                <Face login={p.login} name={p.login} size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">{p.login}</span>
                  <span className="flex h-1 w-full overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
                    <span className="h-full bg-[var(--s1)]" style={{ width: `${(p.reviewedYours * 100) / most}%` }} />
                    <span className="h-full bg-[var(--s3)]" style={{ width: `${(p.reviewedTheirs * 100) / most}%` }} />
                  </span>
                  <span className="truncate type-micro">{[p.reviewedYours > 0 && `${grouped(p.reviewedYours)} to them`, p.reviewedTheirs > 0 && `${grouped(p.reviewedTheirs)} from them`].filter(Boolean).join(" · ")}</span>
                </span>
              </A>
              {versus && (
                <A href={versus(p.login)} className="flex-none rounded-md px-2 py-1 text-xs font-medium text-secondary no-underline transition-opacity hover:text-primary focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  Versus
                </A>
              )}
            </li>
          ))}
        </ul>
      )}
      {people.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 type-micro">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--s1)]" /> reviews of their pull requests
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--s3)]" /> their reviews of others
          </span>
        </div>
      )}
    </Panel>
  );
}
