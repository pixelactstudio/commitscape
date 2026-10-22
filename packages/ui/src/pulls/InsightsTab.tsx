import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";
import type { PullHeader, PullInsight } from "@commitscape/data";
import { PathText } from "../branches/PathText";
import { codeLink } from "../code/address";
import { Face } from "../components/Face";
import { useStanding } from "../components/Name";
import { ICON } from "../design/tokens";
import { date, grouped, many } from "../format";
import { useGit } from "../git/source";
import { A } from "../kit/A";
import { Pill, Quiet } from "../kit/primitives";
import type { Route } from "../route";
import { Box } from "./Charts";
import { agoOf } from "./model";

const HOLDERS = "People with the most commits on the files this pull request changes, in the default branch, merges, bulk commits and bots left out, and its author too.";
const PARTNERS = "Files at HEAD that changed in the same commits as these at least three times, and in three in ten of the commits that changed them, which this pull request leaves alone.";
const LANDED = "Commits in the default branch whose subject names this pull request, or that are its merge commit.";

function Holder({ h, files, anchor }: { h: PullInsight["holders"][number]; files: number; anchor: number }) {
  const standing = useStanding(h.person.login);
  const name = standing ? (
    <A href={standing} className="inline-link min-w-0 [overflow-wrap:anywhere]">
      {h.person.name}
    </A>
  ) : (
    <span className="min-w-0 type-label [overflow-wrap:anywhere]">{h.person.name}</span>
  );
  return (
    <li className="flex items-start gap-3">
      <Face login={h.person.login} name={h.person.name} size={24} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {name}
          {h.maintainer && (
            <Pill tone="brand" title="Made at least three commits in the 90 days before the Build">
              Maintainer
            </Pill>
          )}
        </span>
        <span className="type-caption tnum">
          Holds {grouped(h.files)} of {many(files, "file", "files")}; {many(h.commits, "commit", "commits")} on them, the latest {agoOf(anchor, h.last)}
        </span>
      </div>
    </li>
  );
}

function Pending({ rows, height }: { rows: number; height: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={2} index={i} />
      ))}
    </div>
  );
}

function why(i: PullInsight): ReactNode {
  if (i.source === "kept") return `From the ${many(i.touched, "file", "files")} git kept for this pull request${i.known < i.touched ? `; the Stored Index knows ${grouped(i.known)} of them` : ""}.`;
  if (i.source === "commit") return `Git kept none of its files, so these are the ${many(i.touched, "file", "files")} of the commit that took it in${i.known < i.touched ? `; the Stored Index knows ${grouped(i.known)} of them` : ""}.`;
  return "Git kept none of its files and no commit in the default branch names it, so who holds them and what changes with them cannot be told.";
}

/** A pull request set against the history: who holds the files it changes, what usually changes with them, and the commits that took it in. */
export function InsightsTab({ h, route, insight, anchor }: { h: PullHeader; route: Route; insight: UseQueryResult<PullInsight>; anchor: number }) {
  const git = useGit();
  const data = insight.data;
  const failed = insight.isError && !data;
  return (
    <section aria-label="Insights" className="flex min-w-0 flex-col gap-gutter">
      {data && <p className="m-0 max-w-prose type-description text-pretty">{why(data)}</p>}
      <div className="grid items-start gap-gutter lg:grid-cols-2">
        <Box title="Who could review it" caption={HOLDERS}>
          {insight.isPending && <Pending rows={4} height={40} />}
          {failed && <Quiet className="py-2 text-start">Who holds these files could not be read just now.</Quiet>}
          {data && data.holders.length === 0 && <Quiet className="py-2 text-start">{data.source === "none" ? "Its files are not known, so neither are their holders." : "Nobody else has a commit on these files in the default branch."}</Quiet>}
          {data && data.holders.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Suggested reviewers">
              {data.holders.map((p) => (
                <Holder key={p.person.id} h={p} files={data.known} anchor={anchor} />
              ))}
            </ol>
          )}
        </Box>
        <Box title="Files that usually change with them" caption={PARTNERS}>
          {insight.isPending && <Pending rows={4} height={36} />}
          {failed && <Quiet className="py-2 text-start">The files that change with these could not be read just now.</Quiet>}
          {data && data.partners.length === 0 && <Quiet className="py-2 text-start">{data.source === "none" ? "Its files are not known, so neither are their partners." : "No file stands out: none changes with these often enough to say this pull request left it out."}</Quiet>}
          {data && data.partners.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Files this pull request may have missed">
              {data.partners.map((p) => (
                <li key={p.path} className="flex min-w-0 flex-col gap-1">
                  <A href={git.href(codeLink(route, p.path))} className="block min-w-0 no-underline hover:underline" title="Open it in the Code window">
                    <PathText path={p.path} />
                  </A>
                  <span className="flex items-center gap-2 type-caption tnum">
                    <span className="block h-1.5 w-16 flex-none overflow-hidden rounded-full bg-track" aria-hidden>
                      <span className="block h-full rounded-full bg-(--s1)" style={{ width: `${Math.round((p.together * 100) / p.commits)}%` }} />
                    </span>
                    Changed with these in {grouped(p.together)} of its {many(p.commits, "commit", "commits")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Box>
      </div>
      <Box title="On the default branch" caption={LANDED}>
        {insight.isPending && <Pending rows={2} height={44} />}
        {failed && (
          <div className="flex flex-col items-start gap-2">
            <Quiet className="py-0 text-start">The commits could not be read just now.</Quiet>
            <Button label="Try again" variant="secondary" size="sm" onClick={() => void insight.refetch()} />
          </div>
        )}
        {data && data.landed.length === 0 && <Quiet className="py-2 text-start">{h.state === "open" ? "Nothing has landed yet: it is still open." : h.state === "closed" ? "It was closed without merging, so no commit took it in." : "No commit in the default branch names it. It may have been merged by a merge commit that does not, or its commits are older than the history kept."}</Quiet>}
        {data && data.landed.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {data.landed.map((c) => (
              <li key={c.sha} className="flex min-w-0 items-start gap-3">
                <GitCommitHorizontal size={ICON.sm} className="mt-0.5 flex-none text-secondary" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base [overflow-wrap:anywhere]">{c.subject}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-caption tnum">
                    {c.person && (
                      <span className="inline-flex items-center gap-1">
                        <Face login={c.person.login} name={c.person.name} size={16} />
                        {c.person.name}
                      </span>
                    )}
                    <span>{date(c.at)}</span>
                    {c.files > 0 && <span>{many(c.files, "file", "files")}</span>}
                    {c.added !== null && c.removed !== null && (
                      <span>
                        <span className="text-added">+{grouped(c.added)}</span> <span className="text-removed">−{grouped(c.removed)}</span>
                      </span>
                    )}
                  </span>
                </div>
                <a className="mono flex-none rounded-xs px-1.5 py-0.5 text-sm text-secondary no-underline hover:bg-hover hover:text-primary" href={`${git.github}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" title="Open the commit on GitHub">
                  {c.sha.slice(0, 7)}
                </a>
              </li>
            ))}
          </ol>
        )}
      </Box>
    </section>
  );
}
