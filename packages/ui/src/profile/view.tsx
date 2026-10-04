import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Award, Building2, CalendarDays, Flame, Lock, MapPin, Users } from "lucide-react";
import { ARCHETYPES, type Achievement, type Archetype, type EngineRepo, type EngineView, type Identity, type Profile, type ProfileRepo } from "@commitscape/data";
import { AreaTrend, StackedColumns, type Point } from "../charts/Trend";
import { useTip } from "../charts/tip";
import { YearGrid } from "../charts/Year";
import { avatarUrl } from "../components/avatar";
import { Face } from "../components/Face";
import { compact, day, grouped, many } from "../format";
import { A } from "../kit/A";
import { AddedRemoved, LangDot, Meter, Page, Panel, Stat } from "../kit/layout";
import { survival } from "./survival";

const DAY = 86_400;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** The headline numbers: four large, each saying what it counts, and four smaller beneath; the slower ones arrive in their own slots. */
export function HeadlineNumbers({ profile, surviving, slow }: { profile: Profile; surviving: ReactNode; slow: ReactNode }) {
  const t = profile.totals;
  const rate = t.prsOpened > 0 ? t.prsMerged / t.prsOpened : 0;
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Stat size="lg" value={grouped(t.prsMerged)} label="Pull requests merged" note={t.prsOpened > 0 ? `${Math.round(rate * 100)}% of ${grouped(t.prsOpened)} opened` : "none opened yet"}>
            <Meter value={rate} label="Share of pull requests merged" className="mt-2 max-w-40" />
          </Stat>
        </Cell>
        <Cell>
          <Stat size="lg" value={grouped(t.reviews)} label="Reviews given" note="on other people's pull requests" />
        </Cell>
        <Cell>{surviving}</Cell>
        <Cell>
          <Stat size="lg" value={grouped(t.commits)} label="Commits" note={t.hidden > 0 ? `with ${grouped(t.hidden)} private contributions` : "as GitHub counts them"} />
        </Cell>
      </div>
      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {slow}
        <Cell small>
          <Stat size="sm" value={grouped(t.activeDays)} label="Active days" note={`${grouped(t.contributions)} contributions in all`} />
        </Cell>
        <Cell small>
          <Stat size="sm" value={many(t.longestStreak, "day", "days")} label="Longest streak" note={t.currentStreak > 0 ? `${many(t.currentStreak, "day", "days")} running now` : "days in a row with a contribution"} />
        </Cell>
      </div>
    </div>
  );
}

/** One slot of the headline numbers. */
export function Cell({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return <div className={`min-w-0 border-line [&:not(:last-child)]:border-e max-lg:[&:nth-child(2n)]:border-e-0 max-lg:[&:nth-child(n+3)]:border-t ${small ? "px-5 py-4" : "px-5 py-6"}`}>{children}</div>;
}

/** The two headline numbers that need a person's pull requests read. */
export function PullRequestNumbers({ profile }: { profile: Profile }) {
  const t = profile.totals;
  const capped = profile.read.prs < profile.read.prsTotal;
  return (
    <>
      <Cell small>
        <Stat size="sm" value={t.linesAdded === null ? "—" : <span className="tnum">+{compact(t.linesAdded)} <span className="text-secondary">/</span> −{compact(t.linesRemoved ?? 0)}</span>} label="Lines merged" note={capped ? `in the newest ${grouped(profile.read.prs)} pull requests` : "added and removed in merged pull requests"}>
          {t.linesAdded !== null && <AddedRemoved added={t.linesAdded} removed={t.linesRemoved ?? 0} className="mt-1.5 max-w-40" />}
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

function lastYear(profile: Profile) {
  const { firstDay, days } = profile.calendar;
  const from = Math.max(0, days.length - 364 - (((firstDay + days.length - 1 + 3) % 7) + 1));
  return { firstDay: firstDay + from, days: days.slice(from) };
}

/** The last year, a square a day, with its busiest day and the streak running now. */
export function LastYear({ profile }: { profile: Profile }) {
  const year = lastYear(profile);
  const total = year.days.reduce((a, b) => a + b, 0);
  const best = year.days.reduce((b, n, i) => (n > b.n ? { n, i } : b), { n: 0, i: -1 });
  return (
    <Panel
      title="The last year"
      description={`${many(total, "contribution", "contributions")} on GitHub: commits, pull requests, reviews and issues`}
      actions={
        <div className="flex gap-5 text-sm">
          {best.i >= 0 && (
            <span className="flex flex-col items-end">
              <span className="font-semibold">{grouped(best.n)}</span>
              <span className="text-xs text-secondary">best day, {day(year.firstDay + best.i)}</span>
            </span>
          )}
          <span className="flex flex-col items-end">
            <span className="inline-flex items-center gap-1 font-semibold">
              {profile.totals.currentStreak > 0 && <Flame size={14} className="text-[var(--s2)]" aria-hidden />}
              {many(profile.totals.currentStreak, "day", "days")}
            </span>
            <span className="text-xs text-secondary">streak now</span>
          </span>
        </div>
      }
    >
      <YearGrid firstDay={year.firstDay} days={year.days} unit="contributions" label="Contributions a day over the last year" />
    </Panel>
  );
}

/** Contributions since they joined: month by month, or year by year by kind. */
export function OverTheYears({ profile }: { profile: Profile }) {
  const [by, setBy] = useState<"month" | "year">("month");
  const months = useMemo<Point[]>(() => {
    const list = profile.months.length > 0 ? profile.months : [];
    const first = list.findIndex((m) => m.contributions > 0);
    return list.slice(Math.max(0, first)).map((m) => {
      const [y = "", mm = "01"] = m.month.split("-");
      return { key: m.month, label: `${MONTHS[Number(mm) - 1]} ${y}`, tick: mm === "01" ? y : undefined, contributions: m.contributions };
    });
  }, [profile.months]);
  const years = useMemo<Point[]>(() => profile.years.filter((y) => y.commits + y.prs + y.reviews + y.issues > 0).map((y) => ({ key: String(y.year), label: String(y.year), commits: y.commits, prs: y.prs, reviews: y.reviews, issues: y.issues })), [profile.years]);
  const since = new Date(profile.calendar.firstDay * DAY * 1000).getUTCFullYear();
  return (
    <Panel
      title="Over the years"
      description={`${many(profile.totals.contributions, "contribution", "contributions")} since ${since}`}
      actions={
        <SegmentedControl label="Show contributions by" size="sm" value={by} onChange={(v) => setBy(v as "month" | "year")}>
          <SegmentedControlItem value="month" label="By month" />
          <SegmentedControlItem value="year" label="By year" />
        </SegmentedControl>
      }
    >
      {by === "month" ? (
        <AreaTrend points={months} series={{ key: "contributions", label: "Contributions", colour: "var(--brand)" }} unit="contributions" height={244} />
      ) : (
        <StackedColumns
          points={years}
          unit="contributions"
          height={220}
          series={[
            { key: "commits", label: "Commits", colour: "var(--s1)" },
            { key: "prs", label: "Pull requests", colour: "var(--s2)" },
            { key: "reviews", label: "Reviews", colour: "var(--s3)" },
            { key: "issues", label: "Issues", colour: "var(--s4)" },
          ]}
        />
      )}
    </Panel>
  );
}

const LANGUAGE_COLOURS = 6;

/** The languages of the repositories a person committed to, year by year, weighted by their commits. */
export function LanguagesOverTime({ profile }: { profile: Profile }) {
  const tip = useTip();
  const totals = new Map<string, number>();
  for (const y of profile.years) for (const l of y.languages) totals.set(l.name, (totals.get(l.name) ?? 0) + l.commits);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const named = ranked.slice(0, LANGUAGE_COLOURS);
  const colour = (name: string) => (named.includes(name) ? `var(--s${named.indexOf(name) + 1})` : "var(--other)");
  const years = profile.years.filter((y) => y.languages.length > 0).slice(-10);
  return (
    <Panel title="Languages over the years" description="Each repository's main language, weighted by their commits to it">
      {years.length === 0 ? (
        <Quiet>No commits on GitHub to tell from yet.</Quiet>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-secondary">
            {[...named, ...(ranked.length > named.length ? ["Other"] : [])].map((n) => (
              <li key={n} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: n === "Other" ? "var(--other)" : colour(n) }} />
                {n}
              </li>
            ))}
          </ul>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {years.map((y) => {
              const sum = y.languages.reduce((n, l) => n + l.commits, 0);
              const other = y.languages.filter((l) => !named.includes(l.name)).reduce((n, l) => n + l.commits, 0);
              const parts = [...y.languages.filter((l) => named.includes(l.name)).map((l) => ({ name: l.name, commits: l.commits })), ...(other > 0 ? [{ name: "Other", commits: other }] : [])];
              return (
                <li key={y.year} className="grid grid-cols-[2.6rem_1fr] items-center gap-3">
                  <span className="text-xs text-secondary tnum">{y.year}</span>
                  <span className="flex h-3 gap-0.5">
                    {parts.map((p, i) => (
                      <span
                        key={p.name}
                        className={`block h-full min-w-[3px] ${i === 0 ? "rounded-s-[4px]" : ""} ${i === parts.length - 1 ? "rounded-e-[4px]" : ""}`}
                        style={{ width: `${(p.commits * 100) / Math.max(1, sum)}%`, background: p.name === "Other" ? "var(--other)" : colour(p.name) }}
                        {...tip(
                          <>
                            <strong>{p.name}</strong>
                            <div className="note">
                              {y.year}: {Math.round((p.commits * 100) / Math.max(1, sum))}%, {many(p.commits, "commit", "commits")}
                            </div>
                          </>,
                        )}
                      />
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Panel>
  );
}

const NIGHT = new Set([22, 23, 0, 1, 2, 3, 4]);

/** The hour of day of their newest commits, on each commit's own clock. */
export function CommitClock({ profile }: { profile: Profile }) {
  const tip = useTip();
  const clock = profile.clock;
  if (!clock || clock.sampled === 0)
    return (
      <Panel title="When they commit" description="The hour of their newest commits, on each commit's own clock">
        <Quiet>GitHub has no commit times to read for them.</Quiet>
      </Panel>
    );
  const most = Math.max(1, ...clock.hours);
  const night = clock.hours.reduce((n, v, h) => (NIGHT.has(h) ? n + v : n), 0);
  const peak = clock.hours.indexOf(Math.max(...clock.hours));
  return (
    <Panel title="When they commit" description={`The hour of their newest ${grouped(clock.sampled)} commits, on each commit's own clock`}>
      <div className="flex flex-col gap-3">
        <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Most commits at ${String(peak).padStart(2, "0")}:00`}>
          {clock.hours.map((n, h) => (
            <span key={h} className="flex h-full flex-1 flex-col justify-end" {...tip(<><strong>{String(h).padStart(2, "0")}:00 to {String((h + 1) % 24).padStart(2, "0")}:00</strong><div className="note">{many(n, "commit", "commits")}</div></>)}>
              <span className={`block w-full rounded-t-[3px] ${NIGHT.has(h) ? "bg-[var(--s7)]" : "bg-[var(--s1)]"}`} style={{ height: `${Math.max(n > 0 ? 3 : 1, (n * 100) / most)}%`, opacity: n > 0 ? 1 : 0.25 }} />
            </span>
          ))}
        </div>
        <div className="flex justify-between text-[0.7rem] text-secondary tnum">
          {["00", "06", "12", "18", "23"].map((h) => (
            <span key={h}>{h}:00</span>
          ))}
        </div>
        <p className="m-0 text-sm text-secondary">
          Busiest at <strong className="text-primary">{String(peak).padStart(2, "0")}:00</strong>; {Math.round((night * 100) / clock.sampled)}% between 22:00 and 05:00 <span className="inline-block size-2 rounded-full bg-[var(--s7)] align-middle" />.
        </p>
      </div>
    </Panel>
  );
}

type Row = { owner: string; name: string; colour: string | null; language: string | null; stars: number; private: boolean; prsMerged: number; commits: number; reviews: number; linesAdded: number; linesRemoved: number; engine: EngineRepo | null };

const SHOWN = 8;

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
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => rowsOf(profile.repositories, engine), [profile.repositories, engine]);
  const filtered = query ? rows.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(query.toLowerCase())) : rows;
  const shown = all || query ? filtered : filtered.slice(0, SHOWN);
  const most = Math.max(1, ...rows.map((r) => r.prsMerged * 4 + r.commits + r.reviews));
  const login = profile.identity.login;
  return (
    <Panel
      id="repositories"
      padding={0}
      title="Where their work is"
      description={`${many(rows.length, "repository", "repositories")}, by merged pull requests, then commits and reviews. Open one to see where they stand in it.`}
      actions={
        rows.length > SHOWN ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a repository"
            aria-label="Find a repository"
            className="h-8 w-48 rounded-[var(--radius-element)] border border-line bg-[var(--color-background-body)] px-2.5 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--color-accent)]"
          />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="px-5 pb-5">
          <Quiet>No public work on GitHub yet.</Quiet>
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
            </tbody>
          </table>
        </div>
      )}
      {(filtered.length > SHOWN && !query) || profile.totals.hidden > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          {filtered.length > SHOWN && !query ? <Button label={all ? "Show fewer" : `Show all ${grouped(filtered.length)}`} variant="ghost" size="sm" onClick={() => setAll(!all)} /> : <span />}
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
    <tr className="group border-t border-line transition-colors hover:bg-[var(--color-overlay-hover)]">
      <td className="max-w-0 py-2.5 ps-5 pe-3">
        <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-3 text-primary no-underline">
          <Face login={r.owner} name={r.owner} size={32} shape="rounded" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              <span className="text-secondary">{r.owner}/</span>
              {r.name}
            </span>
            <span className="flex items-center gap-3 overflow-hidden text-xs whitespace-nowrap text-secondary">
              {r.language && (
                <span className="inline-flex items-center gap-1.5">
                  <LangDot colour={r.colour} />
                  {r.language}
                </span>
              )}
              {r.stars > 0 && <span className="whitespace-nowrap">★ {compact(r.stars)}</span>}
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
      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <div className="flex flex-col justify-center gap-1">
          <span className="text-[2.6rem] leading-none font-semibold tracking-[-0.04em] text-brand">{engine.surviving === null ? "…" : compact(engine.surviving)}</span>
          <span className="text-sm font-medium">lines still running</span>
          {share && <span className="text-sm text-secondary">{share} of the {compact(engine.added ?? 0)} lines they added in these repositories</span>}
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
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

/** Their Archetype, by its written rule, beside every Achievement: reached ones in colour, the rest with what reaches them. */
export function TraitsPanel({ archetypes, achievements, complete, onCard }: { archetypes: Archetype[]; achievements: Achievement[]; complete: boolean; onCard?: (id: string) => void }) {
  const main = archetypes[0];
  const earned = achievements.filter((a) => a.earned);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Panel title="Archetype" description="A label from a written rule over their numbers; never a guess">
        <div className="archetype-card relative flex min-h-44 flex-col justify-end gap-2 overflow-hidden rounded-[var(--radius-element)] p-5">
          <span className="text-xs font-medium tracking-[0.12em] text-white/70 uppercase">{main ? "They are a" : "Not decided yet"}</span>
          <span className="text-[2rem] leading-none font-semibold tracking-[-0.03em] text-white">{main ? main.title : "No Archetype"}</span>
          <span className="text-sm text-pretty text-white/80">{main ? main.rule : "None of the rules fits yet. They need 50 contributions, then each rule its own threshold."}</span>
        </div>
        {archetypes.length > 1 && <p className="m-0 text-sm text-secondary">Also {archetypes.slice(1).map((a) => a.title).join(", ")}.</p>}
        {!complete && <p className="m-0 text-xs text-secondary">Some rules wait for their pull requests to be read.</p>}
        <details className="text-sm">
          <summary className="cursor-pointer text-secondary">Every rule, in the order they are tried</summary>
          <dl className="m-0 mt-3 flex flex-col gap-2">
            {ARCHETYPES.map((a) => (
              <div key={a.id} className="grid grid-cols-[7rem_1fr] gap-2">
                <dt className="font-medium">{a.title}</dt>
                <dd className="m-0 text-secondary">{a.rule}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Panel>
      <Panel title="Achievements" description={`${earned.length} of ${achievements.length} reached`}>
        <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
          {achievements.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 rounded-[var(--radius-element)] border p-3 ${a.earned ? "border-line bg-[var(--color-background-body)]" : "border-dashed border-line"}`}>
              <span className={`grid size-9 flex-none place-items-center rounded-full ${a.earned ? "medal-earned" : "bg-[var(--color-track)] text-secondary"}`}>{a.earned ? <Award size={17} aria-hidden /> : <Lock size={14} aria-hidden />}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold">{a.title}</span>
                <span className="text-xs text-pretty text-secondary">{a.earned ? [a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule : a.rule}</span>
              </span>
              {a.earned && onCard && <Button label="Card" size="sm" variant="ghost" onClick={() => onCard(a.id)} />}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** The people who review their pull requests, and whose they review, each a Versus away. */
export function PeoplePanel({ profile, versus }: { profile: Profile; versus?: (login: string) => string }) {
  const people = profile.partners.slice(0, 12);
  const most = Math.max(1, ...people.map((p) => p.reviewedTheirs + p.reviewedYours));
  return (
    <Panel title="The people they work with most" description="Who reviewed their pull requests, and whose they reviewed">
      {people.length === 0 ? (
        <Quiet>No reviews either way yet.</Quiet>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
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

function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-0 py-6 text-center text-sm text-secondary">{children}</p>;
}
