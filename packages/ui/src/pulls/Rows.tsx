import { Skeleton } from "@astryxdesign/core/Skeleton";
import { ArrowRight, MessageSquare } from "lucide-react";
import { PULL_STALE_DAYS, type PullRow } from "@commitscape/data";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { duration, grouped, many } from "../format";
import { A } from "../kit/A";
import { LabelChip, Reviewer, Size, StateMark } from "./Marks";
import { agoOf, DAY, lifeOf, REVIEW_WORDS, spanParts, spanWords } from "./model";

const LABELS_SHOWN = 3;

function Time({ row, anchor }: { row: PullRow; anchor: number }) {
  const life = lifeOf(row, anchor);
  if (life === null) return <span className="type-caption text-tertiary">—</span>;
  const words = spanWords(life);
  const title = row.state === "open" ? `Opened ${agoOf(anchor, row.createdAt)}` : row.state === "merged" ? `Merged ${words} after it was opened` : `Closed ${words} after it was opened`;
  const [n, unit] = spanParts(life);
  return (
    <span className="type-caption whitespace-nowrap tnum" title={title}>
      {row.state === "open" ? (
        `${words} open`
      ) : (
        <>
          <span className="text-primary">
            {n} {unit}
          </span>
          <span className="text-tertiary"> to {row.state === "merged" ? "merge" : "close"}</span>
        </>
      )}
    </span>
  );
}

function Person({ login, onPick }: { login: string; onPick?: () => void }) {
  const face = <Face login={login} name={login} size={16} decorative />;
  if (!onPick)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {face}
        {login}
      </span>
    );
  return (
    <button type="button" onClick={onPick} className="plain-button inline-flex items-center gap-1 rounded-xs whitespace-nowrap text-secondary hover:text-primary hover:underline" title={`Show ${login}'s pull requests`}>
      {face}
      {login}
    </button>
  );
}

/** One pull request as a row: where it stands, its title and labels, who opened and merged it, how large it is, who reviewed it and how long it took or has taken. */
export function PullItem({ row, anchor, href, onAuthor }: { row: PullRow; anchor: number; href: string; onAuthor: (login: string) => void }) {
  const idle = row.state === "open" && anchor - row.updatedAt >= PULL_STALE_DAYS * DAY;
  const reviewers = row.reviewers.slice(0, 3);
  const when = row.state === "merged" && row.mergedAt !== null ? `merged ${agoOf(anchor, row.mergedAt)}` : row.state === "closed" && row.closedAt !== null ? `closed ${agoOf(anchor, row.closedAt)}` : `opened ${agoOf(anchor, row.createdAt)}`;
  return (
    <li className="row-hover grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-separator px-4 py-3 last:border-b-0 xl:grid-cols-[1.25rem_minmax(0,1fr)_auto] xl:items-center" data-pull={row.number}>
      <span className="pt-0.5 xl:pt-0">
        <StateMark row={row} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <A href={href} className="min-w-0 text-base font-medium text-primary no-underline [overflow-wrap:anywhere] hover:underline sm:truncate" title={row.title}>
            {row.title || "(no title)"}
          </A>
          {row.draft && <span className="flex-none rounded-xs bg-sunken px-1.5 text-xs font-medium text-secondary">Draft</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-caption">
          <span className="tnum">#{row.number}</span>
          {row.author && (
            <span className="inline-flex items-center gap-1.5">
              <Person login={row.author} onPick={() => onAuthor(row.author ?? "")} />
              {row.state === "merged" && row.mergedBy && row.mergedBy !== row.author && (
                <>
                  <ArrowRight size={ICON.xs} aria-hidden />
                  <span className="sr-only">merged by</span>
                  <Person login={row.mergedBy} />
                </>
              )}
            </span>
          )}
          <span className="whitespace-nowrap">{when}</span>
          {idle && (
            <span className="rounded-xs bg-yellow-subtle px-1.5 text-xs font-medium text-yellow-vivid" title={`No update on GitHub for ${duration((anchor - row.updatedAt) / DAY)}`}>
              Idle {duration((anchor - row.updatedAt) / DAY)}
            </span>
          )}
          {row.labels.slice(0, LABELS_SHOWN).map((l) => (
            <LabelChip key={l.name} label={l} />
          ))}
          {row.labels.length > LABELS_SHOWN && <span className="type-micro tnum" title={row.labels.slice(LABELS_SHOWN).map((l) => l.name).join(", ")}>+{row.labels.length - LABELS_SHOWN}</span>}
        </span>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 xl:col-start-3 xl:flex-nowrap xl:gap-x-0">
        <Size additions={row.additions} deletions={row.deletions} className="xl:w-36" />
        <span className="flex h-6 items-center xl:w-24" role="group" aria-label={row.reviewers.length === 0 ? "Not reviewed" : `Reviewed by ${row.reviewers.map((login, i) => { const state = row.reviewStates?.[i]; return state ? `${login} (${REVIEW_WORDS[state]})` : login; }).join(", ")}`}>
          {reviewers.length === 0 ? (
            <span className="type-micro text-tertiary">No review</span>
          ) : (
            <span className="flex items-center -space-x-1">
              {reviewers.map((login, i) => (
                <Reviewer key={login} login={login} state={row.reviewStates?.[i] ?? null} />
              ))}
              {row.reviewers.length > reviewers.length && <span className="ps-2.5 type-micro tnum">+{row.reviewers.length - reviewers.length}</span>}
            </span>
          )}
        </span>
        <span className="flex w-10 items-center gap-1 type-caption tnum" title={row.comments === null ? "Comments not read yet" : many(row.comments, "comment", "comments")}>
          <MessageSquare size={ICON.xs} aria-hidden />
          {row.comments === null ? "—" : grouped(row.comments)}
        </span>
        <span className="xl:w-32 xl:text-end">
          <Time row={row} anchor={anchor} />
        </span>
      </div>
    </li>
  );
}

/** Rows of the pull request list while the list is on its way, at the height real rows have. */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ol className="m-0 list-none p-0" aria-busy="true" aria-label="Loading the pull requests">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-[9.75rem] items-start gap-3 border-b border-separator px-4 py-3 last:border-b-0 sm:min-h-[6.25rem] xl:min-h-[4.3rem] xl:items-center">
          <Skeleton height={16} width={16} radius={4} index={i} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton height={16} width={`${38 + ((i * 23) % 44)}%`} radius={1} index={i} />
            <Skeleton height={14} width={`${20 + ((i * 17) % 22)}%`} radius={1} index={i} />
            <span className="xl:hidden">
              <Skeleton height={24} width="62%" radius={2} index={i} />
            </span>
          </div>
          <span className="hidden xl:block">
            <Skeleton height={20} width={380} radius={2} index={i} />
          </span>
        </li>
      ))}
    </ol>
  );
}
