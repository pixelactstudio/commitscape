import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { ChevronRight, FileCode, FileWarning, FolderTree, Home, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from "lucide-react";
import { FILE_BINARY, FILE_LINK, type CodeStory, type GitDir, type GitTree } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { A } from "../kit/A";
import { grouped, many } from "../format";
import { bytes } from "../git/insights";
import { FileTree } from "../git/FileTree";
import { FolderView } from "../git/FolderView";
import { FileFinder } from "../git/FileFinder";
import { ancestorsOf, nodesOf } from "../git/tree";
import { HIGHLIGHT_MAX } from "../git/highlight";
import { crumbsOf, isFolderPath, nameOf, parentOf, type CodeView } from "./address";
import { useCode } from "./context";
import { hasPreview, isImage } from "./data";
import { FileBody, type Look } from "./FileBody";
import { History } from "./History";
import { Insights } from "./Insights";
import { State } from "./State";
import { Story } from "./Story";

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

function TreeSkeleton() {
  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2" role="status" aria-busy="true" aria-label="Loading the files">
      <Skeleton height={32} radius={2} />
      <div className="h-1" />
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="flex h-6 items-center gap-2" style={{ paddingInlineStart: 8 + ((i * 7) % 3) * 14 }}>
          <Skeleton height={14} width={14} radius={1} index={i % 6} />
          <Skeleton height={11} width={`${30 + ((i * 29) % 45)}%`} radius={1} index={i % 6} />
        </div>
      ))}
    </div>
    <div className="flex h-8 flex-none items-center border-t border-line px-3" aria-hidden>
      <Skeleton height={10} width="60%" radius={1} />
    </div>
    </>
  );
}

function Files({ tree, path, onPicked, failed }: { tree: GitTree | undefined; path: string; onPicked?: () => void; failed: (() => void) | null }) {
  const { open: openPath, href } = useCode();
  const root = useMemo(() => (tree ? nodesOf(tree.paths) : null), [tree]);
  const dirs = useMemo(() => new Map<string, GitDir>((tree?.dirs ?? []).map((d) => [d.path, d])), [tree]);
  const most = useMemo(() => ({ file: (tree?.churn ?? []).reduce((m, c) => Math.max(m, c), 0), folder: (tree?.dirs ?? []).reduce((m, d) => (d.path === "" ? m : Math.max(m, d.commits)), 0) }), [tree]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!root) return;
    const want = [...ancestorsOf(root, path), ...(isFolderPath(path) && path !== "" ? [path] : [])];
    setOpen((now) => (want.every((p) => now.has(p)) ? now : new Set([...now, ...want])));
  }, [root, path]);
  if (failed)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="m-0 type-caption">The list of files could not be read.</p>
        <Button label="Try again" variant="secondary" size="sm" onClick={failed} />
      </div>
    );
  if (!tree || !root) return <TreeSkeleton />;
  return (
    <>
      <FileTree
        tree={tree}
        root={root}
        dirs={dirs}
        selected={path}
        open={open}
        setOpen={setOpen}
        onPick={(p) => {
          openPath(p);
          if (!isFolderPath(p)) onPicked?.();
        }}
        href={href}
        most={most}
      />
      <p className="m-0 flex h-8 flex-none items-center border-t border-line px-3 type-micro tnum" title="Files at HEAD when the repository was last built">
        {many(tree.paths.length, "file", "files")} at <span className="mono mx-1">{tree.head.slice(0, 7)}</span> on <span className="mono ms-1 max-w-24 truncate">{tree.branch}</span>
      </p>
    </>
  );
}

function Tabs({ tabs, path, onClose, lead }: { tabs: readonly string[]; path: string; onClose: (p: string) => void; lead?: ReactNode }) {
  const { open, href } = useCode();
  const names = new Map<string, number>();
  for (const t of tabs) names.set(nameOf(t), (names.get(nameOf(t)) ?? 0) + 1);
  return (
    <nav aria-label="Open files" className="flex h-9 flex-none items-stretch border-b border-line bg-sunken">
      {lead}
      <ul className="m-0 flex min-w-0 flex-1 list-none items-stretch overflow-x-auto p-0 [scrollbar-width:none]">
        {tabs.map((t) => {
          const here = t === path;
          const twin = (names.get(nameOf(t)) ?? 0) > 1;
          return (
            <li key={t} className={`group/tab relative flex max-w-60 flex-none items-center border-e border-line ${here ? "bg-surface text-primary" : "text-secondary hover:bg-hover hover:text-primary"}`} onAuxClick={(e) => e.button === 1 && onClose(t)}>
              {here && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand" aria-hidden />}
              <A
                href={href(t)}
                aria-current={here ? "page" : undefined}
                title={t}
                onClick={(e) => {
                  if (modified(e)) return;
                  e.preventDefault();
                  open(t);
                }}
                className="flex h-full min-w-0 items-center gap-1.5 ps-3 pe-1 text-sm no-underline"
              >
                <FileCode size={ICON.sm} className="flex-none text-tertiary" aria-hidden />
                <span className="truncate type-id">{nameOf(t)}</span>
                {twin && <span className="truncate text-xs text-tertiary">{parentOf(t).slice(0, -1).split("/").pop()}</span>}
              </A>
              <button
                type="button"
                aria-label={`Close ${nameOf(t)}`}
                onClick={() => onClose(t)}
                className={`plain-button me-1 grid size-6 flex-none place-items-center rounded-sm text-tertiary hover:bg-active hover:text-primary focus-visible:opacity-100 ${here ? "" : "opacity-0 group-hover/tab:opacity-100"}`}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Crumbs({ path }: { path: string }) {
  const { open, href, repo } = useCode();
  const crumbs = crumbsOf(path);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    if (el.scrollLeft > 0) el.dataset.clipped = "";
    else delete el.dataset.clipped;
  }, [path]);
  const go = (p: string) => (e: MouseEvent) => {
    if (modified(e)) return;
    e.preventDefault();
    open(p);
  };
  return (
    <nav aria-label="Where this is" className="min-w-0 flex-1">
      <ol ref={list} className="m-0 flex min-w-0 list-none items-center gap-0.5 overflow-x-auto p-0 text-sm [scrollbar-width:none] data-clipped:[mask-image:linear-gradient(to_right,transparent,black_20px)]">
        <li className="flex flex-none items-center">
          <A href={href("")} onClick={go("")} aria-label={`${repo}, the top of the repository`} aria-current={path === "" ? "page" : undefined} className="grid size-7 place-items-center rounded-md text-secondary no-underline hover:bg-hover hover:text-primary">
            <Home size={ICON.sm} aria-hidden />
          </A>
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.path} className="flex min-w-0 flex-none items-center gap-0.5">
              <ChevronRight size={ICON.xs} className="flex-none text-tertiary" aria-hidden />
              {last ? (
                <span aria-current="page" className="px-1.5 py-1 font-semibold whitespace-nowrap text-primary type-id">
                  {c.name}
                </span>
              ) : (
                <A href={href(c.path)} onClick={go(c.path)} className="rounded-md px-1.5 py-1 whitespace-nowrap text-secondary no-underline type-id hover:bg-hover hover:text-primary">
                  {c.name}
                </A>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`plain-button h-6 rounded-sm px-1.5 text-xs transition-colors duration-(--duration-instant) ${on ? "bg-active text-primary" : "text-secondary hover:bg-hover hover:text-primary"}`}>
      {label}
    </button>
  );
}

function StatusBar({ story, tree, path, view, line, onLine, wrap, setWrap, look, setLook }: { story: CodeStory | undefined; tree: GitTree | undefined; path: string; view: CodeView; line: number | undefined; onLine: (n: number | undefined) => void; wrap: boolean; setWrap: (w: boolean) => void; look: Look; setLook: (l: Look) => void }) {
  const { head } = useCode();
  const file = story?.file;
  const preview = !!file && hasPreview(path, file.lang);
  const binary = !!file && (file.flags & FILE_BINARY) !== 0;
  const link = !!file && (file.flags & FILE_LINK) !== 0;
  const text = view === "code" && !!file && !binary && !link && (!preview || look === "source" || line !== undefined);
  const kind = !file ? "" : binary ? (isImage(path) ? "image" : "binary") : link ? "symbolic link" : file.lang === "text" ? "plain text" : file.lang;
  return (
    <footer className="flex h-8 flex-none items-center gap-3 border-t border-line bg-sunken px-3 type-micro tnum">
      <span className="min-w-0 truncate">
        {story?.kind === "file" && file
          ? `${kind} · ${bytes(file.bytes)}${file.lines > 0 ? ` · ${many(file.lines, "line", "lines")}` : ""}${file.bytes > HIGHLIGHT_MAX && text ? " · too long to colour" : ""}`
          : story?.kind === "folder"
            ? `${many(story.files, "file", "files")} · ${bytes(story.bytes)}`
            : " "}
      </span>
      {line !== undefined && view === "code" && (
        <span className="flex flex-none items-center gap-1 text-primary">
          Line {grouped(line)}
          <button type="button" aria-label="Clear the line chosen" onClick={() => onLine(undefined)} className="plain-button hit grid size-4 place-items-center rounded-sm text-tertiary hover:text-primary">
            <X size={10} aria-hidden />
          </button>
        </span>
      )}
      <span className="flex-1" />
      {view === "code" && preview && line === undefined && <Toggle label={look === "preview" ? "Show source" : "Show preview"} on={look === "source"} onChange={(s) => setLook(s ? "source" : "preview")} />}
      {text && <Toggle label="Wrap lines" on={wrap} onChange={setWrap} />}
      <span className="hidden flex-none sm:inline" title={tree ? `HEAD of ${tree.branch} at the last Build` : "HEAD at the last Build"}>
        <span className="mono">{head.slice(0, 7)}</span>
        {tree && <span className="mono"> · {tree.branch}</span>}
      </span>
    </footer>
  );
}

const VIEW_WORDS: Record<CodeView, (folder: boolean) => string> = { code: (folder) => (folder ? "Files" : "Code"), history: () => "History", insights: () => "Insights" };

/** Everything inside the Code window: a resizable file tree, the open files as tabs, where this is, the file's or folder's story, and its Code, History and Insights. */
export function CodeApp({ story, failed, treeFailed, path, view, onView, line, onLine, tabs, onCloseTab, finding, setFinding }: { story: CodeStory | undefined; failed: (() => void) | null; treeFailed: (() => void) | null; path: string; view: CodeView; onView: (v: CodeView) => void; line: number | undefined; onLine: (n: number | undefined) => void; tabs: readonly string[]; onCloseTab: (p: string) => void; finding: boolean; setFinding: (f: boolean) => void }) {
  const { tree, open } = useCode();
  const pane = useResizable({ defaultSize: 272, minSize: 200, maxSize: 480, collapsible: true, autoSaveId: "commitscape.code.tree" });
  const [drawer, setDrawer] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [looks, setLooks] = useState<Record<string, Look>>({});
  const folder = isFolderPath(path) || story?.kind === "folder";
  const look = looks[path] ?? "preview";
  const fileTree = (
    <div className="flex min-h-0 flex-1 flex-col">
      <Files tree={tree} path={path} onPicked={() => setDrawer(false)} failed={treeFailed} />
    </div>
  );
  const refocus = () => requestAnimationFrame(() => document.querySelector<HTMLElement>("#code-window-title")?.focus({ preventScroll: true }));
  const showPane = () => (pane.isCollapsed ? pane.expand() : pane.collapse());
  return (
    <div className="relative flex min-h-0 flex-1">
      <aside aria-label="Files" className="hidden min-h-0 flex-none flex-col bg-surface md:flex" style={{ width: pane.isCollapsed ? 0 : pane.size }} hidden={pane.isCollapsed}>
        {fileTree}
      </aside>
      <span className="hidden md:contents">
        <ResizeHandle resizable={pane.props} hasDivider isAlwaysVisible={false} label="Resize the files" />
      </span>
      {drawer && (
        <div className="absolute inset-0 z-(--z-sticky) flex md:hidden" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <aside aria-label="Files" className="flex w-[min(20rem,85%)] flex-col border-e border-line bg-surface shadow-lg">
            {fileTree}
          </aside>
          <div className="flex-1 bg-(--color-bg-scrim)" onClick={() => setDrawer(false)} aria-hidden />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs
          tabs={tabs}
          path={path}
          onClose={onCloseTab}
          lead={
            <>
              <span className="flex flex-none items-center border-e border-line px-1 md:hidden">
                <IconButton label="Show the files" variant="ghost" size="sm" icon={<FolderTree size={ICON.sm} aria-hidden />} onClick={() => setDrawer(true)} aria-expanded={drawer} />
              </span>
              <span className="hidden flex-none items-center border-e border-line px-1 md:flex">
                <IconButton label={pane.isCollapsed ? "Show the files" : "Hide the files"} variant="ghost" size="sm" icon={pane.isCollapsed ? <PanelLeftOpen size={ICON.sm} aria-hidden /> : <PanelLeftClose size={ICON.sm} aria-hidden />} onClick={showPane} aria-expanded={!pane.isCollapsed} />
              </span>
              {tabs.length === 0 && <span className="flex items-center px-3 type-micro">{folder ? "Files you open show here" : ""}</span>}
            </>
          }
        />
        <div className="flex min-h-11 flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1">
          <Crumbs path={path} />
          {story?.kind !== "missing" && (
            <TabList value={view} onChange={(v) => onView(v as CodeView)} size="sm" aria-label="What to show">
              {(["code", "history", "insights"] as const).map((v) => (
                <Tab key={v} value={v} label={VIEW_WORDS[v](folder)} />
              ))}
            </TabList>
          )}
        </div>
        {!failed && <Story story={story} />}
        <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label={VIEW_WORDS[view](folder)}>
          {failed ? (
            <State icon={FileWarning} title="This could not be read" actions={<Button label="Try again" variant="secondary" size="sm" icon={<Icon icon={RefreshCw} size="sm" />} onClick={failed} />}>
              The Site did not answer for <code className="mono">{path === "" ? "/" : path}</code>. Check the connection, then try again.
            </State>
          ) : view === "history" && story?.kind !== "missing" ? (
            <History story={story} path={path} />
          ) : view === "insights" && story?.kind !== "missing" ? (
            <Insights story={story} path={path} />
          ) : folder && story?.kind !== "missing" ? (
            <FolderView folder={path} />
          ) : (
            <FileBody story={story} path={path} line={line} wrap={wrap} look={look} onLine={onLine} />
          )}
        </div>
        <StatusBar story={story} tree={tree} path={path} view={view} line={line} onLine={onLine} wrap={wrap} setWrap={setWrap} look={look} setLook={(l) => setLooks((all) => ({ ...all, [path]: l }))} />
      </div>
      {finding && tree && (
        <FileFinder
          paths={tree.paths}
          recent={tabs}
          onClose={() => {
            setFinding(false);
            refocus();
          }}
          onPick={(p) => {
            setFinding(false);
            open(p);
            refocus();
          }}
        />
      )}
    </div>
  );
}

