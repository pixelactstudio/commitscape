import { useMemo, type ReactNode } from "react";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, ExternalLink, MessageSquare, X } from "lucide-react";
import type { PullConversation as Thread } from "@commitscape/data";
import { date, Face, ICON, many, Pill, plainMarkdown, type PillTone } from "@commitscape/ui";
import { Locked } from "#/components/Locked";
import { Section } from "#/components/Boundary";
import { isLocked } from "#/lib/gates";
import { pullConversationQuery } from "#/lib/queries";

type Entry = { key: string; login: string | null; at: string | null; note: string; badge?: { tone: PillTone; word: string; icon: ReactNode }; body: string; url: string | null };

const seconds = (iso: string | null): number => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

const stamp = (iso: string | null): string => (iso ? `${date(seconds(iso))}, ${new Date(iso).toISOString().slice(11, 16)} UTC` : "");

const VERDICT: Record<string, { note: string; badge?: { tone: PillTone; word: string; icon: ReactNode } }> = {
  APPROVED: { note: "reviewed", badge: { tone: "brand", word: "Approved", icon: <Check size={ICON.xs} strokeWidth={2.5} aria-hidden /> } },
  CHANGES_REQUESTED: { note: "reviewed", badge: { tone: "warning", word: "Changes requested", icon: <X size={ICON.xs} strokeWidth={2.5} aria-hidden /> } },
  COMMENTED: { note: "reviewed" },
  DISMISSED: { note: "had a review dismissed", badge: { tone: "quiet", word: "Dismissed", icon: null } },
};

function entriesOf(c: Thread): Entry[] {
  const reviews: Entry[] = c.reviews
    .filter((r) => r.body.trim() !== "" || r.state !== "COMMENTED")
    .map((r) => ({ key: `r${r.id}`, login: r.login, at: r.at, note: VERDICT[r.state]?.note ?? r.state.toLowerCase(), badge: VERDICT[r.state]?.badge, body: r.body, url: r.url || null }));
  const comments: Entry[] = c.comments.map((m) => ({ key: `c${m.id}`, login: m.login, at: m.at, note: "commented", body: m.body, url: m.url || null }));
  return [...reviews, ...comments].sort((a, b) => seconds(a.at) - seconds(b.at));
}

const COMPONENTS: Partial<MarkdownComponents> = {
  link: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-link">
      {children}
    </a>
  ),
  image: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="inline-link">
      {alt ? `[${alt}]` : "[picture]"}
    </a>
  ),
};

function Body({ text }: { text: string }) {
  const source = useMemo(() => plainMarkdown(text).trim(), [text]);
  return (
    <div className="min-w-0 type-body text-primary [overflow-wrap:anywhere]">
      <Markdown headingLevelStart={4} components={COMPONENTS} autolink="gfm">
        {source}
      </Markdown>
    </div>
  );
}

function Card({ login, at, note, badge, url, children }: { login: string | null; at: string | null; note: string; badge?: Entry["badge"]; url: string | null; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col surface">
      <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator px-4 py-2">
        <Face login={login} name={login ?? "someone"} size={24} />
        <span className="min-w-0 truncate type-label">{login ?? "someone"}</span>
        <span className="type-caption">{note}</span>
        {badge && (
          <Pill tone={badge.tone} icon={badge.icon}>
            {badge.word}
          </Pill>
        )}
        <time className="ms-auto type-caption whitespace-nowrap tnum" dateTime={at ?? undefined}>
          {stamp(at)}
        </time>
        {url && (
          <a className="plain-button hit grid size-7 place-items-center rounded-sm text-secondary hover:bg-hover hover:text-primary" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open this on GitHub" title="Open this on GitHub">
            <ExternalLink size={ICON.xs} aria-hidden />
          </a>
        )}
      </div>
      <div className="min-w-0 px-4 py-3">{children}</div>
    </li>
  );
}

function Read({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const { data: c } = useSuspenseQuery(pullConversationQuery(owner, repo, number));
  if (isLocked(c)) return <Locked gate={c.locked} height={320} />;
  const entries = entriesOf(c);
  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        <Card login={c.login} at={c.at} note="opened this" url={c.url}>
          {c.body.trim() === "" ? <p className="m-0 type-caption">No description.</p> : <Body text={c.body} />}
        </Card>
        {entries.map((e) => (
          <Card key={e.key} login={e.login} at={e.at} note={e.note} badge={e.badge} url={e.url}>
            {e.body.trim() === "" ? <p className="m-0 type-caption">No comment with it.</p> : <Body text={e.body} />}
          </Card>
        ))}
      </ol>
      {entries.length === 0 && <p className="m-0 type-caption">Nobody has commented or reviewed it yet.</p>}
      <p className="m-0 flex items-start gap-1.5 type-micro text-pretty">
        <MessageSquare size={ICON.xs} className="mt-0.5 flex-none" aria-hidden />
        <span>
          {many(c.comments.length, "comment", "comments")} and {many(c.reviews.length, "review", "reviews")}, from GitHub with your own token and kept for you for five minutes. The first 50 of each are shown; notes on single lines of the diff are on GitHub.
        </span>
      </p>
    </section>
  );
}

/** A pull request's description, comments and reviews in the order they came, from GitHub with the signed-in person's own token; a sign-in prompt in their place for people signed out. */
export function PullConversation({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  return (
    <Section
      fallback={
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the conversation">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-32 flex-col gap-3 surface p-4">
              <Skeleton height={24} width="32%" radius={2} index={i} />
              <Skeleton height={14} radius={1} index={i} />
              <Skeleton height={14} width="70%" radius={1} index={i} />
            </div>
          ))}
        </div>
      }
    >
      <Read owner={owner} repo={repo} number={number} />
    </Section>
  );
}
