import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import { pullOf } from "@commitscape/data";
import { A } from "../kit/A";
import { ICON } from "../design/tokens";

export type PullRef = { number: number; state: string; draft?: boolean | null | undefined; title?: string | undefined };

const LOOK = "inline-flex h-6 flex-none items-center gap-1 rounded-full border border-line bg-sunken px-2 text-xs font-medium whitespace-nowrap text-secondary no-underline tnum transition-colors duration-(--duration-instant) hover:border-line-strong hover:text-primary";

function kindOf(pull: PullRef): { Icon: LucideIcon; word: string; tone: string } {
  if (pull.state === "MERGED") return { Icon: GitMerge, word: "merged", tone: "text-(--s6)" };
  if (pull.state === "CLOSED") return { Icon: GitPullRequestClosed, word: "closed", tone: "text-removed" };
  if (pull.draft) return { Icon: GitPullRequestDraft, word: "draft", tone: "text-secondary" };
  return { Icon: GitPullRequest, word: "open", tone: "text-brand" };
}

/** A pull request as a chip, in the colour of its state when it is a branch's, or the one a commit's subject names. */
export function PullChip({ subject, pull, href, onOpen, github, className = "", tabIndex }: { subject?: string; pull?: PullRef | null | undefined; href?: string | undefined; onOpen?: ((number: number) => void) | undefined; github?: string | null | undefined; className?: string; tabIndex?: number }) {
  const number = pull?.number ?? (subject === undefined ? null : pullOf(subject));
  if (number === null) return null;
  const kind = pull ? kindOf(pull) : null;
  const Icon = kind?.Icon ?? GitPullRequest;
  const name = kind ? `Pull request ${number}, ${kind.word}` : `Pull request ${number}`;
  const body = (
    <>
      <span className={`inline-flex ${kind?.tone ?? ""}`}>
        <Icon size={ICON.xs} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
      </span>
      #{number}
    </>
  );
  const title = pull?.title ? `${pull.title} (${kind?.word})` : name;
  if (href)
    return (
      <A href={href} className={`${LOOK} ${className}`} title={title} aria-label={name} {...(tabIndex === undefined ? {} : { tabIndex })}>
        {body}
      </A>
    );
  if (onOpen)
    return (
      <button type="button" className={`${LOOK} cursor-pointer font-[inherit] ${className}`} title={title} aria-label={name} onClick={() => onOpen(number)}>
        {body}
      </button>
    );
  if (!github) return null;
  return (
    <a className={`${LOOK} ${className}`} href={`${github}/pull/${number}`} target="_blank" rel="noreferrer noopener" title={`Open pull request #${number} on GitHub`} aria-label={`${name}, on GitHub`}>
      {body}
    </a>
  );
}
