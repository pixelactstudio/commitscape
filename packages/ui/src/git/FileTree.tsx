import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Search } from "lucide-react";
import type { GitDir, GitTree } from "@commitscape/data";
import { A } from "../kit/A";
import { heat, ICON } from "../design/tokens";
import { heatOf } from "./insights";
import { find, rowsOf, type Row, type TreeNode } from "./tree";

export const ROW_HEIGHT = 28;

const PROSE = new Set(["markdown", "mdx", "text"]);

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

const idOf = (base: string, i: number) => `${base}-${i}`;

function Glyph({ dir, open, lang }: { dir: boolean; open: boolean; lang: string }) {
  if (dir) return open ? <FolderOpen size={ICON.sm} className="flex-none text-brand" aria-hidden /> : <Folder size={ICON.sm} className="flex-none text-secondary" aria-hidden />;
  if (PROSE.has(lang)) return <FileText size={ICON.sm} className="flex-none text-secondary" aria-hidden />;
  return lang === "text" ? <File size={ICON.sm} className="flex-none text-secondary" aria-hidden /> : <FileCode size={ICON.sm} className="flex-none text-secondary" aria-hidden />;
}

type LineProps = {
  id: string;
  node: TreeNode;
  depth: number;
  open: boolean;
  selected: boolean;
  cursor: boolean;
  lang: string;
  level: number;
  commits: number;
  href: string;
  onPick: (path: string, node: TreeNode) => void;
  onToggle: (path: string) => void;
};

const Line = memo(function Line({ id, node, depth, open, selected, cursor, lang, level, commits, href, onPick, onToggle }: LineProps) {
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={node.dir ? open : undefined}
      title={node.path}
      className={`flex h-7 w-full items-center rounded-sm text-sm ${selected ? "bg-brand-soft" : "hover:bg-hover"} ${cursor ? "group-focus-visible/tree:outline-2 group-focus-visible/tree:-outline-offset-2 group-focus-visible/tree:outline-focus" : ""}`}
      style={{ paddingInlineStart: 4 + depth * 14 }}
    >
      <span
        aria-hidden
        onClick={() => node.dir && onToggle(node.path)}
        className={`grid size-5 flex-none place-items-center rounded-cell text-tertiary ${node.dir ? "cursor-pointer hover:text-primary" : ""}`}
      >
        {node.dir && (open ? <ChevronDown size={ICON.xs} /> : <ChevronRight size={ICON.xs} />)}
      </span>
      <A
        href={href}
        tabIndex={-1}
        onClick={(e) => {
          if (modified(e)) return;
          e.preventDefault();
          onPick(node.path, node);
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pe-2 text-primary no-underline"
      >
        <Glyph dir={node.dir} open={open} lang={lang} />
        <span className={`min-w-0 flex-1 truncate type-id ${node.dir ? "font-medium" : ""}`}>{node.name}</span>
        <Heat level={level} commits={commits} />
      </A>
    </div>
  );
});

type FoundProps = { id: string; path: string; cursor: boolean; selected: boolean; lang: string; level: number; commits: number; href: string; onPick: (path: string) => void };

const Found = memo(function Found({ id, path, cursor, selected, lang, level, commits, href, onPick }: FoundProps) {
  const cut = path.lastIndexOf("/");
  return (
    <div id={id} role="option" aria-selected={cursor} title={path} className={`flex h-7 w-full items-center rounded-sm text-sm ${cursor ? "bg-active" : selected ? "bg-brand-soft" : "hover:bg-hover"}`}>
      <A
        href={href}
        tabIndex={-1}
        onClick={(e) => {
          if (modified(e)) return;
          e.preventDefault();
          onPick(path);
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 no-underline"
      >
        <Glyph dir={false} open={false} lang={lang} />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-primary type-id">{path.slice(cut + 1)}</span>
          {cut !== -1 && <span className="ms-2 text-xs text-tertiary">{path.slice(0, cut)}</span>}
        </span>
        <Heat level={level} commits={commits} />
      </A>
    </div>
  );
});

/** The files of the repository as a tree that stays fast however many there are: only the rows on screen exist. Arrow keys move through it, Enter opens, Right and Left open and close folders; typing in the box finds files by their letters across every folder. */
export function FileTree({
  tree,
  root,
  dirs,
  selected,
  open,
  setOpen,
  onPick,
  href,
  most,
}: {
  tree: GitTree;
  root: TreeNode;
  dirs: ReadonlyMap<string, GitDir>;
  selected: string;
  open: ReadonlySet<string>;
  setOpen: (next: Set<string>) => void;
  onPick: (path: string) => void;
  href: (path: string) => string;
  most: { file: number; folder: number };
}) {
  const base = useId().replace(/[^a-z0-9-]/gi, "");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [here, setHere] = useState(selected);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => rowsOf(root, open), [root, open]);
  const found = useMemo(() => find(tree.paths, query, 300), [tree, query]);
  const searching = query.trim() !== "";
  const count = searching ? found.length : rows.length;
  const virtual = useVirtualizer({ count, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 14 });
  const at = useMemo(() => rows.findIndex((r) => r.node.path === here), [rows, here]);

  useEffect(() => setHere(selected), [selected]);
  useEffect(() => {
    if (!searching && at >= 0) virtual.scrollToIndex(at, { align: "auto" });
  }, [at, searching, virtual]);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (searching) virtual.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, searching, virtual]);

  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOpen(next);
  };
  const pick = (path: string, node?: TreeNode) => {
    if (node?.dir) setOpen(new Set(open).add(path));
    setHere(path);
    onPick(path);
  };
  const move = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (row) setHere(row.node.path);
  };

  const onTreeKeys = (e: KeyboardEvent) => {
    const row: Row | undefined = rows[at];
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "PageDown") move(at + 15);
    else if (e.key === "PageUp") move(at - 15);
    else if (e.key === "Enter" || e.key === " ") {
      if (row) pick(row.node.path, row.node);
    } else if (e.key === "ArrowRight" && row?.node.dir) {
      if (!row.open) toggle(row.node.path);
      else move(at + 1);
    } else if (e.key === "ArrowLeft" && row) {
      if (row.node.dir && row.open) toggle(row.node.path);
      else for (let i = at - 1; i >= 0; i--) if ((rows[i] as Row).depth < row.depth) return void (e.preventDefault(), move(i));
    } else return;
    e.preventDefault();
  };
  const onFindKeys = (e: KeyboardEvent) => {
    if (!searching) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        scroller.current?.focus();
      }
      return;
    }
    if (e.key === "ArrowDown") setCursor((c) => Math.min(found.length - 1, c + 1));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
    else if (e.key === "Enter") {
      const i = found[cursor];
      if (i !== undefined) onPick(tree.paths[i] as string);
    } else if (e.key === "Escape") setQuery("");
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const active = searching ? (found.length > 0 ? idOf(base, cursor) : undefined) : at >= 0 ? idOf(base, at) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none p-2" onKeyDown={onFindKeys}>
        <TextInput label="Filter the files" isLabelHidden placeholder="Filter the files" value={query} onChange={setQuery} hasClear width="100%" size="sm" startIcon={<Search size={ICON.sm} aria-hidden />} />
      </div>
      <div
        ref={scroller}
        role={searching ? "listbox" : "tree"}
        aria-label={searching ? "Files found" : "Files"}
        aria-activedescendant={active}
        tabIndex={0}
        onKeyDown={searching ? undefined : onTreeKeys}
        onFocus={() => !searching && at < 0 && move(0)}
        className="group/tree min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 outline-none"
      >
        <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((v) => (
            <div key={v.key} className="absolute inset-x-0 top-0" style={{ height: v.size, transform: `translateY(${v.start}px)` }}>
              {searching
                ? (() => {
                    const i = found[v.index] as number;
                    const path = tree.paths[i] as string;
                    return <Found id={idOf(base, v.index)} path={path} cursor={v.index === cursor} selected={path === selected} lang={tree.langs[tree.lang[i] ?? 0] ?? "text"} level={heatOf(tree.churn[i] ?? 0, most.file)} commits={tree.churn[i] ?? 0} href={href(path)} onPick={onPick} />;
                  })()
                : (() => {
                    const r = rows[v.index] as Row;
                    const dir = r.node.dir ? dirs.get(r.node.path) : undefined;
                    const churn = r.node.dir ? (dir?.commits ?? 0) : (tree.churn[r.node.lo] ?? 0);
                    return (
                      <Line
                        id={idOf(base, v.index)}
                        node={r.node}
                        depth={r.depth}
                        open={r.open}
                        selected={r.node.path === selected}
                        cursor={v.index === at}
                        lang={r.node.dir ? "" : (tree.langs[tree.lang[r.node.lo] ?? 0] ?? "text")}
                        level={heatOf(churn, r.node.dir ? most.folder : most.file)}
                        commits={churn}
                        href={href(r.node.path)}
                        onPick={pick}
                        onToggle={toggle}
                      />
                    );
                  })()}
            </div>
          ))}
        </div>
        {searching && found.length === 0 && <p className="m-0 px-3 py-6 text-center type-caption">No file has those letters in that order.</p>}
      </div>
    </div>
  );
}

/** How often a file or folder changes against the most of any, as a short bar, with the count on hover. */
export function Heat({ level, commits }: { level: number; commits: number }) {
  return (
    <span className="flex h-1.5 w-4 flex-none overflow-hidden rounded-full bg-sunken" title={commits > 0 ? `${commits.toLocaleString()} ${commits === 1 ? "commit" : "commits"}, merges and Bulk Commits left out` : "No commits"}>
      <span className="block h-full rounded-full" style={{ width: `${level * 25}%`, background: heat(Math.max(2, level)) }} />
    </span>
  );
}
