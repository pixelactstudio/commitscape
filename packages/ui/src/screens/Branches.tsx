import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { GitBranches } from "@commitscape/data";
import { Brush } from "../branches/Brush";
import { StateCards } from "../branches/Cards";
import { CopyButton } from "../branches/Copy";
import { authorsOf, binsOf, deleteCommands, extentOf, facetsOf, fitOf, itemsOf, matches, prefixesOf, rowsOf, sortOf, sortRows, stateOf, type Filter } from "../branches/model";
import { RangeBar, type Preset } from "../branches/Range";
import { Releases } from "../branches/Releases";
import { STATES } from "../branches/states";
import { Timeline } from "../branches/Timeline";
import { dayOf, type Span } from "../branches/time";
import { BranchToolbar } from "../branches/Toolbar";
import { useWidth } from "../branches/useWidth";
import { BranchDetail } from "../git/BranchDetail";
import { gitKey, useGit } from "../git/source";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { duration, grouped, many } from "../format";
import { Quiet } from "../kit/primitives";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import type { Go, Route } from "../route";
import { Failed, NoMatch, ScreenFrame } from "./kit";
import type { ScreenProps } from "./props";

const NARROW = 860;
const MIN_BARS = 3;
const EXPAND_UNDER = 40;
const DAY = 86_400;

/** What is happening on a repository's branches: states as filters, a timeline, the releases, and one branch at a time. */
export function BranchesScreen({ route, go }: ScreenProps) {
  const git = useGit();
  const loaded = useQuery({ queryKey: gitKey(git, "branches"), queryFn: () => git.branches(), staleTime: Infinity, retry: 1 });
  if (loaded.isError) return <Failed words={loaded.error instanceof Error ? loaded.error.message : "The branches could not be read."} action={<Button label="Try again" variant="secondary" onClick={() => void loaded.refetch()} />} />;
  if (!loaded.data) return route.branch ? <BranchSkeleton /> : <BranchesSkeleton />;
  return <Loaded data={loaded.data} route={route} go={go} />;
}

function Loaded({ data, route, go }: { data: GitBranches; route: Route; go: Go }) {
  const git = useGit();
  const rows = useMemo(() => rowsOf(data), [data]);
  const [box, width] = useWidth<HTMLDivElement>();
  const [draft, setDraft] = useState<Span | null>(null);
  const [mode, setMode] = useState<"default" | "all" | "none">("default");
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const layout = width !== 0 && width < NARROW ? "narrow" : "wide";
  const root = data.default;
  const anchor = data.builtAt;
  const releases = route.tab === "releases";
  const sort = sortOf(route.by);
  const filter = useMemo<Filter>(() => ({ q: route.q ?? "", state: stateOf(route.state), who: route.author?.toLowerCase(), prefix: route.prefix, bots: route.bots === "show" }), [route.q, route.state, route.author, route.prefix, route.bots]);
  const matched = useMemo(() => rows.filter((r) => matches(r, filter)), [rows, filter]);
  const facets = useMemo(() => facetsOf(rows, filter), [rows, filter]);
  const sorted = useMemo(() => sortRows(matched, sort), [matched, sort]);
  const authors = useMemo(() => authorsOf(rows.filter((r) => matches(r, filter, "who"))), [rows, filter]);
  const prefixes = useMemo(() => prefixesOf(rows.filter((r) => matches(r, filter, "prefix"))), [rows, filter]);
  const authorList = filter.who && !authors.some((a) => a.key === filter.who) ? [{ key: filter.who, name: filter.who, login: filter.who, count: 0 }, ...authors] : authors;
  const prefixList = filter.prefix && !prefixes.some((x) => x.prefix === filter.prefix) ? [{ prefix: filter.prefix, count: 0 }, ...prefixes] : prefixes;
  const open = matched.filter((r) => r.state !== "merged");
  const bars = open.length >= MIN_BARS;
  const fit = useMemo(() => fitOf(open, anchor), [open, anchor]);
  const chosen: Span = route.since !== undefined && route.until !== undefined ? { from: route.since, to: route.until } : fit;
  const view = draft ?? chosen;
  const covered = useMemo(() => extentOf(matched, fit, anchor), [matched, fit, anchor]);
  const extent = useMemo<Span>(() => ({ from: Math.min(covered.span.from, chosen.from), to: Math.max(covered.span.to, chosen.to) }), [covered, chosen.from, chosen.to]);
  const older = matched.filter((r) => dayOf(r.b.at) < extent.from).length;
  const everything = useMemo<Span>(() => ({ from: Math.min(...matched.map((r) => Math.min(dayOf(r.b.baseAt > 0 ? r.b.baseAt : r.b.at), dayOf(r.b.at))), fit.from), to: covered.span.to }), [matched, covered, fit.from]);
  const today = dayOf(anchor) + 1;
  const presets: Preset[] = [
    { id: "fit", label: "Fit open branches", span: fit },
    { id: "90d", label: "3 months", span: { from: today - 90, to: today } },
    { id: "1y", label: "1 year", span: { from: today - 365, to: today } },
    { id: "all", label: "Everything", span: everything },
  ];
  const items = useMemo(
    () =>
      itemsOf(sorted, (prefix) => {
        const expand = sorted.length <= EXPAND_UNDER || filter.q.trim() !== "" || filter.state !== undefined || filter.who !== undefined || filter.prefix === prefix;
        if (mode === "all") return !toggled.has(prefix);
        if (mode === "none") return toggled.has(prefix);
        return expand !== toggled.has(prefix);
      }),
    [sorted, mode, toggled, filter],
  );
  const groups = items.filter((i) => i.kind === "group");
  const toggle = (prefix: string) => setToggled((t) => (t.has(prefix) ? new Set([...t].filter((p) => p !== prefix)) : new Set([...t, prefix])));
  const setAll = (next: "all" | "none") => {
    setMode(next);
    setToggled(new Set());
  };
  const filtered = filter.q !== "" || filter.state !== undefined || filter.who !== undefined || filter.prefix !== undefined || filter.bots;
  const clear = () => go({ q: undefined, state: undefined, author: undefined, prefix: undefined, bots: undefined }, true);
  const hrefOf = (name: string) => git.href({ ...route, branch: name });
  const pullHref = (number: number) => git.href({ screen: "pulls", pr: number });
  const tag = data.tags[0];

  if (route.branch) {
    const row = rows.find((r) => r.b.name === route.branch);
    if (row) return <ScreenFrame><BranchDetail data={data} row={row} route={route} /></ScreenFrame>;
    return (
      <ScreenFrame>
        <div className="flex flex-col items-center gap-3 surface px-5 py-10 text-center">
          <p className="m-0 type-description">
            No branch named <code className="font-mono">{route.branch}</code> was read at the last Build. It may have been deleted since, or be further down than the {grouped(data.branches.length)} newest read.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button label="Show all branches" variant="secondary" onClick={() => go({ branch: undefined })} />
            <Button label="Look for it on GitHub" variant="ghost" href={`${git.github}/tree/${route.branch.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noopener noreferrer" />
          </div>
        </div>
      </ScreenFrame>
    );
  }

  const state = filter.state;
  const merged = state === "merged" ? matched.filter((r) => r.state === "merged") : [];
  const commands = merged.length > 0 ? deleteCommands(sorted.filter((r) => r.state === "merged").map((r) => r.b.name)) : "";
  return (
    <ScreenFrame>
      <StateCards
        counts={facets.states}
        active={state}
        tagsOpen={releases}
        root={root}
        tags={data.tagsTotal}
        newest={tag ? `Newest ${tag.name}, ${duration(Math.max(0, (anchor - tag.at) / DAY))} before the Build` : "None yet"}
        onState={(s) => go({ tab: undefined, state: s, since: undefined, until: undefined }, true)}
        onTags={() => go({ tab: releases ? undefined : "releases", state: undefined, since: undefined, until: undefined, q: undefined }, true)}
      />
      {releases ? (
        <>
          {data.tags.length > 0 && (
            <Toolbar label="Filter the tags">
              <ToolbarField kind="find">
                <TextInput label="Search tags" isLabelHidden placeholder="Find a tag" value={route.q ?? ""} onChange={(v) => go({ q: v || undefined }, true)} hasClear width="100%" startIcon={<Search size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />} />
              </ToolbarField>
            </Toolbar>
          )}
          <Releases data={data} route={route} go={go} github={git.github} />
        </>
      ) : (
        <>
          <BranchToolbar
            q={filter.q}
            onQ={(q) => go({ q: q || undefined }, true)}
            authors={authorList}
            who={filter.who}
            onWho={(who) => go({ author: who }, true)}
            prefixes={prefixList}
            prefix={filter.prefix}
            onPrefix={(prefix) => go({ prefix }, true)}
            sort={sort}
            onSort={(by) => go({ by: by === "new" ? undefined : by }, true)}
            hideBots={!filter.bots}
            onBots={(hide) => go({ bots: hide ? undefined : "show" }, true)}
            hidden={facets.hiddenBots}
            filtered={filtered}
            onClear={clear}
          />
          {commands && (
            <section aria-label="Delete the merged branches" className="flex flex-col gap-2 surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="m-0 max-w-prose type-description">
                  {many(merged.length, "branch", "branches")} shown {merged.length === 1 ? "is" : "are"} merged: {root} has everything {merged.length === 1 ? "it" : "they"} did. These commands delete them from GitHub; run them in a clone. Nothing here deletes anything.
                </p>
                <CopyButton text={commands} label="Copy the delete commands" variant="secondary" />
              </div>
              <pre className="m-0 max-h-32 overflow-auto rounded-md border border-line bg-sunken px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap select-all" tabIndex={0} aria-label="The delete commands">
                {commands}
              </pre>
            </section>
          )}
          <section aria-label="Branches" className="surface overflow-clip" ref={box}>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="m-0 type-heading">{bars ? "Open branches over time" : `Compared with ${root}`}</h2>
                  <p className="m-0 type-caption text-pretty">
                    {bars ? `A line runs from where a branch left ${root} to its last commit; a tick is a commit, a dot where it ends.` : `Measured against ${root}, at ${data.head.slice(0, 7)}.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p role="status" className="m-0 type-caption tnum">
                    {matched.length === rows.length ? `${many(rows.length, "branch", "branches")} besides ${root}` : `${grouped(matched.length)} of ${many(rows.length, "branch", "branches")} besides ${root}`}
                    {facets.hiddenBots > 0 && !filter.bots ? `, ${grouped(facets.hiddenBots)} from bots hidden` : ""}
                  </p>
                  {groups.length > 0 && <Button label={groups.some((g) => g.kind === "group" && g.open) ? "Collapse prefixes" : "Expand prefixes"} variant="ghost" size="sm" onClick={() => setAll(groups.some((g) => g.kind === "group" && g.open) ? "none" : "all")} />}
                </div>
              </div>
              {bars && <RangeBar view={view} presets={presets} onPick={(span) => go({ since: span.from, until: span.to }, true)} />}
              {bars && <Brush bins={binsOf(matched, extent, 96)} older={older} extent={extent} view={view} onPreview={setDraft} onCommit={(span) => go({ since: span.from, until: span.to }, true)} noun="branches" />}
            </div>
            {rows.length === 0 ? (
              <Quiet className="border-t border-separator">{root} is the only branch. Others show here once someone pushes them.</Quiet>
            ) : matched.length === 0 ? (
              <div className="border-t border-separator">
                <NoMatch what="branches" query={filter.q.trim()} onClear={clear} />
              </div>
            ) : (
              <Timeline items={items} view={view} anchor={anchor} root={root} layout={layout} bars={bars} hrefOf={hrefOf} pullHref={pullHref} onToggle={toggle} />
            )}
            {(data.total > data.branches.length || data.branches.some((b) => b.ticks)) && (
              <p className="m-0 border-t border-separator px-4 py-2 type-caption tnum">
                {data.total > data.branches.length ? `The ${grouped(data.branches.length)} branches with the newest commits are read, of ${grouped(data.total)} on the remote. ` : ""}
                {bars ? `Ticks are drawn for the ${grouped(data.branches.filter((b) => b.ticks).length)} open branches whose commits were kept.` : ""}
              </p>
            )}
          </section>
        </>
      )}
      <Explain>
        Read from git when the repository was last read, with no request to GitHub beyond its pull requests. Ahead is the commits a branch has that {root} lacks, behind the commits {root} has that it lacks. A branch counts as merged when {root} holds all its commits, when merging it would change nothing (as after a squash or a rebase), or when its pull request
        was merged and nothing was committed to it since. In flight is {STATES.flight.title.toLowerCase()} for an open pull request or a commit in the 30 days before the Build; the other states count from the Build too.
      </Explain>
    </ScreenFrame>
  );
}

function PanelSkeleton({ rows, head }: { rows: number; head: number }) {
  return (
    <section className="surface overflow-clip" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3 p-4">
        <Skeleton height={20} width="30%" radius={1} />
        {head > 0 && <Skeleton height={head} radius={2} />}
      </div>
      <div className="border-t border-separator">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-8 items-center gap-3 border-b border-separator px-3">
            <Skeleton height={14} width={`${20 + ((i * 17) % 35)}%`} radius={1} index={i} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Branches screen while its data is fetched: the cards, the toolbar and the timeline at the size they will be. */
export function BranchesSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {["In flight", "Waiting", "Abandoned", "Merged", "Tags"].map((label, i) => (
          <div key={label} className={`flex min-w-0 flex-col gap-1 surface px-4 py-3 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
            <span className="type-label">{label}</span>
            <Skeleton height={29} width="40%" radius={2} index={i} />
            <span className="block min-h-14">
              <Skeleton height={14} width="85%" radius={1} index={i} />
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden>
        <Toolbar label="Loading the filters">
          <ToolbarField kind="search">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <ToolbarField kind="person">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <ToolbarField kind="option">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
          <ToolbarField kind="order">
            <Skeleton height={32} radius={2} />
          </ToolbarField>
        </Toolbar>
      </div>
      <PanelSkeleton rows={12} head={96} />
    </ScreenFrame>
  );
}

function BranchSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <Skeleton height={20} width={96} radius={1} />
      <div className="flex flex-col gap-4 surface p-5" aria-busy="true">
        <Skeleton height={24} width="24%" radius={3} />
        <Skeleton height={28} width="48%" radius={2} />
        <Skeleton height={56} radius={2} />
        <Skeleton height={48} radius={2} />
      </div>
      <div className="grid items-start gap-gutter lg:grid-cols-[minmax(0,1fr)_24rem]">
        <PanelSkeleton rows={8} head={0} />
        <PanelSkeleton rows={4} head={0} />
      </div>
    </ScreenFrame>
  );
}
