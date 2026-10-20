import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, FileCode, Folder, Search, X } from "lucide-react";
import { rawPath } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { typing } from "../keys";
import { useGitOptional, type GitSource } from "../git/source";
import { CODE_SHUT, codeLink, codePath, codeView, isFolderPath, nameOf, windowState, type CodeView } from "../code/address";
import { CodeApp } from "../code/CodeApp";
import { CodeContext, type CodeCtx } from "../code/context";
import { storyQuery, treeQuery } from "../code/data";
import { useTabs } from "../code/tabs";
import { CodeWindow, WINDOW_ID } from "../code/Window";
import type { Go, Route } from "../route";

const DOCK_ID = "code-dock";

let booted = false;

function Dock({ name, folder, onRestore, onClose }: { name: string; folder: boolean; onRestore: () => void; onClose: () => void }) {
  return (
    <div id={DOCK_ID} className="fixed end-4 bottom-4 z-(--z-overlay) flex h-10 items-center gap-0.5 rounded-full border border-line bg-raised ps-1 pe-1 shadow-md">
      <button type="button" onClick={onRestore} className="plain-button press flex h-8 max-w-64 items-center gap-2 rounded-full ps-3 pe-3 text-sm font-medium text-primary hover:bg-hover" aria-label={`Restore the Code window: ${name}`}>
        {folder ? <Folder size={ICON.sm} className="flex-none text-secondary" aria-hidden /> : <FileCode size={ICON.sm} className="flex-none text-secondary" aria-hidden />}
        <span className="truncate type-id">{name}</span>
      </button>
      <IconButton label="Close the Code window" variant="ghost" size="sm" icon={<X size={ICON.sm} aria-hidden />} onClick={onClose} />
    </div>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      <IconButton
        label={copied ? "Path copied" : "Copy the path"}
        tooltip={copied ? "Copied" : "Copy the path"}
        variant="ghost"
        size="sm"
        icon={copied ? <Check size={ICON.sm} aria-hidden /> : <Copy size={ICON.sm} aria-hidden />}
        onClick={() => void navigator.clipboard?.writeText(path === "" ? "/" : path).then(() => setCopied(true))}
      />
      <span className="sr-only" role="status">
        {copied ? "Path copied" : ""}
      </span>
    </>
  );
}

function Actions({ git, path, raw, head, onFind }: { git: GitSource; path: string; raw: string | null; head: string; onFind: () => void }) {
  const folder = isFolderPath(path);
  return (
    <>
      <button type="button" onClick={onFind} className="plain-button me-1 hidden h-7 items-center gap-2 rounded-md border border-line bg-surface ps-2 pe-1 text-xs text-secondary hover:border-line-strong hover:text-primary sm:flex" aria-keyshortcuts="Control+P Meta+P t">
        <Search size={ICON.sm} aria-hidden />
        Find a file
        <Kbd keys="mod+p" />
      </button>
      <span className="sm:hidden">
        <IconButton label="Find a file" variant="ghost" size="sm" icon={<Search size={ICON.sm} aria-hidden />} onClick={onFind} />
      </span>
      <CopyPath path={path} />
      {!folder && raw && <IconButton label="Open the raw file" tooltip="Raw" variant="ghost" size="sm" icon={<FileCode size={ICON.sm} aria-hidden />} href={`${raw}${rawPath(path)}`} target="_blank" rel="noopener noreferrer" />}
      <IconButton label="Open on GitHub" tooltip="Open on GitHub" variant="ghost" size="sm" icon={<ExternalLink size={ICON.sm} aria-hidden />} href={`${git.github}/${folder ? "tree" : "blob"}/${head}/${rawPath(path)}`} target="_blank" rel="noopener noreferrer" />
    </>
  );
}

/** The Code window over the workspace when the address opens it (`code=`), drawn by the server; minimised (`win=min`) it is a chip in the corner that stays across screens. Focus moves into it when it opens and back to what opened it when it goes. */
export function CodeLayer({ route, go, link, repo }: { route: Route; go: Go; link: (route: Route) => string; repo: string }) {
  const git = useGitOptional();
  useEffect(() => {
    booted = true;
  }, []);
  if (!git || route.code === undefined) return null;
  return <Layer git={git} route={route} go={go} link={link} repo={repo} />;
}

function Layer({ git, route, go, link, repo }: { git: GitSource; route: Route; go: Go; link: (route: Route) => string; repo: string }) {
  const path = codePath(route);
  const state = windowState(route);
  const view = codeView(route);
  const tree = useQuery(treeQuery(git));
  const story = useQuery(storyQuery(git, path));
  const file = !isFolderPath(path) && story.data?.kind !== "missing" ? path : null;
  const { tabs, close } = useTabs(repo, file);
  const [finding, setFinding] = useState(false);
  const opener = useRef<Element | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const visible = state !== "min";
  const was = useRef(booted ? false : visible);
  const [drawn] = useState(() => !booted);

  useEffect(() => {
    if (visible && !was.current) {
      const active = document.activeElement;
      if (active && active !== document.body && !document.getElementById(WINDOW_ID)?.contains(active) && !document.getElementById(DOCK_ID)?.contains(active)) opener.current = active;
      setFocusKey((k) => k + 1);
    }
    was.current = visible;
  }, [visible]);

  const ctx = useMemo<CodeCtx>(() => {
    const href = (p: string, line?: number) => link(codeLink(route, p, line));
    return {
      git,
      route,
      go,
      repo,
      path,
      tree: tree.data,
      raw: story.data?.raw ?? tree.data?.raw ?? null,
      head: story.data?.head ?? tree.data?.head ?? git.status.head,
      open: (p, line) => {
        const next = codeLink(route, p, line);
        go({ code: next.code, line: next.line, view: route.view === "code" ? undefined : isFolderPath(p) === isFolderPath(path) ? route.view : undefined, win: next.win });
      },
      href,
      link,
    };
  }, [git, route, go, repo, path, tree.data, story.data, link]);

  const restoreFocus = useCallback((to: "opener" | "dock") => {
    requestAnimationFrame(() => {
      const target = to === "dock" ? document.querySelector<HTMLElement>(`#${DOCK_ID} button`) : opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : document.querySelector<HTMLElement>("main h1, h1");
      target?.focus({ preventScroll: true });
    });
  }, []);
  const shut = () => {
    go(CODE_SHUT);
    restoreFocus("opener");
  };
  const minimise = () => {
    go({ win: "min" });
    restoreFocus("dock");
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if ((mod && e.key.toLowerCase() === "p" && !e.altKey) || (e.key === "t" && !mod && !e.altKey && !typing(e.target))) {
      e.preventDefault();
      setFinding(true);
    } else if (e.key === "Escape" && !finding) {
      e.preventDefault();
      minimise();
    }
  };
  const name = path === "" ? repo.split("/").pop() ?? repo : nameOf(path);
  const head = ctx.head;
  return (
    <CodeContext value={ctx}>
      {state === "min" && <Dock name={name} folder={isFolderPath(path)} onRestore={() => go({ win: undefined })} onClose={shut} />}
      <CodeWindow
        state={state}
        name="the Code window"
        focusKey={focusKey}
        drawn={drawn}
        onClose={shut}
        onMinimise={minimise}
        onToggleMax={() => go({ win: state === "max" ? undefined : "max" }, true)}
        onKey={onKey}
        title={
          <>
            <span className="hidden flex-none text-secondary sm:inline">{repo.split("/").pop()}</span>
            <span className="hidden flex-none text-tertiary sm:inline" aria-hidden>
              —
            </span>
            <span className="sr-only sm:hidden">{repo} — </span>
            <span className="min-w-0 truncate type-id" dir="auto" title={path === "" ? undefined : path}>
              {path === "" ? "/" : path}
            </span>
          </>
        }
        actions={<Actions git={git} path={path} raw={ctx.raw} head={head} onFind={() => setFinding(true)} />}
      >
        <CodeApp
          story={story.data}
          failed={story.isError ? () => void story.refetch() : null}
          treeFailed={tree.isError ? () => void tree.refetch() : null}
          path={path}
          view={view}
          onView={(v: CodeView) => go({ view: v === "code" ? undefined : v }, true)}
          line={route.line}
          onLine={(line) => go({ line }, true)}
          tabs={tabs}
          onCloseTab={(p) => {
            const next = close(p);
            if (p === path) ctx.open(next ?? path.slice(0, path.lastIndexOf("/") + 1));
          }}
          finding={finding}
          setFinding={setFinding}
        />
      </CodeWindow>
    </CodeContext>
  );
}

/** Stands in for the Code window in the list of screen skeletons: the window draws its own loading states. */
export function CodeSkeleton() {
  return <Skeleton height={320} />;
}
