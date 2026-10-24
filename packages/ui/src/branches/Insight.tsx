import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GitBranchInsight } from "@commitscape/data";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Face } from "../components/Face";
import { useStanding } from "../components/Name";
import { duration, grouped, many } from "../format";
import { A } from "../kit/A";
import { Pill, Quiet } from "../kit/primitives";
import { useGit } from "../git/source";
import { codeLink } from "../code/address";
import type { Route } from "../route";
import { agoOf } from "./model";
import { PathText } from "./PathText";
import { dayOf, dayWords } from "./time";

const FIRST_CONFLICTS = 6;

const ago = (anchor: number, at: number) => agoOf(anchor, at, duration);

function Box({ id, title, caption, children }: { id?: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex min-w-0 scroll-mt-(--chrome-top) flex-col gap-3 surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 type-heading">{title}</h3>
        {caption && <p className="m-0 type-caption text-pretty">{caption}</p>}
      </div>
      {children}
    </section>
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

function Holder({ h, known, anchor }: { h: GitBranchInsight["holders"][number]; known: number; anchor: number }) {
  const standing = useStanding(h.login);
  const name = h.login && standing ? (
    <A href={standing} className="inline-link min-w-0 [overflow-wrap:anywhere]">
      {h.name}
    </A>
  ) : (
    <span className="min-w-0 type-label [overflow-wrap:anywhere]">{h.name}</span>
  );
  return (
    <li className="flex items-start gap-3">
      <Face login={h.login} name={h.name} size={24} />
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
          Holds {grouped(h.files)} of {many(known, "file", "files")}; {many(h.commits, "commit", "commits")} on them, the latest {ago(anchor, h.last)}
        </span>
      </div>
    </li>
  );
}

/** Who holds the files a branch changes: the suggested reviewers, Maintainers marked. */
export function Holders({ insight, root, anchor }: { insight: UseQueryResult<GitBranchInsight>; root: string; anchor: number }) {
  const data = insight.data;
  return (
    <Box title="Who holds these files" caption={`Suggested reviewers: whoever has the most commits on the files this branch changes, in ${root}, leaving out merges, bulk commits and bots.`}>
      {insight.isPending && <Pending rows={5} height={40} />}
      {insight.isError && <Quiet className="py-2 text-start">The people who hold these files could not be read for this branch.</Quiet>}
      {data && data.holders.length === 0 && (
        <Quiet className="py-2 text-start">{data.touched === 0 ? "No files were read for this branch, so there is no one to look up." : data.known === 0 ? `None of the files this branch changes is in ${root}’s history yet: it only adds new ones.` : "No one but bots has committed to these files."}</Quiet>
      )}
      {data && data.holders.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.holders.slice(0, 5).map((h) => (
            <Holder key={`${h.login ?? ""}:${h.name}`} h={h} known={data.known} anchor={anchor} />
          ))}
        </ul>
      )}
    </Box>
  );
}

/** The files a branch changes that its default branch changed after the branch left it. */
export function Conflicts({ insight, root, route, files, filesTotal, anchor }: { insight: UseQueryResult<GitBranchInsight>; root: string; route: Route; files: number; filesTotal: number; anchor: number }) {
  const git = useGit();
  const [all, setAll] = useState(false);
  const data = insight.data;
  const shown = data ? (all ? data.conflicts : data.conflicts.slice(0, FIRST_CONFLICTS)) : [];
  const risky = data?.conflicts.length ?? 0;
  const share = data && data.known > 0 ? Math.round((risky * 100) / data.known) : 0;
  return (
    <Box id="conflicts" title="Conflict risk" caption={`Files this branch changes that ${root} changed after the branch left it.`}>
      {insight.isPending && <Pending rows={FIRST_CONFLICTS + 2} height={40} />}
      {insight.isError && <Quiet className="py-2 text-start">What {root} changed since could not be read for this branch.</Quiet>}
      {data && data.forkedAt <= 0 && <Quiet className="py-2 text-start">This branch shares no history with {root}, so there is no fork to count from.</Quiet>}
      {data && data.forkedAt > 0 && (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="m-0 flex flex-wrap items-baseline gap-x-2">
              <span className="type-stat tnum">{grouped(risky)}</span>
              <span className="type-description">
                of {many(data.known, "file", "files")} {risky === 1 ? "was" : "were"} changed in {root} since {dayWords(dayOf(data.forkedAt))}
              </span>
            </p>
            <span className="block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${share}%`, background: "var(--s2)" }} />
            </span>
            <p className="m-0 type-caption tnum">
              {root} took in {many(data.landed, "commit", "commits")} meanwhile, {many(data.conflictCommits, "commit", "commits")} of them on these files.
              {filesTotal > files ? ` Only the ${grouped(files)} files kept of the ${grouped(filesTotal)} it changes are counted.` : ""}
            </p>
          </div>
          {risky === 0 ? (
            <Quiet className="py-1 text-start">None of them. Nothing {root} changed since touches what this branch changes.</Quiet>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {shown.map((c) => (
                <li key={c.path} className="flex flex-col gap-0.5 border-t border-separator py-2 first:border-t-0">
                  <A href={git.href(codeLink(route, c.path))} className="no-underline hover:underline" title="Open it in the Code window">
                    <PathText path={c.path} />
                  </A>
                  <span className="type-caption tnum">
                    {many(c.commits, "commit", "commits")} in {root}, the latest {ago(anchor, c.last)}
                    {c.name ? `, by ${c.name}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {risky > FIRST_CONFLICTS && <Button label={all ? "Show fewer files" : `Show ${many(risky - FIRST_CONFLICTS, "more file", "more files")}`} variant="ghost" size="sm" onClick={() => setAll((v) => !v)} />}
        </>
      )}
    </Box>
  );
}
