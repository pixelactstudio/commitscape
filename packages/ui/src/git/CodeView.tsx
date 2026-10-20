import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { highlight, slotClass, syntaxSheet, type Marked } from "./highlight";

export const LINE_HEIGHT = 20;
const WIDEST = 400;
const SHEET = syntaxSheet(".code-lines");

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

type LineProps = { n: number; digits: number; chosen: boolean; tokens: [string, number][] | undefined; plain: string; wrap: boolean; href: string | undefined; onPick: (n: number) => void };

const Line = memo(function Line({ n, digits, chosen, tokens, plain, wrap, href, onPick }: LineProps) {
  return (
    <>
      <a
        href={href}
        tabIndex={-1}
        onClick={(e) => {
          if (modified(e)) return;
          e.preventDefault();
          onPick(n);
        }}
        className={`sticky start-0 z-(--z-raised) flex-none cursor-pointer self-stretch pe-4 text-end text-tertiary no-underline tnum select-none hover:text-primary ${chosen ? "bg-brand-soft text-brand" : "bg-surface"}`}
        style={{ width: `${digits + 3}ch`, paddingInlineStart: "1ch" }}
      >
        {n}
      </a>
      <span className={`min-w-0 pe-8 ${wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"}`}>{tokens ? tokens.map(([text, slot], i) => (slot === 0 ? text : <span key={i} className={slotClass(slot)}>{text}</span>)) : plain || " "}</span>
    </>
  );
});

function linesOf(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  return all;
}

/** A file's text, a line at a time and only the lines on screen, in plain text at once and in the theme's syntax colours as soon as the worker has them; a line number is a link to that line. */
export function CodeView({ text, lang, line, onLine, wrap = false, lineHref, label = "File" }: { text: string; lang: string; line: number | undefined; onLine: (n: number | undefined) => void; wrap?: boolean; lineHref?: (n: number) => string; label?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => linesOf(text), [text]);
  const [marked, setMarked] = useState<{ text: string; value: Marked } | null>(null);
  useEffect(() => {
    let current = true;
    void highlight(text, lang).then((value) => {
      if (current && value) setMarked({ text, value });
    });
    return () => {
      current = false;
    };
  }, [text, lang]);
  const ready = marked && marked.text === text ? marked.value : null;
  const longest = useMemo(() => Math.min(WIDEST, lines.reduce((m, l) => Math.max(m, l.length), 0)), [lines]);
  const digits = String(lines.length).length;
  const virtual = useVirtualizer({ count: lines.length, getScrollElement: () => scroller.current, estimateSize: () => LINE_HEIGHT, overscan: 24 });
  useEffect(() => {
    virtual.measure();
  }, [wrap, virtual]);
  const picked = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [text]);
  useEffect(() => {
    if (line === picked.current) return;
    if (line && line >= 1 && line <= lines.length) virtual.scrollToIndex(line - 1, { align: "center" });
  }, [line, lines.length, virtual]);
  const pick = (n: number) => {
    picked.current = n === line ? undefined : n;
    onLine(picked.current);
  };
  return (
    <div ref={scroller} className="code-lines min-h-0 flex-1 overflow-auto overscroll-contain bg-surface type-code" style={{ tabSize: 4 }} aria-label={label} role="region" tabIndex={0}>
      <style>{SHEET}</style>
      <div className="relative pt-2 pb-6" style={{ height: virtual.getTotalSize() + 32, width: wrap ? "100%" : `calc(${digits + 3}ch + ${longest}ch + 3rem)`, minWidth: "100%" }}>
        {virtual.getVirtualItems().map((v) => {
          const n = v.index + 1;
          const chosen = n === line;
          return (
            <div
              key={v.key}
              data-index={v.index}
              ref={wrap ? virtual.measureElement : undefined}
              className={`absolute inset-x-0 top-2 flex ${chosen ? "bg-brand-soft" : ""}`}
              style={{ minHeight: LINE_HEIGHT, height: wrap ? undefined : LINE_HEIGHT, transform: `translateY(${v.start}px)` }}
            >
              <Line n={n} digits={digits} chosen={chosen} tokens={ready?.lines[v.index]} plain={lines[v.index] ?? ""} wrap={wrap} href={lineHref?.(n)} onPick={pick} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
