import { useState, type ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import type { Identity, Profile, ProfileRepo } from "@commitscape/data";
import { Columns } from "../charts/Columns";
import { Figure, Legend, TableView } from "../charts/common";
import { Calendar } from "../charts/Grid";
import { useTip } from "../charts/tip";
import { avatarUrl } from "../components/avatar";
import { Face } from "../components/Face";
import { Tile } from "../components/Tile";
import { compact, grouped, many } from "../format";

const DAY = 86_400;

export const REPOS_SHOWN = 8;

function hours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function joined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A person's name, face and what GitHub says of them, drawn at once from their identity. */
export function ProfileHero({ identity, children, badges }: { identity: Identity; children?: ReactNode; badges?: ReactNode }) {
  const facts = [identity.company, identity.location, `on GitHub since ${joined(identity.createdAt)}`, identity.followers > 0 ? many(identity.followers, "follower", "followers") : null].filter(Boolean);
  return (
    <header className="profile-hero">
      <Avatar src={avatarUrl(identity.login, 96)} name={identity.name ?? identity.login} size={96} tooltip={false} />
      <div className="min-w-0 flex-1">
        <Heading level={1} className="profile-title">
          {identity.name ?? identity.login}
        </Heading>
        <p className="profile-login">
          <a href={`https://github.com/${identity.login}`}>@{identity.login}</a>
          {badges}
        </p>
        {identity.bio && <p className="profile-bio">{identity.bio}</p>}
        <p className="profile-facts note small">
          {facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </p>
      </div>
      {children && <div className="profile-actions">{children}</div>}
    </header>
  );
}

/** The headline numbers of a Profile, each saying what it counts; `slow` is where the numbers from its pull requests stream in. */
export function ProfileTotals({ profile, slow, extra }: { profile: Profile; slow?: ReactNode; extra?: ReactNode }) {
  const t = profile.totals;
  return (
    <section className="tiles profile-tiles">
      <Tile value={grouped(t.prsMerged)} label="pull requests merged" note={`of ${grouped(t.prsOpened)} opened`} />
      {extra}
      <Tile value={grouped(t.reviews)} label="reviews given" note="on others' pull requests" />
      <Tile value={grouped(t.commits)} label="commits" note="as GitHub counts them" />
      {slow ?? <PullRequestTiles profile={profile} />}
      <Tile value={grouped(t.activeDays)} label="active days" note="with a contribution" />
      <Tile value={many(t.longestStreak, "day", "days")} label="longest streak" note={t.currentStreak > 0 ? `${many(t.currentStreak, "day", "days")} running now` : "of days in a row"} />
    </section>
  );
}

/** The two headline numbers that need a person's pull requests read. */
export function PullRequestTiles({ profile }: { profile: Profile }) {
  const t = profile.totals;
  const capped = profile.read.prs < profile.read.prsTotal;
  return (
    <>
      <Tile value={t.linesAdded === null ? "—" : `+${compact(t.linesAdded)}`} label="lines added, merged" note={t.linesRemoved === null ? "counting…" : `and −${compact(t.linesRemoved)} removed${capped ? `, newest ${grouped(profile.read.prs)} PRs` : ""}`} />
      <Tile value={t.hoursToMerge === null ? "—" : hours(t.hoursToMerge)} label="to merge, typically" note="their middle pull request" />
    </>
  );
}

/** The contribution calendar of the last year. */
export function YearCalendar({ profile }: { profile: Profile }) {
  const { firstDay, days } = profile.calendar;
  const from = Math.max(0, days.length - 364 - (((firstDay + days.length - 1 + 4) % 7) + 1));
  const shown = days.slice(from);
  const total = shown.reduce((a, b) => a + b, 0);
  return (
    <Figure title="The last year" note={`${many(total, "contribution", "contributions")} on GitHub: commits, pull requests, reviews and issues, a square a day`}>
      <Calendar firstDay={firstDay + from} days={shown} unit="contributions" quantile />
    </Figure>
  );
}

/** Contributions over every year the person has been on GitHub. */
export function Activity({ profile }: { profile: Profile }) {
  return (
    <Figure title="Over the years" note={`${many(profile.totals.contributions, "contribution", "contributions")} since ${new Date(profile.calendar.firstDay * DAY * 1000).getUTCFullYear()}`}>
      <div className="overview-chart">
        <Columns firstDay={profile.calendar.firstDay} series={[{ label: "Contributions", colour: "var(--s1)", values: profile.calendar.days }]} unit="contributions" />
      </div>
    </Figure>
  );
}

function RepoRow({ r, login, onStanding }: { r: ProfileRepo; login: string; onStanding?: (r: ProfileRepo) => ReactNode }) {
  const n = (v: number) => (v > 0 ? grouped(v) : <span className="note">—</span>);
  return (
    <li className="repo-row">
      <Face login={r.owner} name={r.owner} size={32} />
      <div className="min-w-0">
        <a className="repo-row-name" href={`/u/${login}/${r.owner}/${r.name}`}>
          <span className="note">{r.owner}/</span>
          {r.name}
        </a>
        <div className="note small repo-row-meta">
          {r.language && (
            <span className="lang">
              <span className="lang-dot" style={{ background: r.colour ?? "var(--other)" }} aria-hidden />
              {r.language}
            </span>
          )}
          {r.stars > 0 && <span>{many(r.stars, "star", "stars")}</span>}
          {r.private && <Badge label="private: only you see this" variant="neutral" />}
          {onStanding?.(r)}
        </div>
      </div>
      <span className="num">{n(r.prsMerged)}</span>
      <span className="num">{n(r.commits)}</span>
      <span className="num hide-narrow">{n(r.reviews)}</span>
      <span className="num small hide-narrow">
        {r.linesAdded + r.linesRemoved > 0 ? (
          <>
            <span className="added">+{compact(r.linesAdded)}</span> <span className="removed">−{compact(r.linesRemoved)}</span>
          </>
        ) : (
          <span className="note">—</span>
        )}
      </span>
    </li>
  );
}

/** Where a person's work is: each repository with their merged pull requests, commits and reviews in it. */
export function Repositories({ profile, onStanding }: { profile: Profile; onStanding?: (r: ProfileRepo) => ReactNode }) {
  const [all, setAll] = useState(false);
  const list = profile.repositories;
  const shown = all ? list : list.slice(0, REPOS_SHOWN);
  return (
    <Figure title="Where their work is" note={`${many(list.length, "repository", "repositories")}, by merged pull requests, then commits and reviews`}>
      {list.length === 0 ? (
        <p className="note">No public work on GitHub yet.</p>
      ) : (
        <ol className="repo-list" style={all ? undefined : { minHeight: Math.min(REPOS_SHOWN, list.length) * 61 + 28 }}>
          <li className="repo-row repo-head-row note small" aria-hidden>
            <span />
            <span>Repository</span>
            <span className="num">merged PRs</span>
            <span className="num">commits</span>
            <span className="num hide-narrow">reviews</span>
            <span className="num hide-narrow">lines merged</span>
          </li>
          {shown.map((r) => (
            <RepoRow key={`${r.owner}/${r.name}`} r={r} login={profile.identity.login} onStanding={onStanding} />
          ))}
        </ol>
      )}
      {list.length > REPOS_SHOWN && <Button label={all ? "Fewer" : `All ${many(list.length, "repository", "repositories")}`} variant="ghost" size="sm" onClick={() => setAll(!all)} />}
      {profile.totals.hidden > 0 && <p className="note small">Also {many(profile.totals.hidden, "private contribution", "private contributions")}, counted in the totals and never named.</p>}
    </Figure>
  );
}

const LANGUAGE_COLOURS = 6;

/** The languages of the repositories a person committed to, year by year, weighted by their commits. */
export function LanguagesByYear({ profile }: { profile: Profile }) {
  const tip = useTip();
  const totals = new Map<string, number>();
  for (const y of profile.years) for (const l of y.languages) totals.set(l.name, (totals.get(l.name) ?? 0) + l.commits);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const named = ranked.slice(0, LANGUAGE_COLOURS);
  const colour = (name: string) => (named.includes(name) ? `var(--s${named.indexOf(name) + 1})` : "var(--other)");
  const years = profile.years.filter((y) => y.languages.length > 0);
  return (
    <Figure title="Languages over the years" note="Each repository's main language, weighted by their commits to it">
      {years.length === 0 ? (
        <p className="note">No commits on GitHub to tell from.</p>
      ) : (
        <>
          <Legend items={[...named.map((n) => ({ label: n, colour: colour(n) })), ...(ranked.length > named.length ? [{ label: "Other", colour: "var(--other)" }] : [])]} />
          <ol className="lang-years">
            {years.map((y) => {
              const sum = y.languages.reduce((n, l) => n + l.commits, 0);
              const other = y.languages.filter((l) => !named.includes(l.name)).reduce((n, l) => n + l.commits, 0);
              const parts = [...y.languages.filter((l) => named.includes(l.name)).map((l) => ({ name: l.name, commits: l.commits })), ...(other > 0 ? [{ name: "Other", commits: other }] : [])];
              return (
                <li key={y.year}>
                  <span className="lang-year">{y.year}</span>
                  <span className="lang-bar">
                    {parts.map((p) => (
                      <span key={p.name} style={{ width: `${(p.commits * 100) / Math.max(1, sum)}%`, background: p.name === "Other" ? "var(--other)" : colour(p.name) }} {...tip(<>{y.year}: {p.name}, {many(p.commits, "commit", "commits")}</>)} />
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
          <TableView head={["Year", "Language", "Commits"]} rows={years.flatMap((y) => y.languages.map((l) => [String(y.year), l.name, l.commits]))} />
        </>
      )}
    </Figure>
  );
}

/** The people who review a person's pull requests, and whose pull requests they review. */
export function Partners({ profile }: { profile: Profile }) {
  return (
    <Figure title="The people they work with most" note="Who reviewed their pull requests, and whose they reviewed">
      {profile.partners.length === 0 ? (
        <p className="note">No reviews either way yet.</p>
      ) : (
        <ul className="partners">
          {profile.partners.slice(0, 10).map((p) => (
            <li key={p.login}>
              <Face login={p.login} name={p.login} size={32} />
              <a href={`/u/${p.login}`}>{p.login}</a>
              <span className="note small">
                {[p.reviewedYours > 0 && `${many(p.reviewedYours, "review", "reviews")} from them`, p.reviewedTheirs > 0 && `${many(p.reviewedTheirs, "review", "reviews")} to them`].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Figure>
  );
}
