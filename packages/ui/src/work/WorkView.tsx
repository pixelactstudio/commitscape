import type { ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { GitCommitHorizontal, GitMerge, Lock } from "lucide-react";
import { groupWork, monthName, workTotals, type Work, type WorkItem } from "@commitscape/data";
import { Face } from "../components/Face";
import { Cell } from "../profile/view";
import { Stat } from "../kit/layout";
import { compact, grouped, many } from "../format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;
const longDay = (iso: string) => LONG.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** A period as words: "1 September to 30 September 2026". */
export function periodWords(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const first = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(a);
  return `${first} to ${LONG.format(b)}`;
}

/** A Proof of Work as a document: who and when, its numbers, then every merged pull request and commit by month and repository, with links. */
export function WorkView({ work, footer }: { work: Work; footer?: ReactNode }) {
  const t = workTotals(work.items);
  const months = groupWork(work.items);
  const name = work.name ?? work.login;
  return (
    <article className="overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface" aria-label={`${name}'s Proof of Work`}>
      <header className="flex flex-col gap-5 px-5 pt-6 pb-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:pt-7">
        <div className="flex min-w-0 items-center gap-4">
          <Face login={work.login} name={name} size={48} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lg font-semibold tracking-[-0.015em]">{name}</span>
            <span className="text-sm text-secondary">@{work.login}</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 sm:items-end sm:text-end">
          <span className="text-xs font-medium tracking-[0.08em] text-secondary uppercase">Proof of Work</span>
          <span className="text-sm font-medium">{periodWords(work.from, work.to)}</span>
          <span className="text-xs text-secondary">{work.filter ? `Only in ${work.filter}` : "Everywhere on GitHub"}</span>
        </div>
      </header>
      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        <Cell>
          <Stat value={grouped(t.prs)} label="Pull requests merged" note={`in ${many(t.repositories, "repository", "repositories")}`} />
        </Cell>
        <Cell>
          <Stat
            value={
              <span className="text-[1.3rem] whitespace-nowrap tnum sm:text-[1.6rem]">
                <span className="text-added">+{compact(t.additions)}</span> <span className="text-secondary">/</span> <span className="text-removed">−{compact(t.deletions)}</span>
              </span>
            }
            label="Lines merged"
            note="added and removed, in those pull requests"
          />
        </Cell>
        <Cell>
          <Stat value={grouped(t.commits)} label="Commits" note="without the squash merges of those pull requests" />
        </Cell>
        <Cell>
          <Stat value={grouped(t.repositories)} label={t.repositories === 1 ? "Repository" : "Repositories"} note={work.filter ? `in ${work.filter}` : "anywhere on GitHub"} />
        </Cell>
      </div>
      {work.truncated && (
        <div className="border-t border-line px-5 py-4 sm:px-7">
          <Banner status="info" title="GitHub returns at most 1,000 pull requests and 1,000 commits for one search. Narrow the period to see everything." />
        </div>
      )}
      {months.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-line px-6 py-16 text-center">
          <span className="font-medium">Nothing merged or committed in this period</span>
          <span className="max-w-md text-sm text-pretty text-secondary">
            {work.scope === "public" ? "Only public repositories count here. " : ""}Try a longer period{work.filter ? `, or look beyond ${work.filter}` : ""}.
          </span>
        </div>
      ) : (
        months.map((m) => <Month key={m.month} month={m.month} repositories={m.repositories} work={work} />)
      )}
      {footer && <footer className="border-t border-line px-5 py-4 text-xs text-secondary sm:px-7">{footer}</footer>}
    </article>
  );
}

function Month({ month, repositories, work }: { month: string; repositories: { repo: string; private: boolean; items: WorkItem[] }[]; work: Work }) {
  const items = repositories.flatMap((r) => r.items);
  const prs = items.filter((i) => i.kind === "pr").length;
  return (
    <section className="border-t border-line" aria-labelledby={`month-${month}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-[var(--color-background-body)]/40 px-5 py-3 sm:px-7">
        <h2 id={`month-${month}`} className="m-0 text-base font-semibold tracking-[-0.01em]">
          {monthName(month)}
        </h2>
        <span className="text-xs text-secondary tnum">{[prs > 0 && many(prs, "pull request", "pull requests"), items.length - prs > 0 && many(items.length - prs, "commit", "commits"), many(repositories.length, "repository", "repositories")].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="flex flex-col gap-6 px-5 pt-4 pb-6 sm:px-7">
        {repositories.map((r) => (
          <Repository key={r.repo} repo={r.repo} isPrivate={r.private} items={r.items} work={work} />
        ))}
      </div>
    </section>
  );
}

function Repository({ repo, isPrivate, items, work }: { repo: string; isPrivate: boolean; items: WorkItem[]; work: Work }) {
  const [owner = "", name = repo] = repo.split("/");
  const prs = items.filter((i) => i.kind === "pr").length;
  const commits = items.length - prs;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Face login={owner} name={owner} size={20} shape="rounded" />
        <h3 className="m-0 min-w-0 text-[0.95rem] font-semibold">
          <a href={`https://github.com/${repo}`} className="text-primary no-underline hover:underline">
            <span className="font-normal text-secondary">{owner}/</span>
            {name}
          </a>
        </h3>
        {isPrivate && <Badge label={work.shared ? "private, shared by choice" : work.scope === "self" ? "private: only you see this" : "private"} icon={<Lock size={11} aria-hidden />} variant="neutral" />}
        <span className="ms-auto text-xs text-secondary tnum">{[prs > 0 && many(prs, "pull request", "pull requests"), commits > 0 && many(commits, "commit", "commits")].filter(Boolean).join(" · ")}</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0 sm:ps-8">
        {items.map((i) => (
          <Row key={i.url} item={i} />
        ))}
      </ul>
    </div>
  );
}

function Row({ item }: { item: WorkItem }) {
  const pr = item.kind === "pr";
  const ref = pr ? `#${item.number}` : (item.sha ?? "").slice(0, 7);
  const lines = pr && (
    <span className="tnum">
      <span className="text-added">+{compact(item.additions ?? 0)}</span> <span className="text-removed">−{compact(item.deletions ?? 0)}</span>
    </span>
  );
  return (
    <li className="flex items-start gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <span className={`mt-0.5 flex-none ${pr ? "text-brand" : "text-secondary"}`} title={pr ? "Pull request, merged" : "Commit"}>
        {pr ? <GitMerge size={15} aria-label="Pull request, merged" /> : <GitCommitHorizontal size={15} aria-label="Commit" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a href={item.url} className="text-primary no-underline [overflow-wrap:anywhere] hover:underline">
          {item.title}
        </a>
        <span className="flex flex-wrap gap-x-2 text-xs text-secondary sm:hidden">
          <span className={pr ? "tnum" : "font-mono"}>{ref}</span>
          <span>{pr ? `merged ${day(item.at)}` : day(item.at)}</span>
          {lines}
        </span>
      </span>
      <span className={`mt-0.5 hidden w-16 flex-none text-end text-xs text-secondary sm:block ${pr ? "tnum" : "font-mono"}`}>{ref}</span>
      <time dateTime={item.at} title={longDay(item.at)} className="mt-0.5 hidden w-14 flex-none text-end text-xs text-secondary tnum sm:block">
        {day(item.at)}
      </time>
      <span className="mt-0.5 hidden w-24 flex-none text-end text-xs sm:block">{lines}</span>
    </li>
  );
}

/** A Proof of Work's stand-in while it is read from GitHub, the same shape as the document. */
export function WorkSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface">
      <div className="flex flex-col gap-5 px-5 pt-6 pb-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:pt-7">
        <div className="flex items-center gap-4">
          <Skeleton height={48} width={48} radius="rounded" />
          <div className="flex flex-col gap-2">
            <Skeleton height={18} width={160} radius={1} />
            <Skeleton height={13} width={90} radius={1} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <Skeleton height={12} width={100} radius={1} />
          <Skeleton height={15} width={220} radius={1} />
          <Skeleton height={12} width={130} radius={1} />
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Cell key={i}>
            <div className="flex flex-col gap-2.5">
              <Skeleton height={26} width="45%" index={i} radius={2} />
              <Skeleton height={14} width="65%" index={i} radius={1} />
              <Skeleton height={12} width="80%" index={i} radius={1} />
            </div>
          </Cell>
        ))}
      </div>
      <div className="border-t border-line px-5 py-3 sm:px-7">
        <Skeleton height={18} width={140} radius={1} />
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-5 sm:px-7">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={22} index={i} radius={1} />
        ))}
      </div>
    </div>
  );
}
