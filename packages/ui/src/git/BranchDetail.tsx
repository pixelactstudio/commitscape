import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowLeft, ExternalLink, GitCompare, GitMerge } from "lucide-react";
import type { GitBranches } from "@commitscape/data";
import { Face } from "../components/Face";
import { Changes } from "../branches/Changes";
import { CopyButton } from "../branches/Copy";
import { hasInteracted } from "../branches/interacted";
import { Conflicts, Holders } from "../branches/Insight";
import { useBranchQueries } from "../branches/queries";
import { deleteCommands, type Row } from "../branches/model";
import { STATES } from "../branches/states";
import { Track } from "../branches/Timeline";
import { dayOf, dayWords, fractionOf, ticksOf, DAY } from "../branches/time";
import { ICON } from "../design/tokens";
import { date, duration, grouped, many } from "../format";
import { A } from "../kit/A";
import { Pill, Quiet } from "../kit/primitives";
import type { Route } from "../route";
import { PullChip } from "./PullChip";
import { useGit } from "./source";

const slash = (name: string) => name.split("/").map(encodeURIComponent).join("/");

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-micro">{label}</dt>
      <dd className="m-0 min-w-0 text-base text-primary">{children}</dd>
    </div>
  );
}

function Life({ b, colour }: { b: Row["b"]; colour: string }) {
  const from = dayOf(b.baseAt > 0 ? b.baseAt : (b.ticks?.[0] ?? b.at)) - 1;
  const view = { from, to: Math.max(from + 7, dayOf(b.at) + 2) };
  const ticks = ticksOf(view, 6);
  return (
    <div className="flex flex-col" role="img" aria-label={`From ${dayWords(view.from + 1)} to ${dayWords(dayOf(b.at))}${b.ticks ? `, with a tick for each of its ${grouped(b.ticks.length)} newest commits` : ""}`}>
      <div className="relative h-8">
        <Track b={b} view={view} colour={colour} />
      </div>
      <div className="relative h-5" aria-hidden>
        <div className="absolute inset-y-0 start-2 end-2">
          {ticks.map((t) => (
            <span key={t.day} className={`absolute top-0 text-xs whitespace-nowrap tnum ${fractionOf(view, t.day * DAY) < 0.06 ? "" : "-translate-x-1/2"} ${t.major ? "text-secondary" : "text-tertiary"}`} style={{ left: `${fractionOf(view, t.day * DAY) * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One branch as a view of its own: its facts, files, commits, who holds the files and what the default branch changed since. */
export function BranchDetail({ data, row, route }: { data: GitBranches; row: Row; route: Route }) {
  const git = useGit();
  const heading = useRef<HTMLHeadingElement>(null);
  const { b, index, state } = row;
  const root = data.default;
  const info = STATES[state];
  const kept = state !== "merged" && b.ticks !== undefined;
  const { detail, insight } = useBranchQueries(index, kept);
  useEffect(() => {
    if (hasInteracted()) heading.current?.focus({ preventScroll: true });
  }, [b.name]);
  const parent = b.parent && b.parent !== root ? b.parent : null;
  const back = git.href({ ...route, branch: undefined });
  const command = deleteCommands([b.name]);
  const days = (data.builtAt - b.at) / DAY;
  return (
    <div className="flex min-w-0 flex-col gap-gutter">
      <div>
        <A href={back} className="inline-flex items-center gap-1.5 type-caption text-secondary no-underline hover:text-primary">
          <ArrowLeft size={ICON.sm} aria-hidden />
          All branches
        </A>
      </div>
      <div className="flex flex-col gap-4 surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <Pill icon={<info.Icon size={ICON.xs} strokeWidth={1.75} absoluteStrokeWidth aria-hidden style={{ color: info.colour }} />}>{info.title}</Pill>
              {b.squashed && <Pill tone="quiet">Squashed or rebased in</Pill>}
              {b.bot && <Pill tone="quiet">Bot</Pill>}
            </span>
            <h2 ref={heading} tabIndex={-1} className="m-0 flex min-w-0 items-center gap-1 type-title outline-offset-4">
              <bdi className="min-w-0 font-mono text-lg font-semibold break-all">{b.name}</bdi>
              <CopyButton text={b.name} label="Copy the branch name" />
            </h2>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button label={`Compare with ${root} on GitHub`} variant="secondary" icon={<Icon icon={GitCompare} size="sm" />} href={`${git.github}/compare/${slash(root)}...${slash(b.name)}`} target="_blank" rel="noopener noreferrer" />
            <Button label="Open on GitHub" variant="ghost" icon={<Icon icon={ExternalLink} size="sm" />} href={`${git.github}/tree/${slash(b.name)}`} target="_blank" rel="noopener noreferrer" />
          </div>
        </div>
        {b.subject && <p className="m-0 max-w-prose text-md text-pretty">{b.subject}</p>}
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Author">
            <span className="flex min-w-0 items-center gap-2">
              <Face login={b.login} name={b.author} size={20} />
              <span className="truncate">{b.author}</span>
            </span>
          </Fact>
          <Fact label="Last commit">
            <span className="tnum">
              {date(b.at)} ·{" "}
              <a className="font-mono text-secondary" href={`${git.github}/commit/${b.sha}`} target="_blank" rel="noopener noreferrer" title="Open the commit on GitHub">
                {b.sha.slice(0, 7)}
              </a>
            </span>
            <span className="block type-caption tnum">{duration(days)} before the Build</span>
          </Fact>
          <Fact label={`Left ${root}`}>
            <span className="tnum">{b.baseAt > 0 ? date(b.baseAt) : "No merge base"}</span>
            {b.baseAt > 0 && <span className="block type-caption tnum">{(b.at - b.baseAt) / DAY < 1 ? "The day of its last commit" : `${duration((b.at - b.baseAt) / DAY)} before its last commit`}</span>}
          </Fact>
          <Fact label={`Against ${root}`}>
            <span className="tnum">
              {grouped(b.ahead)} ahead · {grouped(b.behind)} behind
            </span>
            {parent && (
              <span className="block type-caption">
                Built on <code className="font-mono">{parent}</code>, sharing {many(b.shared, "commit", "commits")}
              </span>
            )}
          </Fact>
          {b.pull && (
            <Fact label="Pull request">
              <span className="flex min-w-0 flex-col items-start gap-1">
                <PullChip pull={b.pull} href={git.href({ screen: "pulls", pr: b.pull.number })} />
                <span className="line-clamp-2 type-caption text-pretty">{b.pull.title}</span>
              </span>
            </Fact>
          )}
        </dl>
        {b.baseAt > 0 && state !== "merged" && <Life b={b} colour={info.colour} />}
      </div>
      {state === "merged" && (
        <section aria-label="Delete this branch" className="flex flex-col gap-2 surface p-4">
          <h3 className="m-0 flex items-center gap-2 type-heading">
            <span style={{ color: STATES.merged.colour }} className="inline-flex">
              <GitMerge size={ICON.md} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
            </span>
            Safe to delete
          </h3>
          <p className="m-0 max-w-prose type-description">
            {b.squashed ? `Merging it would change nothing: ${root} already has its work, taken in by a squash or a rebase, so git still lists its commits as ahead.` : `Every commit on it is already in ${root}.`} Run this in a clone to delete it from GitHub. Nothing here deletes it.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-line bg-sunken ps-3 pe-1">
            <code className="min-w-0 flex-1 py-2 font-mono text-sm break-all select-all">{command}</code>
            <CopyButton text={command} label="Copy the delete command" />
          </div>
        </section>
      )}
      {state !== "merged" && !kept && (
        <Quiet className="surface px-4 text-start">Its files and commits were not kept at the last Build: they are read for the open branches with the newest commits, and this one is further down.</Quiet>
      )}
      {kept && (
        <div className="grid items-start gap-gutter lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Changes detail={detail} insight={insight} route={route} name={b.name} total={b.ahead} root={root} />
          <div className="flex min-w-0 flex-col gap-gutter">
            <Conflicts insight={insight} root={root} route={route} files={detail.data?.files.length ?? insight.data?.touched ?? 0} filesTotal={detail.data?.filesTotal ?? insight.data?.touched ?? 0} anchor={data.builtAt} />
            <Holders insight={insight} root={root} anchor={data.builtAt} />
          </div>
        </div>
      )}
    </div>
  );
}
