import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, FileDiff, FileSearch, GitPullRequest, RefreshCw, Search } from "lucide-react";
import type { GitPull, GitPullFile, PullHeader } from "@commitscape/data";
import { codeLink } from "../code/address";
import { ICON } from "../design/tokens";
import { grouped, many } from "../format";
import { DiffView } from "../git/DiffView";
import { orderOf, STATUS_WORDS } from "../git/diff";
import { useGit } from "../git/source";
import { PathText } from "../branches/PathText";
import { A } from "../kit/A";
import type { Go, Route } from "../route";
import { insightQuery } from "./queries";

const ICONS = { size: ICON.sm, strokeWidth: 1.75, absoluteStrokeWidth: true, "aria-hidden": true } as const;

const PANE = "h-[min(78dvh,60rem)] min-h-[26rem]";

function Gone({ title, children, actions }: { title: string; children: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 surface px-5 py-12 text-center">
      <GitPullRequest size={ICON.lg} className="text-secondary" aria-hidden />
      <h3 className="m-0 type-heading">{title}</h3>
      <p className="m-0 max-w-md type-description text-pretty">{children}</p>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

function FileRow({ f, share, active, onPick }: { f: GitPullFile; share: number; active: boolean; onPick: () => void }) {
  const cut = f.path.lastIndexOf("/") + 1;
  return (
    <button
      type="button"
      onClick={onPick}
      tabIndex={active ? 0 : -1}
      aria-current={active || undefined}
      title={`${f.path}: ${STATUS_WORDS[f.status] ?? f.status}${f.binary ? ", binary" : `, ${grouped(f.added ?? 0)} added and ${grouped(f.removed ?? 0)} removed`}`}
      className={`plain-button row-hover flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-start ${active ? "bg-brand-soft" : ""}`}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="line-clamp-2 min-w-0 font-mono text-sm font-medium [overflow-wrap:anywhere]">{f.path.slice(cut)}</span>
        <span className="flex-none text-xs tnum">
          {f.binary ? (
            <span className="text-secondary">binary</span>
          ) : (
            <>
              <span className="text-added">+{grouped(f.added ?? 0)}</span> <span className="text-removed">−{grouped(f.removed ?? 0)}</span>
            </>
          )}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-tertiary" dir="rtl">
          <bdi>{cut > 0 ? f.path.slice(0, cut) : "/"}</bdi>
        </span>
        <span className="block h-1 w-10 flex-none overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full bg-(--s1)" style={{ width: `${Math.max(4, share * 100)}%` }} />
        </span>
      </span>
    </button>
  );
}

function Landed({ h, route }: { h: PullHeader; route: Route }) {
  const git = useGit();
  const insight = useQuery(insightQuery(git, h.number));
  const data = insight.data;
  const github = <Button label="See the files on GitHub" variant="secondary" icon={<Icon icon={ExternalLink} size="sm" />} href={`${git.github}/pull/${h.number}/files`} target="_blank" rel="noopener noreferrer" />;
  if (insight.isPending)
    return (
      <div className="flex flex-col overflow-hidden surface" role="status" aria-busy="true" aria-label="Loading the files">
        <div className="flex min-h-12 items-center border-b border-separator px-4">
          <Skeleton height={14} width={280} radius={1} />
        </div>
        {Array.from({ length: Math.min(8, Math.max(2, h.changedFiles ?? 4)) }, (_, i) => (
          <div key={i} className="flex min-h-11 items-center justify-between gap-4 border-b border-separator px-4 last:border-b-0">
            <Skeleton height={14} width={`${28 + ((i * 31) % 44)}%`} radius={1} index={i} />
            <Skeleton height={14} width={90} radius={1} index={i} />
          </div>
        ))}
      </div>
    );
  if (!data || data.files.length === 0)
    return (
      <Gone title="Git did not read this pull request's files" actions={github}>
        Only the open pull requests and the newest others have their commits, files and diff read from git, so that a Build stays quick, and no commit in the default branch names this one. Its files are on GitHub.
      </Gone>
    );
  const most = Math.max(1, ...data.files.map((f) => (f.added ?? 0) + (f.removed ?? 0)));
  const added = data.files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = data.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const lines = data.files.some((f) => f.added !== null);
  return (
    <section aria-label="Files changed" className="flex min-w-0 flex-col overflow-hidden surface">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-separator px-4 py-3">
        <p className="m-0 flex items-center gap-2 type-caption tnum">
          <FileDiff {...ICONS} />
          <span>
            {many(data.filesTotal, "file", "files")} in the commit that took it in
            {lines && (
              <>
                , <span className="text-added">+{grouped(added)}</span> <span className="text-removed">−{grouped(removed)}</span>
              </>
            )}
          </span>
        </p>
        {github}
      </div>
      <p className="m-0 border-b border-separator px-4 py-2 type-micro text-pretty">
        Git did not keep this pull request's own diff, only the newest do. These are the files of the commit on the default branch that names it, ranked by lines changed{data.filesTotal > data.files.length ? `; the first ${grouped(data.files.length)} are shown` : ""}. Its lines are on GitHub.
      </p>
      <ol className="m-0 list-none p-0">
        {data.files.map((f) => (
          <li key={f.path} className="row-hover grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-separator px-4 py-2 last:border-b-0">
            {f.head ? (
              <A href={git.href(codeLink(route, f.path))} className="block min-w-0 no-underline hover:underline" title="Open it in the Code window">
                <PathText path={f.path} />
              </A>
            ) : (
              <span className="min-w-0" title="No longer at HEAD">
                <PathText path={f.path} className="text-secondary" />
              </span>
            )}
            <span className="flex items-center gap-3 text-sm tnum">
              {f.added !== null && f.removed !== null && (
                <>
                  <span className="block h-1 w-12 flex-none overflow-hidden rounded-full bg-track" aria-hidden>
                    <span className="block h-full rounded-full bg-(--s1)" style={{ width: `${Math.max(4, (((f.added ?? 0) + (f.removed ?? 0)) * 100) / most)}%` }} />
                  </span>
                  <span className="min-w-[8ch] text-end">
                    <span className="text-added">+{grouped(f.added)}</span> <span className="text-removed">−{grouped(f.removed)}</span>
                  </span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A pull request's files: ranked by the lines they changed beside one virtualised, syntax-coloured diff of them all, each openable in the Code window. */
export function FilesTab({ h, kept, route, go }: { h: PullHeader; kept: UseQueryResult<GitPull>; route: Route; go: Go }) {
  const git = useGit();
  const data = kept.data;
  const [by, setBy] = useState<"size" | "path">("size");
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState<{ index: number; nonce: number } | null>(null);
  const nonce = useRef(0);
  const ordered = useMemo(() => (data ? orderOf(data.files, by) : []), [data, by]);
  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 0 ? ordered : ordered.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)));
  }, [ordered, filter]);
  const collapsed = useMemo(() => new Set(shown.flatMap((f, i) => (folded.has(f.path) ? [i] : []))), [shown, folded]);
  const most = useMemo(() => Math.max(1, ...shown.map((f) => (f.added ?? 0) + (f.removed ?? 0))), [shown]);
  const wanted = route.file;
  const latest = useRef(shown);
  useEffect(() => {
    latest.current = shown;
  });
  useEffect(() => {
    if (!wanted) return;
    const i = latest.current.findIndex((f) => f.path === wanted);
    if (i >= 0) setTarget({ index: i, nonce: ++nonce.current });
  }, [wanted, data]);
  if (!h.git) return <Landed h={h} route={route} />;
  if (kept.isError)
    return (
      <Gone title="Its diff could not be read" actions={<Button label="Try again" variant="secondary" icon={<Icon icon={RefreshCw} size="sm" />} onClick={() => void kept.refetch()} />}>
        The Site did not answer for this pull request's files. Check the connection, then try again.
      </Gone>
    );
  if (!data) return <FilesSkeleton />;
  if (data.basis === "none" && data.files.length === 0)
    return (
      <Gone title="No diff was kept" actions={<Button label="See the files on GitHub" variant="secondary" icon={<Icon icon={ExternalLink} size="sm" />} href={`${git.github}/pull/${h.number}/files`} target="_blank" rel="noopener noreferrer" />}>
        {`Where this pull request left ${data.onto ?? "the default branch"} could not be found, so the lines it changed could not be told.`}
      </Gone>
    );
  const pick = (i: number) => {
    setTarget({ index: i, nonce: ++nonce.current });
    const f = shown[i];
    if (f) go({ file: f.path }, true);
  };
  const codeHref = (f: GitPullFile) => (f.status === "D" ? null : git.href(codeLink(route, f.path)));
  const anyFolded = folded.size > 0;
  const off = h.changedFiles !== null && data.filesTotal !== h.changedFiles;
  return (
    <section aria-label="Files changed" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="m-0 flex items-center gap-2 type-caption tnum">
          <FileDiff {...ICONS} />
          <span>
            {many(data.filesTotal, "file", "files")} changed, <span className="text-added">+{grouped(data.added)}</span> <span className="text-removed">−{grouped(data.removed)}</span>
          </span>
        </p>
        <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl label="Order of the files" size="sm" value={by} onChange={(v) => setBy(v === "path" ? "path" : "size")}>
            <SegmentedControlItem value="size" label="Largest first" />
            <SegmentedControlItem value="path" label="By path" />
          </SegmentedControl>
          <Switch size="sm" label="Wrap lines" value={wrap} onChange={setWrap} />
          <Button label={anyFolded ? "Unfold all" : "Fold all"} variant="ghost" size="sm" onClick={() => setFolded(anyFolded ? new Set() : new Set(shown.map((f) => f.path)))} />
        </div>
      </div>
      {(data.filesTotal > data.files.length || data.basis === "none" || data.basis === "merge" || off) && (
        <p className="m-0 type-caption text-pretty">
          {data.filesTotal > data.files.length ? `The first ${grouped(data.files.length)} of ${grouped(data.filesTotal)} files were kept; the rest are on GitHub. ` : ""}
          {data.basis === "none" ? `Where it left ${data.onto ?? "the default branch"} could not be found, so no diff was kept. ` : ""}
          {data.basis === "merge" ? `Measured against where its merge commit left ${data.onto ?? "the default branch"}. ` : ""}
          {off
            ? `GitHub counts ${many(h.changedFiles ?? 0, "file", "files")}, +${grouped(h.additions)} −${grouped(h.deletions)} for this pull request, which the header shows. This diff has ${many(data.filesTotal, "file", "files")}, +${grouped(data.added)} −${grouped(data.removed)}${h.base && h.base !== (data.onto ?? git.status.branch) ? `, because git measures against where it left ${data.onto ?? git.status.branch} and this pull request goes into ${h.base}` : ", as git read it at another time or against another base"}. `
            : ""}
        </p>
      )}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 lg:hidden">
          <Selector
            label="Jump to a file"
            hasSearch
            searchPlaceholder="Find a file"
            emptySearchText="No file by that name"
            width="100%"
            startIcon={<FileSearch {...ICONS} />}
            value={shown[active]?.path ?? null}
            onChange={(v: string | null) => {
              const i = shown.findIndex((f) => f.path === v);
              if (i >= 0) pick(i);
            }}
            options={shown.map((f) => ({ value: f.path, label: f.path, description: `+${f.added ?? 0} −${f.removed ?? 0}` }))}
          />
        </div>
        <aside aria-label="Files of the pull request" className={`hidden min-w-0 flex-col overflow-hidden surface lg:flex ${PANE}`}>
          <div className="border-b border-separator p-2">
            <TextInput label="Filter the files" isLabelHidden size="sm" placeholder="Filter by path" value={filter} onChange={setFilter} hasClear width="100%" startIcon={<Search {...ICONS} />} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {shown.length === 0 ? (
              <p className="m-0 p-3 type-caption">No file's path has “{filter}” in it.</p>
            ) : (
              <ol
                className="m-0 flex list-none flex-col gap-0.5 p-0"
                aria-label="Files, the arrow keys move between them"
                onKeyDown={(e) => {
                  const keys: Record<string, (at: number, last: number) => number> = { ArrowDown: (at, last) => Math.min(last, at + 1), ArrowUp: (at) => Math.max(0, at - 1), Home: () => 0, End: (_, last) => last };
                  const move = keys[e.key];
                  if (!move || e.metaKey || e.ctrlKey || e.altKey) return;
                  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
                  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  if (at < 0) return;
                  e.preventDefault();
                  buttons[move(at, buttons.length - 1)]?.focus();
                }}
              >
                {shown.map((f, i) => (
                  <li key={f.path}>
                    <FileRow f={f} share={((f.added ?? 0) + (f.removed ?? 0)) / most} active={i === Math.min(active, shown.length - 1)} onPick={() => pick(i)} />
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="m-0 border-t border-separator px-3 py-2 type-micro tnum">{filter ? `${grouped(shown.length)} of ${grouped(ordered.length)} files` : `${grouped(ordered.length)} files, by ${by === "size" ? "lines changed" : "path"}`}</p>
        </aside>
        <div className={`min-w-0 overflow-hidden surface ${PANE}`}>
          {shown.length === 0 ? (
            <p className="m-0 p-6 type-description">No file's path has “{filter}” in it.</p>
          ) : (
            <DiffView
              files={shown}
              collapsed={collapsed}
              onToggle={(i) => {
                const f = shown[i];
                if (f) setFolded((s) => (s.has(f.path) ? new Set([...s].filter((p) => p !== f.path)) : new Set([...s, f.path])));
              }}
              wrap={wrap}
              target={target}
              onActive={setActive}
              codeHref={codeHref}
              githubHref={() => `${git.github}/pull/${h.number}/files`}
              label="The lines this pull request changed. Press ] and [ to move between files."
              className="size-full"
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** The Files tab while the diff is fetched: the list and the lines at the size they will be. */
export function FilesSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3" role="status" aria-busy="true" aria-label="Loading the files">
      <div className="flex min-h-8 items-center">
        <Skeleton height={16} width={220} radius={1} />
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className={`hidden flex-col gap-2 surface p-3 lg:flex ${PANE}`}>
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} height={34} radius={2} index={i} />
          ))}
        </div>
        <div className={`flex flex-col gap-1.5 overflow-hidden surface p-4 ${PANE}`}>
          <Skeleton height={28} radius={2} />
          {Array.from({ length: 22 }, (_, i) => (
            <Skeleton key={i} height={12} width={`${(i * 37) % 9 === 0 ? 8 : 18 + ((i * 41) % 62)}%`} radius={1} index={i % 6} />
          ))}
        </div>
      </div>
    </div>
  );
}
