import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PULL_STALE_DAYS, type PullHeader } from "@commitscape/data";
import { hasInteracted } from "../branches/interacted";
import { CopyButton } from "../branches/Copy";
import { Face } from "../components/Face";
import { useStanding } from "../components/Name";
import { ICON } from "../design/tokens";
import { date, duration, many } from "../format";
import { A } from "../kit/A";
import { Pill } from "../kit/primitives";
import { LabelChip, Size } from "./Marks";
import { agoOf, DAY, lifeOf, lookOf, spanWords } from "./model";
import { Rail } from "./Rail";

function Fact({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-micro">{label}</dt>
      <dd className="m-0 min-w-0 text-base text-primary">{children}</dd>
      {note && <dd className="m-0 type-caption">{note}</dd>}
    </div>
  );
}

function Who({ login }: { login: string | null }) {
  const standing = useStanding(login);
  if (!login) return <span className="text-secondary">someone not read yet</span>;
  const name = standing ? (
    <A href={standing} className="inline-link min-w-0 truncate">
      {login}
    </A>
  ) : (
    <span className="truncate">{login}</span>
  );
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 align-middle">
      <Face login={login} name={login} size={20} />
      {name}
    </span>
  );
}

const DECISIONS = { approved: "Approved", changes_requested: "Changes requested", review_required: "Review required" } as const;

/** A pull request's header: its state, title, who opened and merged it, where it came from and went, its dates, size and labels, and the rail of its life beside them. */
export function Head({ h, back, github, anchor }: { h: PullHeader; back: string; github: string; anchor: number }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hasInteracted()) title.current?.focus({ preventScroll: true });
  }, [h.number]);
  const look = lookOf(h);
  const life = lifeOf(h, anchor);
  const idle = h.state === "open" && anchor - h.updatedAt >= PULL_STALE_DAYS * DAY;
  const head = h.head ? (h.fork && h.headOwner ? `${h.headOwner}:${h.head}` : h.head) : null;
  return (
    <div className="flex min-w-0 flex-col gap-4 surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <A href={back} className="inline-flex items-center gap-1.5 type-caption text-secondary no-underline hover:text-primary">
          <ArrowLeft size={ICON.sm} aria-hidden />
          All pull requests
        </A>
        <div className="flex items-center gap-1.5">
          <Button label="Open on GitHub" variant="secondary" size="sm" icon={<Icon icon={ExternalLink} size="sm" />} href={`${github}/pull/${h.number}`} target="_blank" rel="noopener noreferrer" />
          <CopyButton text={`${github}/pull/${h.number}`} label="Copy the pull request's address" />
        </div>
      </div>
      <div className="grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone={h.state === "open" ? "brand" : "neutral"} icon={<look.Icon size={ICON.xs} strokeWidth={1.75} absoluteStrokeWidth aria-hidden className={h.state === "open" && !h.draft ? "" : look.tone} />}>
                {look.word}
              </Pill>
              {h.state === "open" && h.decision && h.decision !== "review_required" && <Pill tone="quiet">{DECISIONS[h.decision]}</Pill>}
              {idle && <Pill tone="warning" title={`No update on GitHub for ${duration((anchor - h.updatedAt) / DAY)}`}>Idle over {PULL_STALE_DAYS} days</Pill>}
              <span className="type-caption tnum">#{h.number}</span>
            </span>
            <h2 ref={title} tabIndex={-1} className="m-0 type-title text-balance outline-offset-4 [overflow-wrap:anywhere]">
              {h.title || "(no title)"}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 type-description">
              <Who login={h.author} />
              {head && h.base ? (
                <>
                  <span>{h.state === "open" ? "wants to merge" : h.state === "merged" ? "opened this to merge" : "wanted to merge"}</span>
                  <code className="mono max-w-[16rem] truncate rounded-xs bg-sunken px-1.5 py-0.5 text-sm text-primary" title={head}>
                    {head}
                  </code>
                  <span>into</span>
                  <code className="mono max-w-[12rem] truncate rounded-xs bg-sunken px-1.5 py-0.5 text-sm text-primary" title={h.base}>
                    {h.base}
                  </code>
                </>
              ) : null}
            </div>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Opened" note={agoOf(anchor, h.createdAt)}>
              <span className="tnum">{date(h.createdAt)}</span>
            </Fact>
            {h.state === "merged" && (
              <Fact label="Merged" note={h.mergedAt === null ? undefined : agoOf(anchor, h.mergedAt)}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="tnum">{h.mergedAt === null ? "—" : date(h.mergedAt)}</span>
                  {h.mergedBy && <Who login={h.mergedBy} />}
                </span>
              </Fact>
            )}
            {h.state === "closed" && (
              <Fact label="Closed" note={h.closedAt === null ? "The date was not read yet" : agoOf(anchor, h.closedAt)}>
                <span className="tnum">{h.closedAt === null ? "—" : date(h.closedAt)}</span>
              </Fact>
            )}
            {h.state === "open" && (
              <Fact label="Last updated" note={agoOf(anchor, h.updatedAt)}>
                <span className="tnum">{date(h.updatedAt)}</span>
              </Fact>
            )}
            <Fact label={h.state === "open" ? "Open for" : h.state === "merged" ? "Time to merge" : "Open before it closed"}>
              <span className="tnum">{life === null ? "—" : spanWords(life)}</span>
            </Fact>
            <Fact label="Size" note={h.changedFiles === null && h.commits === null ? undefined : [h.changedFiles === null ? null : many(h.changedFiles, "file", "files"), h.commits === null ? null : many(h.commits, "commit", "commits")].filter(Boolean).join(" · ")}>
              <Size additions={h.additions} deletions={h.deletions} />
            </Fact>
            <Fact label="Talk" note={h.reviews.length === 0 ? "Nobody but the author reviewed it" : `${many(h.reviews.length, "reviewer", "reviewers")}`}>
              <span className="tnum">{h.comments === null ? "—" : many(h.comments, "comment", "comments")}</span>
            </Fact>
            {h.mergeCommit && (
              <Fact label="Merge commit">
                <a className="mono text-secondary" href={`${github}/commit/${h.mergeCommit}`} target="_blank" rel="noopener noreferrer" title="Open the commit on GitHub">
                  {h.mergeCommit.slice(0, 7)}
                </a>
              </Fact>
            )}
          </dl>
          {h.labels.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Labels">
              {h.labels.map((l) => (
                <li key={l.name}>
                  <LabelChip label={l} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <Rail h={h} anchor={anchor} />
      </div>
    </div>
  );
}
