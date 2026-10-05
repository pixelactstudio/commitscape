import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Award, Building2, CalendarDays, Lock, MapPin, Users } from "lucide-react";
import type { Archetype, EngineRepo, EngineView, Identity, Profile, ProfileRepo } from "@commitscape/data";
import { avatarUrl } from "../components/avatar";
import { Face } from "../components/Face";
import { compact, grouped, many } from "../format";
import { A } from "../kit/A";
import { AddedRemoved, LangDot, Meter, Page, Panel, Stat } from "../kit/layout";
import { CountUp, Nothing } from "../motion";
import { Cell } from "./cell";
import { StreakCell } from "./streak";
import { survival } from "./survival";

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
      <Page className="relative flex flex-col gap-6 pt-10 pb-8 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
          <img src={avatarUrl(identity.login, 112)} alt="" width={112} height={112} className="size-[6rem] flex-none rounded-full bg-muted shadow-[0_0_0_4px_var(--color-background-body),0_12px_32px_-8px_rgb(0_0_0/0.35)] sm:size-28" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="m-0 text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">{name}</h1>
              {archetype && <ArchetypePill archetype={archetype} also={also} />}
              {badges}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
              <a href={`https://github.com/${identity.login}`} className="font-medium text-secondary no-underline hover:text-primary">
                @{identity.login}
              </a>
              {facts.map(([Glyph, text]) => (
                <span key={text} className="inline-flex items-center gap-1.5">
                  <Glyph size={14} aria-hidden />
                  {text}
                </span>
              ))}
            </div>
            {identity.bio && <p className="m-0 max-w-2xl text-[0.95rem] text-pretty">{identity.bio}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
      </Page>
    </section>
  );
}

/** A person's Archetype as a small label, its rule on hover. */
export function ArchetypePill({ archetype, also }: { archetype: Archetype; also: string[] }) {
  return (
    <HoverCard
      label={`Archetype: ${archetype.title}`}
      placement="below"
      content={
        <div className="flex max-w-72 flex-col gap-1.5 p-1 text-sm">
          <span className="text-xs font-medium text-secondary">Archetype, by a written rule</span>
          <strong className="text-base">{archetype.title}</strong>
          <span className="text-secondary">{archetype.rule}</span>
          {also.length > 0 && <span className="text-xs text-secondary">Also: {also.join(", ")}</span>}
        </div>
      }
    >
      <button type="button" className="archetype-pill inline-flex cursor-help items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-semibold">
        <Award size={13} aria-hidden />
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
    <div className="grid overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Stat size="lg" value={counted(t.prsMerged)} label="Pull requests merged" note={t.prsOpened > 0 ? `${Math.round(rate * 100)}% of ${grouped(t.prsOpened)} opened` : "none opened yet"}>
            <Meter value={rate} label="Share of pull requests merged" className="mt-2 max-w-40" />
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
  return (
    <>
      <Cell small>
        <Stat size="sm" value={t.linesAdded === null || t.linesAdded + (t.linesRemoved ?? 0) === 0 ? "—" : <span className="tnum">+{compact(t.linesAdded)} <span className="text-secondary">/</span> −{compact(t.linesRemoved ?? 0)}</span>} label="Lines merged" note={t.linesAdded !== null && t.linesAdded + (t.linesRemoved ?? 0) === 0 ? "no merged pull requests yet" : capped ? `in the newest ${grouped(profile.read.prs)} pull requests` : "added and removed in merged pull requests"}>
          {t.linesAdded !== null && t.linesAdded + (t.linesRemoved ?? 0) > 0 && <AddedRemoved added={t.linesAdded} removed={t.linesRemoved ?? 0} className="mt-1.5 max-w-40" />}
        </Stat>
      </Cell>
      <Cell small>
        <Stat size="sm" value={t.hoursToMerge === null ? "—" : hours(t.hoursToMerge)} label="Time to merge" note="their middle pull request" />
      </Cell>
    </>
  );
}

/** The headline Surviving Lines, across the repositories commitscape has read, and how far the count has got. */
export function SurvivingNumber({ engine, suggest }: { engine: EngineView; suggest?: string | null }) {
  const counted = engine.repos.filter((r) => r.surviving.status === "counted").length;
  if (engine.repos.length === 0)
    return (
      <Stat size="lg" value={<span className="text-secondary">—</span>} label="Lines that still run" note="no repository of theirs read here yet">
        {suggest && (
          <A href={`/gh/${suggest}`} className="mt-1 w-fit text-xs font-medium text-brand no-underline hover:underline">
            Read {suggest} to count them →
          </A>
        )}
      </Stat>
    );
  if (engine.surviving === null)
    return (
      <Stat size="lg" value={<span className="inline-flex items-center gap-2 text-secondary"><Spinner size="sm" /> <span className="text-[1.3rem]">Counting</span></span>} label="Lines that still run" note={`blaming ${many(engine.repos.length, "repository", "repositories")}; takes a few minutes`} />
    );
  const share = survival(engine.surviving, engine.added);
  return (
    <Stat size="lg" tone="brand" value={compact(engine.surviving)} label="Lines that still run" note={engine.counting > 0 ? `${counted} of ${engine.repos.length} repositories counted, more coming` : share ? `${share} of the ${compact(engine.added ?? 0)} they added` : `in ${many(counted, "repository", "repositories")}`}>
      {share && engine.added && <Meter value={engine.surviving / engine.added} label="Share of their lines still running" className="mt-2 max-w-40" />}
    </Stat>
  );
}

type Row = { owner: string; name: string; colour: string | null; language: string | null; stars: number; private: boolean; prsMerged: number; commits: number; reviews: number; linesAdded: number; linesRemoved: number; engine: EngineRepo | null };

const PAGE = 12;
const ROW = "h-[57px]";

function rowsOf(repos: ProfileRepo[], engine: EngineView | null): Row[] {
  const byName = new Map((engine?.repos ?? []).map((e) => [`${e.owner}/${e.name}`.toLowerCase(), e]));
  const rows: Row[] = repos.map((r) => {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    const e = byName.get(key) ?? null;
    byName.delete(key);
    return { ...r, engine: e };
  });
  for (const e of byName.values()) rows.push({ owner: e.owner, name: e.name, colour: null, language: null, stars: 0, private: e.private, prsMerged: 0, commits: e.commits, reviews: 0, linesAdded: e.linesAdded ?? 0, linesRemoved: e.linesRemoved ?? 0, engine: e });
  return rows;
}

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
            className="h-8 w-48 max-w-full rounded-[var(--radius-element)] border border-line bg-[var(--color-background-body)] px-2.5 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--color-accent)]"
          />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="px-5 pb-5">
          <Nothing title="No public work on GitHub yet" words="Repositories they commit to, open pull requests in or review show up here." compact />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-secondary">
                <th className="py-2 ps-5 pe-3 text-start font-medium">Repository</th>
                <th className="w-px whitespace-nowrap px-3 py-2 text-end font-medium">Merged PRs</th>
                <th className="hidden w-px whitespace-nowrap px-3 py-2 text-end font-medium sm:table-cell">Commits</th>
                <th className="w-px whitespace-nowrap hidden px-3 py-2 text-end font-medium sm:table-cell">Reviews</th>
                <th className="w-px whitespace-nowrap hidden px-3 py-2 text-end font-medium md:table-cell">Lines merged</th>
                <th className="w-px whitespace-nowrap py-2 ps-3 pe-5 text-end font-medium">Still running</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RepoRow key={`${r.owner}/${r.name}`} r={r} login={login} weight={(r.prsMerged * 4 + r.commits + r.reviews) / most} />
              ))}
              {shown.length === 0 && (
                <tr className={`border-t border-line ${ROW}`}>
                  <td colSpan={6} className="px-5 text-center text-sm text-secondary">
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
              <span className="text-xs text-secondary tnum">
                {grouped((at - 1) * PAGE + 1)}–{grouped(Math.min(filtered.length, at * PAGE))} of {grouped(filtered.length)}
              </span>
            </div>
          ) : (
            <span />
          )}
          {profile.totals.hidden > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <Lock size={12} aria-hidden /> {many(profile.totals.hidden, "private contribution", "private contributions")} counted in the totals, never named
            </span>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function RepoRow({ r, login, weight }: { r: Row; login: string; weight: number }) {
  const n = (v: number) => (v > 0 ? grouped(v) : <span className="text-[var(--color-text-disabled)]">—</span>);
  const e = r.engine;
  return (
    <tr className={`group border-t border-line transition-colors hover:bg-[var(--color-overlay-hover)] ${ROW}`}>
      <td className="max-w-0 py-2.5 ps-5 pe-3">
        <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-3 text-primary no-underline">
          <Face login={r.owner} name={r.owner} size={32} shape="rounded" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              <span className="text-secondary max-sm:hidden">{r.owner}/</span>
              {r.name}
            </span>
            <span className="flex items-center gap-3 overflow-hidden text-xs whitespace-nowrap text-secondary">
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
                  <Lock size={11} aria-hidden /> only you see this
                </span>
              )}
              <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-[var(--color-track)] lg:inline-block" aria-hidden>
                <span className="block h-full rounded-full bg-[var(--color-text-secondary)] opacity-60" style={{ width: `${Math.max(4, weight * 100)}%` }} />
              </span>
            </span>
          </span>
        </A>
      </td>
      <td className="px-3 py-2.5 text-end tnum">{n(r.prsMerged)}</td>
      <td className="hidden px-3 py-2.5 text-end tnum sm:table-cell">{n(r.commits)}</td>
      <td className="hidden px-3 py-2.5 text-end tnum sm:table-cell">{n(r.reviews)}</td>
      <td className="hidden px-3 py-2.5 text-end text-xs whitespace-nowrap tnum md:table-cell">
        {r.linesAdded + r.linesRemoved > 0 ? (
          <>
            <span className="text-added">+{compact(r.linesAdded)}</span> <span className="text-removed">−{compact(r.linesRemoved)}</span>
          </>
        ) : (
          <span className="text-[var(--color-text-disabled)]">—</span>
        )}
      </td>
      <td className="py-2.5 ps-3 pe-5 text-end tnum">
        <SurvivingCell repo={e} />
      </td>
    </tr>
  );
}

function SurvivingCell({ repo }: { repo: EngineRepo | null }) {
  if (!repo) return <span className="text-xs text-[var(--color-text-disabled)]" title="commitscape has not read this repository's history yet">—</span>;
  const s = repo.surviving;
  if (s.status === "counted" && s.lines !== null) return <span className="font-medium text-brand">{compact(s.lines)}</span>;
  if (s.status === "failed") return <span className="text-xs text-secondary">could not count</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
      <Spinner size="sm" /> counting
    </span>
  );
}

/** Lines that still run, repository by repository, against the lines they added there. */
export function SurvivalPanel({ engine, login }: { engine: EngineView; login: string }) {
  if (engine.repos.length === 0) return null;
  const top = engine.repos.slice(0, 6);
  const most = Math.max(1, ...top.map((r) => r.surviving.added ?? r.surviving.lines ?? 0));
  const share = survival(engine.surviving, engine.added);
  return (
    <Panel title="Code that survived" description="From each repository's own history, under every address they commit with: the lines they changed, and the lines of theirs still at its head; reformats and generated files left out.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="flex flex-col justify-center gap-1">
          <span className="text-[2.6rem] leading-none font-semibold tracking-[-0.04em] text-brand">{engine.surviving === null ? "…" : compact(engine.surviving)}</span>
          <span className="text-sm font-medium">lines still running</span>
          {share && <span className="text-sm text-secondary">{share} of the {compact(engine.added ?? 0)} lines they added in these repositories</span>}
        </div>
        <ul className="m-0 flex min-w-0 list-none flex-col gap-3 p-0">
          {top.map((r) => {
            const counted = r.surviving.status === "counted" && r.surviving.lines !== null;
            return (
              <li key={`${r.owner}/${r.name}`} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-2 text-primary no-underline hover:underline">
                    <Face login={r.owner} name={r.owner} size={20} shape="rounded" />
                    <span className="truncate font-medium">{r.owner}/{r.name}</span>
                  </A>
                  <span className="flex-none text-xs text-secondary tnum">
                    {counted ? (
                      <>
                        <strong className="text-primary">{grouped(r.surviving.lines ?? 0)}</strong>
                        {r.surviving.added ? ` of ${grouped(r.surviving.added)} · ${survival(r.surviving.lines, r.surviving.added) ?? ""}` : ""}
                      </>
                    ) : (
                      <SurvivingCell repo={r} />
                    )}
                  </span>
                </div>
                <span className="text-xs text-secondary tnum">
                  {many(r.commits, "commit", "commits")}
                  {r.linesAdded !== null && (
                    <>
                      {" · "}
                      <span className="text-added">+{compact(r.linesAdded)}</span> <span className="text-removed">−{compact(r.linesRemoved ?? 0)}</span> lines changed
                    </>
                  )}
                </span>
                <span className="relative block h-2 overflow-hidden rounded-full bg-[var(--color-track)]">
                  {counted && r.surviving.added ? <span className="absolute inset-y-0 start-0 rounded-full bg-[var(--brand-soft)]" style={{ width: `${(r.surviving.added * 100) / most}%` }} /> : null}
                  {counted ? <span className="absolute inset-y-0 start-0 rounded-full bg-brand" style={{ width: `${((r.surviving.lines ?? 0) * 100) / most}%` }} /> : <span className="absolute inset-0 animate-pulse bg-[var(--color-skeleton)]" />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

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
            <li key={p.login} className="group flex items-center gap-3 rounded-[var(--radius-element)] border border-line p-2.5 transition-colors hover:border-strong">
              <A href={`/u/${p.login}`} className="flex min-w-0 flex-1 items-center gap-3 text-primary no-underline">
                <Face login={p.login} name={p.login} size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">{p.login}</span>
                  <span className="flex h-1 w-full overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
                    <span className="h-full bg-[var(--s1)]" style={{ width: `${(p.reviewedYours * 100) / most}%` }} />
                    <span className="h-full bg-[var(--s3)]" style={{ width: `${(p.reviewedTheirs * 100) / most}%` }} />
                  </span>
                  <span className="truncate text-xs text-secondary">{[p.reviewedYours > 0 && `${grouped(p.reviewedYours)} to them`, p.reviewedTheirs > 0 && `${grouped(p.reviewedTheirs)} from them`].filter(Boolean).join(" · ")}</span>
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
        <div className="flex gap-4 text-xs text-secondary">
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
