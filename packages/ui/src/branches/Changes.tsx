import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { GitBranchDetail, GitBranchFile, GitBranchInsight } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { compact, date, grouped, many } from "../format";
import { A } from "../kit/A";
import { Quiet } from "../kit/primitives";
import { PathText } from "./PathText";
import { codeLink } from "../code/address";
import { PullChip } from "../git/PullChip";
import { useGit } from "../git/source";
import type { Route } from "../route";

const FILES_FIRST = 12;
const FILES_MORE = 40;
const COMMITS_FIRST = 8;
const COMMITS_MORE = 24;

const slash = (name: string) => name.split("/").map(encodeURIComponent).join("/");

function Box({ title, caption, aside, children }: { title: string; caption: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col surface">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 type-heading">{title}</h3>
          <p className="m-0 type-caption text-pretty">{caption}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Pending({ rows, height }: { rows: number; height: number }) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-4" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={2} index={i} />
      ))}
    </div>
  );
}

function FileRow({ f, most, href, outside }: { f: GitBranchFile; most: number; href: string; outside: boolean }) {
  const total = (f.added ?? 0) + (f.removed ?? 0);
  const binary = f.added === null && f.removed === null;
  const body = (
    <>
      <PathText path={f.path} />
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-track sm:flex" aria-hidden>
        {!binary && (
          <>
            <span className="block h-full bg-added-solid" style={{ width: `${((f.added ?? 0) * 100) / most}%` }} />
            <span className="block h-full bg-removed-solid" style={{ width: `${((f.removed ?? 0) * 100) / most}%` }} />
          </>
        )}
      </span>
      <span className="text-end text-sm whitespace-nowrap tnum" title={binary ? "A binary file has no lines to count" : `${grouped(total)} lines changed`}>
        {binary ? (
          <span className="text-tertiary">binary</span>
        ) : (
          <>
            <span className="text-added">+{compact(f.added ?? 0)}</span> <span className="text-removed">−{compact(f.removed ?? 0)}</span>
          </>
        )}
      </span>
      <span className="flex justify-end text-tertiary" aria-hidden>
        {outside && <ExternalLink size={ICON.xs} />}
      </span>
    </>
  );
  const cls = "row-hover grid grid-cols-[minmax(0,1fr)_5rem_1rem] items-center gap-x-3 px-4 py-1.5 text-start no-underline sm:grid-cols-[minmax(0,1fr)_4rem_5rem_1rem]";
  return outside ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title="Not in the default branch: open it on GitHub, as the branch has it">
      {body}
    </a>
  ) : (
    <A href={href} className={cls} title="Open it in the Code window, as the default branch has it">
      {body}
    </A>
  );
}

/** The files a branch changes, most lines first, each opening in the Code window or on GitHub. */
export function Files({ detail, insight, route, name, root }: { detail: UseQueryResult<GitBranchDetail>; insight: UseQueryResult<GitBranchInsight>; route: Route; name: string; root: string }) {
  const git = useGit();
  const [shown, setShown] = useState(FILES_FIRST);
  const data = detail.data;
  const atHead = insight.data ? new Set(insight.data.atHead) : null;
  const most = data ? Math.max(1, ...data.files.map((f) => (f.added ?? 0) + (f.removed ?? 0))) : 1;
  return (
    <Box
      title="Files changed"
      caption="Ranked by lines changed. A file opens in the Code window as the default branch has it."
      aside={
        data && data.filesTotal > 0 && (
          <p className="m-0 text-sm tnum">
            <span className="text-secondary">{many(data.filesTotal, "file", "files")}</span> <span className="text-added">+{compact(data.added)}</span> <span className="text-removed">−{compact(data.removed)}</span>
          </p>
        )
      }
    >
      {detail.isPending && <Pending rows={FILES_FIRST} height={25} />}
      {detail.isError && (
        <div className="px-4 pb-4">
          <Quiet className="py-2 text-start">The files of this branch could not be read.</Quiet>
          <Button label="Try again" variant="secondary" size="sm" onClick={() => void detail.refetch()} />
        </div>
      )}
      {data && data.files.length === 0 && <Quiet className="px-4 pb-4 text-start">{data.filesTotal === 0 && insight.data?.forkedAt === 0 ? `Its files were not read: it shares no history with ${root}, so there is nothing to compare them with.` : `No file differs from ${data.against}.`}</Quiet>}
      {data && data.files.length > 0 && (
        <>
          <ul className="m-0 flex list-none flex-col border-t border-separator p-0">
            {data.files.slice(0, shown).map((f) => (
              <li key={f.path} className="border-b border-separator last:border-b-0">
                <FileRow f={f} most={most} outside={atHead !== null && !atHead.has(f.path)} href={atHead !== null && !atHead.has(f.path) ? `${git.github}/blob/${slash(name)}/${slash(f.path)}` : git.href(codeLink(route, f.path))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator px-4 py-2">
            <p className="m-0 type-caption tnum">
              {data.files.length < data.filesTotal ? `The ${grouped(data.files.length)} files with most lines changed are kept, of ${grouped(data.filesTotal)}.` : `Every file it changes is listed.`}
            </p>
            {data.files.length > shown && <Button label={`Show ${many(Math.min(FILES_MORE, data.files.length - shown), "more file", "more files")}`} variant="ghost" size="sm" onClick={() => setShown((n) => n + FILES_MORE)} />}
          </div>
        </>
      )}
    </Box>
  );
}

/** The commits a branch has that the default branch lacks, newest first. */
export function Commits({ detail, branchTotal }: { detail: UseQueryResult<GitBranchDetail>; branchTotal: number }) {
  const git = useGit();
  const [shown, setShown] = useState(COMMITS_FIRST);
  const data = detail.data;
  return (
    <Box title="Commits" caption="Newest first: the commits this branch has that the default branch lacks.">
      {detail.isPending && <Pending rows={COMMITS_FIRST} height={54} />}
      {detail.isError && <Quiet className="px-4 pb-4 text-start">The commits of this branch could not be read.</Quiet>}
      {data && data.commits.length === 0 && <Quiet className="px-4 pb-4 text-start">No commit is kept for this branch.</Quiet>}
      {data && data.commits.length > 0 && (
        <>
          <ol className="m-0 flex list-none flex-col border-t border-separator p-0">
            {data.commits.slice(0, shown).map((c) => (
              <li key={c.sha} className="flex flex-col gap-0.5 border-b border-separator px-4 py-2 last:border-b-0">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-base text-pretty text-primary">{c.subject || "(no subject)"}</span>
                  <PullChip subject={c.subject} github={git.github} />
                </span>
                <span className="type-caption tnum">
                  {c.author} · {date(c.at)} ·{" "}
                  <a className="font-mono text-secondary" href={`${git.github}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" title="Open the commit on GitHub">
                    {c.sha.slice(0, 7)}
                  </a>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator px-4 py-2">
            <p className="m-0 type-caption tnum">
              {data.commits.length < branchTotal ? `The newest ${grouped(data.commits.length)} commits are kept, of ${grouped(branchTotal)}.` : "Every commit it has is listed."}
            </p>
            {data.commits.length > shown && <Button label={`Show ${many(Math.min(COMMITS_MORE, data.commits.length - shown), "more commit", "more commits")}`} variant="ghost" size="sm" onClick={() => setShown((n) => n + COMMITS_MORE)} />}
          </div>
        </>
      )}
    </Box>
  );
}

/** A branch's files and commits one above the other. */
export function Changes({ detail, insight, route, name, total, root }: { detail: UseQueryResult<GitBranchDetail>; insight: UseQueryResult<GitBranchInsight>; route: Route; name: string; total: number; root: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-gutter">
      <Files detail={detail} insight={insight} route={route} name={name} root={root} />
      <Commits detail={detail} branchTotal={total} />
    </div>
  );
}
