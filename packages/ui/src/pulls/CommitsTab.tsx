import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, GitCommitHorizontal, GitPullRequest, RefreshCw } from "lucide-react";
import type { GitPull, PullHeader } from "@commitscape/data";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { date, many } from "../format";
import { useGit } from "../git/source";

function Gone({ title, children, actions }: { title: string; children: string; actions: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 surface px-5 py-12 text-center">
      <GitPullRequest size={ICON.lg} className="text-secondary" aria-hidden />
      <h3 className="m-0 type-heading">{title}</h3>
      <p className="m-0 max-w-md type-description text-pretty">{children}</p>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}

/** A pull request's commits as git read them, newest first, each with its author and a link to it on GitHub. */
export function CommitsTab({ h, kept }: { h: PullHeader; kept: UseQueryResult<GitPull> }) {
  const git = useGit();
  const data = kept.data;
  const github = <Button label="See the commits on GitHub" variant="secondary" icon={<Icon icon={ExternalLink} size="sm" />} href={`${git.github}/pull/${h.number}/commits`} target="_blank" rel="noopener noreferrer" />;
  if (!h.git) return <Gone title="Git did not read this pull request's commits" actions={github}>Only the open pull requests and the newest others have their commits, files and diff read from git, so that a Build stays quick. This one's are on GitHub.</Gone>;
  if (kept.isError)
    return (
      <Gone title="Its commits could not be read" actions={<Button label="Try again" variant="secondary" icon={<Icon icon={RefreshCw} size="sm" />} onClick={() => void kept.refetch()} />}>
        The Site did not answer for this pull request's commits. Check the connection, then try again.
      </Gone>
    );
  if (!data)
    return (
      <div className="flex flex-col gap-0 overflow-hidden surface" role="status" aria-busy="true" aria-label="Loading the commits">
        <div className="border-b border-separator px-4 py-3">
          <Skeleton height={14} width={260} radius={1} />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex min-h-[3.25rem] items-center gap-3 border-b border-separator px-4 last:border-b-0">
            <Skeleton height={14} width={14} radius={4} index={i} />
            <Skeleton height={14} width={`${30 + ((i * 29) % 40)}%`} radius={1} index={i} />
          </div>
        ))}
      </div>
    );
  return (
    <section aria-label="Commits" className="flex min-w-0 flex-col overflow-hidden surface">
      <p className="m-0 border-b border-separator px-4 py-3 type-caption tnum">
        {many(data.commitsTotal, "commit", "commits")}, newest first
        {data.commitsTotal > data.commits.length ? `. The newest ${data.commits.length} are listed; the rest are on GitHub` : ""}
        {data.base ? `. Counted from ${data.base.slice(0, 7)}, where it left the default branch` : ""}
        {h.commits !== null && h.commits !== data.commitsTotal ? `. GitHub counts ${many(h.commits, "commit", "commits")} for this pull request${h.base && h.base !== git.status.branch ? `, which goes into ${h.base}, not ${git.status.branch}` : ""}` : ""}.
      </p>
      {data.commits.length === 0 ? (
        <p className="m-0 px-4 py-8 text-center type-description">Git found no commit of its own on this pull request.</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {data.commits.map((c) => (
            <li key={c.sha} className="row-hover flex min-h-[3.25rem] items-center gap-3 border-b border-separator px-4 py-2 last:border-b-0">
              <GitCommitHorizontal size={ICON.sm} className="flex-none text-secondary" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base text-primary [overflow-wrap:anywhere]">
                  {c.subject || "(no subject)"}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 type-caption">
                  <Face login={null} name={c.author} size={16} />
                  <span className="truncate">{c.author}</span>
                  <span aria-hidden>·</span>
                  <span className="whitespace-nowrap tnum">{date(c.at)}</span>
                </span>
              </div>
              <a className="mono flex-none rounded-xs px-1.5 py-0.5 text-sm text-secondary no-underline hover:bg-hover hover:text-primary" href={`${git.github}/pull/${h.number}/commits/${c.sha}`} target="_blank" rel="noopener noreferrer" title="Open the commit on GitHub">
                {c.sha.slice(0, 7)}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
