import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { CircleCheck, GitCommitHorizontal, GitMerge, Lock, X } from "lucide-react";
import { groupWork, kindOf, monthName, percent, workSummary, type Work, type WorkItem, type WorkKind } from "@commitscape/data";
import { Face } from "../components/Face";
import { Nothing } from "../motion";
import { Stat } from "../kit/layout";
import { ICON } from "../design/tokens";
import { compact, grouped, many } from "../format";
import { KIND_COLOURS, periodWords } from "./helpers";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const FIRST = 40;
const STEP = 60;
const STICK = "sticky top-header z-[var(--z-sticky)]";

const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;
const longDay = (iso: string) => LONG.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export type WorkGroup = "month" | "repository";
export type WorkLook = { group: WorkGroup; kind: WorkKind | null };

/** A Proof of Work as a document: its numbers, what kind of work it was, then every merged pull request and commit, grouped by month or repository, drawn as you scroll. */
export function WorkView({ work, look, onLook, footer }: { work: Work; look?: WorkLook; onLook?: (look: WorkLook) => void; footer?: ReactNode }) {
  const [own, setOwn] = useState<WorkLook>({ group: "month", kind: null });
  const view = look ?? own;
  const change = (next: Partial<WorkLook>) => (onLook ?? setOwn)({ ...view, ...next });
  const summary = useMemo(() => workSummary(work.items), [work.items]);
  const t = summary.totals;
  const name = work.name ?? work.login;
  const kind = view.kind && summary.kinds.some((k) => k.kind === view.kind) ? view.kind : null;
  const items = useMemo(() => (kind ? work.items.filter((i) => kindOf(i.title) === kind) : work.items), [work.items, kind]);
  const days = span(work.from, work.to);
  return (
    <article className="overflow-clip rounded-lg border border-line bg-surface" aria-label={`${name}'s Proof of Work`}>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Stat value={grouped(t.prs)} label="Pull requests merged" note={`in ${many(t.repositories, "repository", "repositories")}`} />
        </Cell>
        <Cell>
          <Stat
            value={
              <span className="whitespace-nowrap max-sm:text-xl">
                <span className="text-added">+{compact(t.additions)}</span> <span className="text-secondary">/</span> <span className="text-removed">−{compact(t.deletions)}</span>
              </span>
            }
            label="Lines merged"
            note="added and removed, in those pull requests"
          />
        </Cell>
        <Cell>
          <Stat value={grouped(t.commits)} label="Commits" note="besides the merges of those pull requests" />
        </Cell>
        <Cell>
          <Stat value={grouped(summary.activeDays)} label="Active days" note={`of the period's ${many(days, "day", "days")}`} />
        </Cell>
      </div>
      {summary.kinds.length > 0 && <Kinds kinds={summary.kinds} active={kind} onPick={(k) => change({ kind: k === kind ? null : k })} />}
      {work.truncated && (
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <Banner status="info" title="GitHub returns at most 1,000 pull requests and 1,000 commits for one search. Narrow the period to see everything." />
        </div>
      )}
      {work.items.length === 0 ? (
        <div className="border-t border-line px-5 py-6 sm:px-6">
          <Nothing
            title="Nothing merged or committed in this period"
            words={`${work.scope === "public" ? "Only public repositories count here. " : ""}Try a longer period${work.filter ? `, or look beyond ${work.filter}` : ""}.`}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="type-label">{kind ? `${summary.kinds.find((k) => k.kind === kind)?.label}` : "Everything"}</span>
              <span className="type-caption tnum">{many(items.length, "item", "items")}</span>
              {kind && (
                <button type="button" onClick={() => change({ kind: null })} className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-line bg-transparent px-2.5 text-xs text-secondary transition-colors hover:border-line-strong hover:text-primary">
                  <X size={ICON.xs} aria-hidden /> Show every kind
                </button>
              )}
            </div>
            <SegmentedControl label="Group by" size="sm" value={view.group} onChange={(g) => change({ group: g as WorkGroup })}>
              <SegmentedControlItem value="month" label="By month" />
              <SegmentedControlItem value="repository" label="By repository" />
            </SegmentedControl>
          </div>
          <List key={`${view.group}${kind ?? ""}${work.items.length}${work.filter ?? ""}`} items={items} group={view.group} work={work} />
        </>
      )}
      {footer && <footer className="border-t border-line px-5 py-4 type-caption sm:px-6">{footer}</footer>}
    </article>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <div className="min-w-0 border-line px-5 py-5 sm:px-6 [&:not(:last-child)]:border-e max-lg:[&:nth-child(2n)]:border-e-0 max-lg:[&:nth-child(n+3)]:border-t">{children}</div>;
}

function Kinds({ kinds, active, onPick }: { kinds: ReturnType<typeof workSummary>["kinds"]; active: WorkKind | null; onPick: (k: WorkKind) => void }) {
  return (
    <section aria-label="Kind of work" className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 type-label">Kind of work</h2>
        <span className="type-caption">From conventional prefixes and the words of each title. Pick one to list only it.</span>
      </div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {kinds.map((k) => (
          <span key={k.kind} className="h-full min-w-1 transition-opacity duration-[var(--duration-fast)]" style={{ flexGrow: k.count, background: KIND_COLOURS[k.kind], opacity: active && active !== k.kind ? 0.25 : 1 }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {kinds.map((k) => (
          <li key={k.kind}>
            <button
              type="button"
              aria-pressed={active === k.kind}
              onClick={() => onPick(k.kind)}
              className={`inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${active === k.kind ? "border-primary bg-overlay-hover text-primary" : "border-line bg-transparent text-primary hover:border-line-strong"}`}
            >
              <span className="size-2 rounded-full" style={{ background: KIND_COLOURS[k.kind] }} aria-hidden />
              {k.short}
              <span className="font-normal text-secondary tnum">
                {grouped(k.count)} · {percent(k.share)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Block = { key: string; title: ReactNode; meta: string; repo?: { repo: string; private: boolean }; rows: { repo: string; private: boolean; items: WorkItem[]; meta: string }[] };

function counts(items: WorkItem[]) {
  const prs = items.filter((i) => i.kind === "pr").length;
  return [prs > 0 && many(prs, "pull request", "pull requests"), items.length - prs > 0 && many(items.length - prs, "commit", "commits")].filter(Boolean).join(" · ");
}

function blocksOf(items: WorkItem[], group: WorkGroup): Block[] {
  if (group === "month")
    return groupWork(items).map((m) => {
      const all = m.repositories.flatMap((r) => r.items);
      return { key: m.month, title: monthName(m.month), meta: `${counts(all)} · ${many(m.repositories.length, "repository", "repositories")}`, rows: m.repositories.map((r) => ({ ...r, meta: counts(r.items) })) };
    });
  const repos = new Map<string, WorkItem[]>();
  for (const i of items) repos.set(i.repo, [...(repos.get(i.repo) ?? []), i]);
  return [...repos.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([repo, list]) => {
      const sorted = [...list].sort((a, b) => (a.at < b.at ? 1 : -1));
      const isPrivate = list.some((i) => i.private);
      return { key: repo, title: repo, meta: counts(list), repo: { repo, private: isPrivate }, rows: [{ repo, private: isPrivate, items: sorted, meta: "" }] };
    });
}

function trim(blocks: Block[], limit: number): Block[] {
  const out: Block[] = [];
  let left = limit;
  for (const b of blocks) {
    if (left <= 0) break;
    const rows: Block["rows"] = [];
    for (const r of b.rows) {
      if (left <= 0) break;
      rows.push({ ...r, items: r.items.slice(0, left) });
      left -= r.items.length;
    }
    out.push({ ...b, rows });
  }
  return out;
}

function List({ items, group, work }: { items: WorkItem[]; group: WorkGroup; work: Work }) {
  const [limit, setLimit] = useState(FIRST);
  const end = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => blocksOf(items, group), [items, group]);
  const shown = useMemo(() => trim(blocks, limit), [blocks, limit]);
  const more = limit < items.length;
  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setLimit((l) => l + STEP), { rootMargin: "0px 0px 900px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [more, limit]);
  return (
    <div>
      {shown.map((b) => (
        <section key={b.key} className="border-t border-line" aria-labelledby={`g-${b.key}`}>
          <div className={`${STICK} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-5 py-2.5 backdrop-blur-md sm:px-6`}>
            {b.repo ? (
              <RepoTitle id={`g-${b.key}`} repo={b.repo.repo} isPrivate={b.repo.private} work={work} level={2} />
            ) : (
              <h2 id={`g-${b.key}`} className="m-0 type-panel">
                {b.title}
              </h2>
            )}
            <span className="type-caption tnum">{b.meta}</span>
          </div>
          <div className="flex flex-col gap-5 px-5 pt-3 pb-5 sm:px-6">
            {b.rows.map((r) => (
              <div key={r.repo} className="flex min-w-0 flex-col gap-1">
                {!b.repo && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                    <RepoTitle repo={r.repo} isPrivate={r.private} work={work} level={3} />
                    <span className="ms-auto type-caption tnum">{r.meta}</span>
                  </div>
                )}
                <ul className={`m-0 flex list-none flex-col p-0 ${b.repo ? "" : "sm:ps-8"}`}>
                  {r.items.map((i) => (
                    <Row key={i.url} item={i} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div ref={end} className="border-t border-line px-5 py-5 sm:px-6" aria-live="polite">
        {more ? (
          <div className="flex flex-col gap-2">
            <span className="type-caption tnum">
              Showing {grouped(Math.min(limit, items.length))} of {grouped(items.length)}. More appear as you scroll.
            </span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={18} index={i} radius={1} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 type-caption">
            <span className="h-px flex-1 bg-line" />
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck size={ICON.sm} aria-hidden className="text-brand" />
              {items.length === 1 ? "That is the one item" : `That is all ${grouped(items.length)}`}, {periodWords(work.from, work.to)}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        )}
      </div>
    </div>
  );
}

function RepoTitle({ id, repo, isPrivate, work, level }: { id?: string; repo: string; isPrivate: boolean; work: Work; level: 2 | 3 }) {
  const [owner = "", name = repo] = repo.split("/");
  const H = level === 2 ? "h2" : "h3";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Face login={owner} name={owner} size={20} shape="rounded" />
      <H id={id} className="m-0 min-w-0 text-md font-semibold tracking-tight [overflow-wrap:anywhere]">
        <a href={`https://github.com/${repo}`} className="text-primary no-underline hover:underline">
          <span className="font-normal text-secondary">{owner}/</span>
          {name}
        </a>
      </H>
      {isPrivate && <Badge label={work.shared ? "private, shared by choice" : work.scope === "self" ? "private: only you see this" : "private"} icon={<Lock size={ICON.xs} aria-hidden />} variant="neutral" />}
    </span>
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
    <li className="flex items-start gap-3 border-b border-line py-2 text-base last:border-b-0">
      <span className={`mt-0.5 flex-none ${pr ? "text-brand" : "text-secondary"}`} title={pr ? "Pull request, merged" : "Commit"}>
        {pr ? <GitMerge size={ICON.md} aria-label="Pull request, merged" /> : <GitCommitHorizontal size={ICON.md} aria-label="Commit" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a href={item.url} className="text-primary no-underline [overflow-wrap:anywhere] hover:underline">
          {item.title}
        </a>
        <span className="flex flex-wrap gap-x-2 type-caption sm:hidden">
          <span className={pr ? "tnum" : "font-mono"}>{ref}</span>
          <span>{pr ? `merged ${day(item.at)}` : day(item.at)}</span>
          {lines}
        </span>
      </span>
      <span className={`mt-0.5 hidden w-16 flex-none text-end type-caption sm:block ${pr ? "tnum" : "font-mono"}`}>{ref}</span>
      <time dateTime={item.at} title={longDay(item.at)} className="mt-0.5 hidden w-14 flex-none text-end type-caption tnum sm:block">
        {day(item.at)}
      </time>
      <span className="mt-0.5 hidden w-24 flex-none text-end text-xs sm:block">{lines}</span>
    </li>
  );
}

/** A Proof of Work's stand-in while it is read from GitHub, the same shape as the document. */
export function WorkSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
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
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:px-6">
        <Skeleton height={14} width={110} radius={1} />
        <Skeleton height={10} radius="rounded" />
        <div className="flex flex-wrap gap-1.5">
          {[90, 70, 80, 60, 64].map((w, i) => (
            <Skeleton key={i} height={24} width={w} index={i} radius="rounded" />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 sm:px-6">
        <Skeleton height={16} width={140} radius={1} />
        <Skeleton height={28} width={200} radius={2} />
      </div>
      <div className="border-t border-line px-5 py-3 sm:px-6">
        <Skeleton height={18} width={140} radius={1} />
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-5 sm:px-6">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={22} index={i} radius={1} />
        ))}
      </div>
    </div>
  );
}
