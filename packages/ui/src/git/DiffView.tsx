import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { ChevronRight, ExternalLink, FileCode, FileWarning } from "lucide-react";
import { languageOf, type GitPullFile } from "@commitscape/data";
import { useWidth } from "../branches/useWidth";
import { ICON } from "../design/tokens";
import { A } from "../kit/A";
import { buildRows, heightOf, sidesOf, STATUS_WORDS, type DiffLine, type DiffRow, type Sides } from "./diff";
import { highlight, slotClass, syntaxSheet, type Marked } from "./highlight";

const SHEET = syntaxSheet(".diff-lines");
const WIDEST = 400;

type Tokens = { now: Marked | null; old: Marked | null; where: Sides["where"] };

const TINT: Record<DiffLine["kind"], string> = {
  hunk: "",
  add: "bg-added-soft",
  del: "bg-removed-soft",
  ctx: "bg-surface",
  note: "bg-surface",
};

const SIGN: Record<DiffLine["kind"], string> = { hunk: "", add: "+", del: "−", ctx: "", note: "" };

const WHY: Record<Extract<DiffRow, { kind: "note" }>["why"], string> = {
  binary: "A binary file: there are no lines to show.",
  large: "Its diff is too large, or it is a lockfile or minified file, so its lines were not kept.",
  cap: "The pull request's diff passed the size kept, so this file's lines were left out.",
  empty: "No line changed: the file was only renamed or had its mode changed.",
  none: "Its lines were not kept.",
};

type LineProps = { line: DiffLine; tokens: [string, number][] | undefined; digits: number; wrap: boolean };

const Line = memo(function Line({ line, tokens, digits, wrap }: LineProps) {
  const width = `${digits + 1}ch`;
  const note = line.kind === "note";
  return (
    <>
      <span className={`sticky start-0 z-(--z-raised) flex flex-none select-none ps-3 ${TINT[line.kind]}`} aria-hidden>
        <span className="flex-none pe-2 text-end text-tertiary tnum" style={{ width }}>
          {line.old ?? ""}
        </span>
        <span className="flex-none pe-2 text-end text-tertiary tnum" style={{ width }}>
          {line.now ?? ""}
        </span>
        <span className={`w-[2ch] flex-none text-center ${line.kind === "add" ? "text-added" : line.kind === "del" ? "text-removed" : ""}`}>{SIGN[line.kind]}</span>
      </span>
      <span className={`min-w-0 flex-1 pe-6 ${wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"} ${note ? "text-secondary italic" : ""} ${TINT[line.kind]}`}>
        {line.kind === "add" || line.kind === "del" ? <span className="sr-only">{line.kind === "add" ? "Added: " : "Removed: "}</span> : null}
        {tokens ? tokens.map(([text, slot], i) => (slot === 0 ? text : <span key={i} className={slotClass(slot)}>{text}</span>)) : line.text || " "}
      </span>
    </>
  );
});

type HeaderProps = {
  file: GitPullFile;
  open: boolean;
  onToggle: () => void;
  code: string | null;
  github: string;
  sticky: boolean;
  width: number;
};

function FileHeader({ file, open, onToggle, code, github, sticky, width }: HeaderProps) {
  const cut = file.path.lastIndexOf("/") + 1;
  return (
    <div className={`flex h-full items-center gap-2 border-y border-line bg-sunken px-3 ${sticky ? "shadow-sm" : ""}`} style={{ width: width || "100%", position: "sticky", insetInlineStart: 0 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? "Fold" : "Unfold"} ${file.path}`} className="plain-button hit grid size-6 flex-none place-items-center rounded-sm text-secondary hover:bg-hover hover:text-primary">
        <ChevronRight size={ICON.sm} aria-hidden className={`transition-transform duration-(--duration-instant) ${open ? "rotate-90" : ""}`} />
      </button>
      <span className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono text-sm" title={file.old ? `${file.old} → ${file.path}` : file.path}>
        {file.old && <span className="me-1.5 min-w-0 shrink-0 truncate text-tertiary line-through decoration-1 max-sm:hidden">{file.old.slice(file.old.lastIndexOf("/") + 1)}</span>}
        {file.old && <span className="me-1.5 flex-none text-tertiary max-sm:hidden">→</span>}
        <span className="min-w-0 truncate text-secondary">{file.path.slice(0, cut)}</span>
        <span className="min-w-0 shrink-[0.05] truncate font-semibold text-primary">{file.path.slice(cut)}</span>
      </span>
      <span className="hidden flex-none type-micro sm:inline">{STATUS_WORDS[file.status] ?? file.status}</span>
      <span className="flex-none text-sm tnum">
        {file.binary ? (
          <span className="text-secondary">binary</span>
        ) : (
          <>
            <span className="text-added">+{file.added ?? 0}</span> <span className="text-removed">−{file.removed ?? 0}</span>
          </>
        )}
      </span>
      {code && (
        <A href={code} className="hit inline-flex h-6 flex-none items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-secondary no-underline hover:bg-hover hover:text-primary" title="Open this file at HEAD in the Code window">
          <FileCode size={ICON.xs} aria-hidden />
          <span className="max-sm:sr-only">Code</span>
        </A>
      )}
      <a href={github} target="_blank" rel="noopener noreferrer" className="hit inline-flex h-6 flex-none items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-secondary no-underline hover:bg-hover hover:text-primary" title="Open this file's diff on GitHub">
        <ExternalLink size={ICON.xs} aria-hidden />
        <span className="max-sm:sr-only">GitHub</span>
      </a>
    </div>
  );
}

export type DiffProps = {
  files: readonly GitPullFile[];
  collapsed: ReadonlySet<number>;
  onToggle: (index: number) => void;
  wrap: boolean;
  target: { index: number; nonce: number } | null;
  onActive: (index: number) => void;
  codeHref: (file: GitPullFile) => string | null;
  githubHref: (file: GitPullFile) => string;
  label: string;
  className?: string;
};

/** Draws a pull request's diff a row at a time, only the rows on screen, in plain text at once and in syntax colours when the worker has them. */
export function DiffView({ files, collapsed, onToggle, wrap, target, onActive, codeHref, githubHref, label, className = "" }: DiffProps) {
  const [box, width] = useWidth<HTMLDivElement>();
  const built = useMemo(() => buildRows(files, collapsed), [files, collapsed]);
  const { rows, starts } = built;
  const [tokens, setTokens] = useState<ReadonlyMap<string, Tokens>>(new Map());
  const asked = useRef(new Set<string>());
  const active = useRef(0);
  const extract = useCallback(
    (range: Range) => {
      const found = defaultRangeExtractor(range);
      const row = rows[range.startIndex];
      const head = row === undefined ? undefined : starts[row.file];
      if (head !== undefined && head < range.startIndex && !found.includes(head)) found.unshift(head);
      return found;
    },
    [rows, starts],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => box.current,
    estimateSize: (i) => heightOf(rows[i] as DiffRow),
    overscan: 24,
    rangeExtractor: extract,
  });
  const items = virtual.getVirtualItems();
  const first = virtual.range?.startIndex ?? 0;
  const current = rows[first]?.file ?? 0;
  useEffect(() => {
    if (current !== active.current) {
      active.current = current;
      onActive(current);
    }
  }, [current, onActive]);
  useEffect(() => {
    virtual.measure();
  }, [wrap, virtual]);
  useEffect(() => {
    if (!target) return;
    const at = starts[target.index];
    if (at !== undefined) virtual.scrollToIndex(at, { align: "start" });
  }, [target, starts, virtual]);
  const visible = [...new Set(items.map((v) => rows[v.index]?.file ?? 0))].join(",");
  useEffect(() => {
    for (const k of visible.split(",")) {
      const i = Number(k);
      const file = files[i];
      if (!file?.patch || collapsed.has(i) || asked.current.has(file.path)) continue;
      asked.current.add(file.path);
      const sides = sidesOf(built.lines[i] ?? []);
      const lang = languageOf(file.path);
      void Promise.all([highlight(sides.now, lang), sides.old === null ? Promise.resolve(null) : highlight(sides.old, lang)]).then(([now, old]) => {
        if (now || old) setTokens((held) => new Map(held).set(file.path, { now, old, where: sides.where }));
      });
    }
  }, [visible, files, collapsed, built]);
  const keys = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const to = e.key === "]" ? Math.min(files.length - 1, current + 1) : e.key === "[" ? Math.max(0, current - 1) : null;
    if (to === null) return;
    e.preventDefault();
    const at = starts[to];
    if (at !== undefined) virtual.scrollToIndex(at, { align: "start" });
  };
  const longest = Math.min(WIDEST, built.longest);
  const gutter = built.digits * 2 + 4;
  const total = virtual.getTotalSize();
  const body: CSSProperties = wrap ? { width: "100%" } : { width: `max(100%, calc(${gutter}ch + ${longest}ch + 3rem))` };
  return (
    <div ref={box} className={`diff-lines relative min-h-0 overflow-auto overscroll-contain bg-surface type-code ${className}`} role="region" aria-label={label} tabIndex={0} onKeyDown={keys} style={{ tabSize: 4 }}>
      <style>{SHEET}</style>
      <div className="relative" style={{ height: total, ...body }}>
        {items.map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          const stuck = row.kind === "file" && v.index < first;
          const file = files[row.file];
          if (!file) return null;
          const place: CSSProperties = stuck ? { height: v.size } : { height: wrap && row.kind === "line" ? undefined : v.size, minHeight: v.size, transform: `translateY(${v.start}px)` };
          return (
            <div key={v.key} data-index={v.index} ref={wrap && row.kind === "line" ? virtual.measureElement : undefined} style={place} className={`${stuck ? "sticky top-0 z-(--z-sticky)" : "absolute inset-x-0 top-0"} ${row.kind === "line" ? "flex" : ""}`}>
              {row.kind === "file" && (
                <FileHeader file={file} open={!collapsed.has(row.file)} onToggle={() => onToggle(row.file)} code={codeHref(file)} github={githubHref(file)} sticky={stuck} width={width} />
              )}
              {row.kind === "hunk" && (
                <div className="flex h-full items-center bg-sunken px-3 text-secondary" style={{ position: "sticky", insetInlineStart: 0, width: width || "100%" }}>
                  <span className="truncate">{row.text}</span>
                </div>
              )}
              {row.kind === "line" && <Line line={row.line} tokens={tokensOf(tokens.get(file.path), row)} digits={built.digits} wrap={wrap} />}
              {row.kind === "note" && (
                <p className="m-0 flex h-full items-center gap-2 px-4 text-secondary" style={{ position: "sticky", insetInlineStart: 0, width: width || "100%" }}>
                  <FileWarning size={ICON.sm} className="flex-none" aria-hidden />
                  <span className="min-w-0 text-wrap">{WHY[row.why]}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tokensOf(held: Tokens | undefined, row: Extract<DiffRow, { kind: "line" }>): [string, number][] | undefined {
  const spot = held?.where[row.at];
  if (!held || !spot) return undefined;
  return (spot[0] === 0 ? held.now : held.old)?.lines[spot[1]];
}
