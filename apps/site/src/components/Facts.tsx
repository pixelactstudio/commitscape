import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Archive, CalendarDays, GitFork, Scale, Star } from "lucide-react";
import type { Facts as Data } from "@commitscape/data";
import { avatarUrl, Cell, compact, Face, many, Page, Panel, Stat } from "@commitscape/ui";

const number = (n: number) => n.toLocaleString("en-US");
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const LANGUAGES = 6;

/** A small fact beside a repository's name: an icon and a few words. */
export function Chip({ icon, children, title, tone }: { icon?: ReactNode; children: ReactNode; title?: string; tone?: "brand" | "warning" }) {
  const colour = tone === "brand" ? "border-brand-line bg-brand-soft text-brand" : tone === "warning" ? "border-yellow-ring bg-yellow-subtle text-yellow-vivid" : "border-line bg-surface/70 text-secondary";
  return (
    <span title={title} className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm whitespace-nowrap ${colour}`}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

/** A repository's hero: its owner's face, its name and what GitHub says of it, drawn at once from the lookup, with the page's actions. */
export function RepoHero({ owner, name, facts, status, actions, attached = false }: { owner: string; name: string; facts: Data | null; status?: ReactNode; actions?: ReactNode; attached?: boolean }) {
  const language = facts?.languages[0]?.name;
  return (
    <section className={`face-backdrop relative overflow-hidden ${attached ? "" : "border-b border-line"}`} style={{ "--face": `url(${avatarUrl(owner, 64)})` } as CSSProperties}>
      <Page className={`relative flex flex-col gap-6 pt-9 md:flex-row md:items-end md:justify-between ${attached ? "pb-6" : "pb-7"}`}>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <img src={avatarUrl(owner, 96)} alt="" width={80} height={80} className="aspect-square size-18 flex-none self-start rounded-2xl bg-muted shadow-float ring-4 ring-body sm:size-20 sm:self-center" />
          <div className="flex min-w-0 flex-col gap-2">
            <Link to="/u/$login" params={{ login: owner }} className="w-fit text-xs font-medium text-primary no-underline opacity-75 hover:opacity-100">
              {owner}
            </Link>
            <h1 className="m-0 type-display break-words">{name}</h1>
            {facts?.description && <p className="m-0 max-w-2xl text-md text-pretty">{facts.description}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {facts && (
                <>
                  <Chip icon={<Star size={12} aria-hidden />} title={many(facts.stars, "star", "stars")}>
                    {compact(facts.stars)} stars
                  </Chip>
                  <Chip icon={<GitFork size={12} aria-hidden />} title={many(facts.forks, "fork", "forks")}>
                    {compact(facts.forks)} forks
                  </Chip>
                  {language && <Chip icon={<span className="size-2 flex-none rounded-full bg-(--s1)" aria-hidden />}>{language}</Chip>}
                  {facts.license && facts.license !== "NOASSERTION" && <Chip icon={<Scale size={12} aria-hidden />}>{facts.license}</Chip>}
                  <Chip icon={<CalendarDays size={12} aria-hidden />}>since {date(facts.createdAt)}</Chip>
                  {facts.archived && (
                    <Chip icon={<Archive size={12} aria-hidden />} tone="warning">
                      archived
                    </Chip>
                  )}
                </>
              )}
              {status}
            </div>
          </div>
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
      </Page>
    </section>
  );
}

/** What GitHub says of a repository while it has no Report: its numbers, languages, top contributors and releases. */
export function GitHubFacts({ facts }: { facts: Data }) {
  const bytes = Math.max(1, facts.languages.reduce((n, l) => n + l.bytes, 0));
  const named = facts.languages.slice(0, LANGUAGES);
  const rest = facts.languages.slice(LANGUAGES).reduce((n, l) => n + l.bytes, 0);
  const parts = [...named.map((l, i) => ({ name: l.name, bytes: l.bytes, colour: `var(--s${i + 1})` })), ...(rest > 0 ? [{ name: "Other", bytes: rest, colour: "var(--other)" }] : [])];
  const most = Math.max(1, ...facts.contributors.map((c) => c.contributions));
  return (
    <div className="flex flex-col gap-gutter">
      <div className="grid overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Cell small>
            <Stat value={number(facts.stars)} label="stars" note="people who starred it" />
          </Cell>
          <Cell small>
            <Stat value={number(facts.forks)} label="forks" note="copies on GitHub" />
          </Cell>
          <Cell small>
            <Stat value={number(facts.openIssues)} label="open issues" note="and pull requests" />
          </Cell>
          <Cell small>
            <Stat value={date(facts.createdAt)} label="created" note={`last pushed ${date(facts.pushedAt)}`} />
          </Cell>
        </div>
      </div>
      {facts.topics.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Topics">
          {facts.topics.map((t) => (
            <li key={t} className="inline-flex h-6 items-center rounded-full bg-blue-subtle px-2.5 text-xs font-medium text-blue-vivid">
              {t}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-gutter lg:grid-cols-2">
        <Panel title="Languages" description="As GitHub counts them, by bytes" className="h-full [&>*]:h-full">
          {parts.length === 0 ? (
            <p className="m-0 py-6 text-center type-caption">GitHub names no language for it.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {parts.map((p) => (
                  <span key={p.name} className="block h-full min-w-0.75" style={{ width: `${(p.bytes * 100) / bytes}%`, background: p.colour }} />
                ))}
              </span>
              <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-0">
                {parts.map((p) => (
                  <li key={p.name} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="size-2.5 flex-none rounded-full" style={{ background: p.colour }} aria-hidden />
                    <span className="truncate">{p.name}</span>
                    <span className="ms-auto text-xs text-secondary tnum">{Math.max(1, Math.round((p.bytes * 100) / bytes))}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
        <Panel title="Who GitHub says contributed most" description="By commits GitHub linked to an account" className="h-full [&>*]:h-full">
          {facts.contributors.length === 0 ? (
            <p className="m-0 py-6 text-center type-caption">GitHub links no commits to an account here.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {facts.contributors.slice(0, 8).map((c) => (
                <li key={c.login}>
                  <Link to="/u/$login" params={{ login: c.login }} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-primary no-underline transition-colors hover:bg-sunken">
                    <Face login={c.login} name={c.login} size={24} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{c.login}</span>
                      <span className="block h-1 w-full max-w-56 overflow-hidden rounded-full bg-track" aria-hidden>
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${(c.contributions * 100) / most}%` }} />
                      </span>
                    </span>
                    <span className="flex-none text-xs text-secondary tnum">{many(c.contributions, "commit", "commits")}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      {facts.releases.length > 0 && (
        <Panel title="Recent releases" description="As GitHub lists them">
          <ul className="m-0 flex list-none flex-col p-0">
            {facts.releases.slice(0, 5).map((r) => (
              <li key={r.tag} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
                <span className="min-w-0 truncate font-medium">{r.name || r.tag}</span>
                <span className="flex-none text-xs text-secondary tnum">
                  <code className="font-mono">{r.tag}</code> · {date(r.at)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
