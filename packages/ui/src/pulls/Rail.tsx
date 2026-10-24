import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Check, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, Minus, X } from "lucide-react";
import type { PullHeader } from "@commitscape/data";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { date, many } from "../format";
import { momentsOf, spanWords, type Moment } from "./model";

const SHOWN = 6;

function Node({ m }: { m: Moment }) {
  const frame = "grid size-5 flex-none place-items-center rounded-full";
  if (m.kind === "opened") return <span className={`${frame} bg-brand-soft text-brand`}><GitPullRequest size={ICON.xs} strokeWidth={2} aria-hidden /></span>;
  if (m.kind === "merged") return <span className={`${frame} bg-sunken text-(--s6)`}><GitMerge size={ICON.xs} strokeWidth={2} aria-hidden /></span>;
  if (m.kind === "closed") return <span className={`${frame} bg-sunken text-removed`}><GitPullRequestClosed size={ICON.xs} strokeWidth={2} aria-hidden /></span>;
  if (m.kind === "now") return <span className={`${frame} border border-dashed border-line-strong text-secondary`} aria-hidden />;
  if (m.state === "approved") return <span className={`${frame} bg-added-solid text-on-brand`}><Check size={ICON.xs} strokeWidth={3} aria-hidden /></span>;
  if (m.state === "changes_requested") return <span className={`${frame} bg-removed-solid text-on-brand`}><X size={ICON.xs} strokeWidth={3} aria-hidden /></span>;
  if (m.state === "dismissed") return <span className={`${frame} bg-sunken text-secondary`}><Minus size={ICON.xs} strokeWidth={3} aria-hidden /></span>;
  return <span className={`${frame} bg-sunken text-secondary`}><MessageSquare size={ICON.xs} strokeWidth={2} aria-hidden /></span>;
}

function when(m: Moment, opened: number): ReactNode {
  if (m.kind === "opened") return date(opened);
  const after = m.at - opened;
  return after < 60 ? "at once" : `+${spanWords(after)}`;
}

/** The rail beside a pull request's header: its moments top to bottom, each with who and when after it opened. */
export function Rail({ h, anchor }: { h: PullHeader; anchor: number }) {
  const moments = momentsOf(h, anchor);
  const [all, setAll] = useState(false);
  const shown = all || moments.length <= SHOWN + 1 ? moments : [...moments.slice(0, SHOWN - 1), ...moments.slice(-1)];
  const hidden = moments.length - shown.length;
  const reviewed = h.reviews.length;
  return (
    <section aria-label="Timeline" className="flex min-w-0 flex-col gap-3 self-start rounded-lg bg-sunken p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 type-label">Timeline</h3>
        <span className="type-micro tnum">{reviewed === 0 ? "No review" : many(reviewed, "reviewer", "reviewers")}</span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {shown.map((m, i) => (
          <li key={m.key} className="relative flex items-start gap-3 pb-3 last:pb-0">
            {i < shown.length - 1 && <span aria-hidden className="absolute start-2.5 top-5 -bottom-0.5 w-px -translate-x-1/2 bg-line-strong" />}
            <Node m={m} />
            <span className="flex min-w-0 flex-1 items-start justify-between gap-2 text-sm leading-5">
              <span className="min-w-0">
                {m.who && (
                  <span className="me-1.5 inline-flex items-center gap-1 align-middle font-medium">
                    <Face login={m.who} name={m.who} size={16} />
                    <span className="truncate">{m.who}</span>
                  </span>
                )}
                <span className={m.kind === "now" ? "text-secondary" : ""}>{m.verb}</span>
              </span>
              <time className="flex-none type-caption whitespace-nowrap tnum" dateTime={new Date(m.at * 1000).toISOString()} title={new Date(m.at * 1000).toUTCString()}>
                {m.kind === "now" ? `${spanWords(Math.max(0, m.at - h.createdAt))}` : when(m, h.createdAt)}
              </time>
            </span>
          </li>
        ))}
      </ol>
      {moments.length > SHOWN + 1 && <Button label={all ? "Show fewer" : `Show the ${hidden} in between`} variant="ghost" size="sm" onClick={() => setAll((v) => !v)} />}
      {h.reviews.length > 0 && h.reviews.every((r) => r.state === null) && <p className="m-0 type-micro">What each review said is read for pull requests opened or updated lately; older ones show only who reviewed.</p>}
    </section>
  );
}
