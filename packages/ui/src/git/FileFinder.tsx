import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileCode, Search } from "lucide-react";
import { Kbd } from "@astryxdesign/core/Kbd";
import { ICON } from "../design/tokens";
import { grouped } from "../format";
import { find } from "./tree";

const SHOWN = 50;

/** Finds a file by a few letters of its path, inside the Code window: up and down to choose, Enter to open, Escape to close. With nothing typed it offers the files open in tabs. */
export function FileFinder({ paths, recent, onPick, onClose }: { paths: readonly string[]; recent: readonly string[]; onPick: (path: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useEffect(() => box.current?.focus(), []);
  const found = useMemo(() => (typed.trim() === "" ? [...recent].reverse() : find(paths, typed, SHOWN).map((i) => paths[i] ?? "")), [paths, typed, recent]);
  useEffect(() => {
    list.current?.querySelector(`[data-at="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  return (
    <div className="absolute inset-0 z-(--z-sticky) flex items-start justify-center bg-(--color-bg-scrim) px-3 pt-12 md:pt-16" onPointerDown={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <div className="flex max-h-[min(30rem,80%)] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-raised shadow-lg" role="search" aria-label="Find a file">
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-line px-3.5 focus-within:border-brand">
          <Search size={ICON.md} className="flex-none text-tertiary" aria-hidden />
          <input
            ref={box}
            value={typed}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={found[cursor] !== undefined ? `${id}-${cursor}` : undefined}
            aria-autocomplete="list"
            onChange={(e) => {
              setTyped(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === "ArrowDown") setCursor((c) => Math.min(found.length - 1, c + 1));
              else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
              else if (e.key === "Enter" && found[cursor]) onPick(found[cursor] ?? "");
              else return;
              e.preventDefault();
            }}
            placeholder={`Find among ${grouped(paths.length)} files`}
            aria-label="Find a file by its name or path"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent text-md text-primary outline-none placeholder:text-tertiary sm:text-base"
          />
          <span className="hidden sm:inline-flex">
            <Kbd keys="escape" />
          </span>
        </div>
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Files found" className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-1.5">
          {typed.trim() === "" && found.length > 0 && (
            <li role="presentation" className="px-2.5 pt-1 pb-1.5 type-micro">
              Open in tabs
            </li>
          )}
          {found.map((p, i) => {
            const cut = p.lastIndexOf("/");
            return (
              <li
                key={p}
                id={`${id}-${i}`}
                data-at={i}
                role="option"
                aria-selected={i === cursor}
                onPointerMove={() => setCursor(i)}
                onClick={() => onPick(p)}
                className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm ${i === cursor ? "bg-active text-primary" : "text-secondary"}`}
              >
                <FileCode size={ICON.sm} className="flex-none text-tertiary" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-primary type-id">{p.slice(cut + 1)}</span>
                  {cut >= 0 && <span className="ms-2 text-xs text-tertiary">{p.slice(0, cut)}</span>}
                </span>
              </li>
            );
          })}
          {found.length === 0 && <li className="px-3 py-6 text-center type-caption">{typed.trim() === "" ? "Type a few letters of a file's name." : "No file has those letters in that order."}</li>}
        </ul>
      </div>
    </div>
  );
}
