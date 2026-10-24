import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { ChevronRight, File, FileCode, Folder, House, Map as MapIcon } from "lucide-react";
import type { MapBlock, MapLevel, Params, PersonRef } from "@commitscape/data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useLazyData } from "../data";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { compact, grouped, many, share } from "../format";
import { Panel } from "../kit/layout";
import { FILL_PANEL } from "../reading/classes";
import { ROW_HEIGHT } from "../reading/who";
import { Quiet } from "./kit";

type Size = "churn" | "lines";

export const LISTED = 8;
const MOST = 40;
const DEEPEST = 2;

const depthOf = (path: string) => path.split("/").filter(Boolean).length;
const topOf = (path: string) => (path ? `${path.split("/")[0]}/` : null);

function learn(into: Map<string, MapBlock[]>, blocks: Map<string, MapBlock>, level: MapLevel | null) {
  if (!level) return;
  into.set(level.path, level.children);
  for (const b of level.children) {
    blocks.set(b.path, b);
    if (!b.file && b.inside.length > 0) {
      into.set(b.path, b.inside);
      for (const c of b.inside) blocks.set(c.path, c);
    }
  }
}

/** Where the work is: the folders and files of the repository ranked by their commits in the Window (or their lines), a level at a time, the biggest first; a folder opens inside itself, a file in the Code window. */
export function WhereWork({ root, params, span, commits, onFile, onMap, onCode }: { root: MapLevel | null; params: Params; span: string; commits: number; onFile: (path: string) => void; onMap: (path: string) => void; onCode: (path: string) => void }) {
  const paramsKey = JSON.stringify(params);
  const [chosen, setChosen] = useState({ at: paramsKey, path: "" });
  const focus = chosen.at === paramsKey ? chosen.path : "";
  const [all, setAll] = useState(false);
  const changed = (root?.children ?? []).some((b) => b.churn > 0);
  const [size, setSize] = useState<Size>("churn");
  const by: Size = changed ? size : "lines";
  const top = topOf(focus);
  const deeper = useLazyData<MapLevel>(top ? "/api/map" : null, { ...params, path: top ?? "" });
  const { lists, blocks } = useMemo(() => {
    const lists = new Map<string, MapBlock[]>();
    const blocks = new Map<string, MapBlock>();
    learn(lists, blocks, root);
    if (deeper.data && deeper.data.path === top) learn(lists, blocks, deeper.data);
    return { lists, blocks };
  }, [root, deeper.data, top]);

  if (!root) return null;
  const value = (b: MapBlock) => (by === "churn" ? b.churn : b.lines);
  const here = focus ? blocks.get(focus) : null;
  const whole = here ? value(here) : by === "churn" ? commits : root.children.reduce((n, b) => n + b.lines, 0);
  const amount = (n: number) => (by === "churn" ? many(n, "commit", "commits") : `${compact(n)} ${n === 1 ? "line" : "lines"}`);
  const list = lists.get(focus);
  const ranked = list ? [...list].filter((b) => value(b) > 0).sort((a, b) => value(b) - value(a) || a.path.localeCompare(b.path)) : null;
  const shown = ranked ? ranked.slice(0, all ? MOST : LISTED) : [];
  const rest = ranked ? ranked.length - shown.length : 0;
  const crumbs = [{ name: "Top level", path: "" }];
  let at = "";
  for (const part of focus.split("/").filter(Boolean)) {
    at += `${part}/`;
    crumbs.push({ name: part, path: at });
  }
  const loading = ranked === null && deeper.data?.path !== top;
  const go = (path: string) => {
    setAll(false);
    setChosen({ at: paramsKey, path });
  };
  return (
    <Panel
      padding={0}
      title="Where the work is"
      description={by === "churn" ? `Commits ${span}, by folder and file` : changed ? "Lines of code at HEAD, by folder and file" : `Nothing changed ${span}, so these are the lines of code at HEAD`}
      className={FILL_PANEL}
      actions={
        changed ? (
          <SegmentedControl label="Size by" size="md" value={size} onChange={(v) => setSize(v as Size)}>
            <SegmentedControlItem value="churn" label="Commits" />
            <SegmentedControlItem value="lines" label="Lines" />
          </SegmentedControl>
        ) : undefined
      }
    >
      <nav aria-label="Folder shown" className="flex min-w-0 flex-wrap items-center gap-0.5 px-4">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight size={ICON.sm} className="flex-none text-secondary" aria-hidden />}
            {i === crumbs.length - 1 ? (
              <span aria-current="location" className={`inline-flex h-7 items-center gap-1.5 truncate rounded-md px-1.5 type-caption font-semibold text-primary ${i === 0 ? "" : "mono"}`}>
                {i === 0 && <House size={ICON.sm} aria-hidden />}
                {c.name}
              </span>
            ) : (
              <button type="button" onClick={() => go(c.path)} className={`plain-button row-hover inline-flex h-7 items-center gap-1.5 truncate rounded-md px-1.5 type-caption text-secondary hover:text-primary ${i === 0 ? "" : "mono"}`}>
                {i === 0 && <House size={ICON.sm} aria-hidden />}
                {c.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      {loading ? (
        <ol className="m-0 list-none p-0" aria-busy="true" aria-label="Opening the folder">
          {Array.from({ length: LISTED }, (_, i) => (
            <li key={i} className={`flex ${ROW_HEIGHT} items-center gap-3 border-t border-separator px-5`}>
              <Skeleton width={16} height={16} radius={1} index={i} />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton width={`${30 + ((i * 17) % 35)}%`} height={14} radius={1} index={i} />
                <Skeleton height={6} radius={3} index={i} />
              </span>
              <Skeleton width={72} height={14} radius={1} index={i} />
            </li>
          ))}
        </ol>
      ) : shown.length === 0 ? (
        <div className="px-5 pb-4">
          <Quiet>{focus ? `Nothing in ${focus} to show ${span}.` : `Nothing changed ${span}.`}</Quiet>
        </div>
      ) : (
        <ol className="@container m-0 list-none p-0" aria-label={`Inside ${focus || "the top level"}`}>
          {shown.map((b) => (
            <Row key={b.path} block={b} amount={amount(value(b))} share={share(value(b), whole)} part={whole > 0 ? value(b) / whole : 0} deep={depthOf(b.path) <= DEEPEST} onFolder={go} onFile={onFile} />
          ))}
        </ol>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-separator px-3 py-2 sm:px-4">
        {rest > 0 || all ? (
          <Button label={all ? `Show the first ${LISTED}` : rest > MOST - LISTED ? `Show ${MOST - LISTED} more of ${grouped(rest)}` : `Show ${grouped(rest)} more`} variant="ghost" size="sm" onClick={() => setAll((a) => !a)} />
        ) : (
          <span />
        )}
        <span className="flex flex-wrap items-center gap-1">
          {depthOf(focus) <= 1 && <Button label={focus ? "This folder on the Map" : "The Map"} variant="ghost" size="sm" icon={<MapIcon size={ICON.sm} aria-hidden />} onClick={() => onMap(focus)} />}
          <Button label={focus ? "Browse this folder" : "Browse code"} variant="ghost" size="sm" icon={<FileCode size={ICON.sm} aria-hidden />} onClick={() => onCode(focus === "" ? "/" : focus)} />
        </span>
      </div>
      <div className="px-5 pb-4 empty:hidden">
        <Explain>
          {by === "churn"
            ? "Each bar is a folder or file’s share of the commits in the Window that touched it, merges and bulk commits left out. A commit touching two folders counts in both, so the shares of a level can add up to more than all. "
            : "Each bar is a folder or file’s share of the lines of code at HEAD. "}
          The face is whoever made the most commits there. A folder opens inside itself; the Map shows the same folders sized by lines, coloured by how often, when and by whom they change.
        </Explain>
      </div>
    </Panel>
  );
}

function Row({ block: b, amount, share: pct, part, deep, onFolder, onFile }: { block: MapBlock; amount: string; share: string; part: number; deep: boolean; onFolder: (path: string) => void; onFile: (path: string) => void }) {
  const can = b.file || deep;
  const label = b.file ? b.name : `${b.name}/`;
  const body = (
    <>
      {b.file ? <File size={ICON.md} className="flex-none text-secondary" aria-hidden /> : <Folder size={ICON.md} className="flex-none text-secondary" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="mono line-clamp-2 type-ui font-medium break-all text-primary">{label}</span>
        <span className="block h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(part > 0 ? 1.5 : 0, Math.min(100, part * 100))}%`, background: "var(--heat-3)" }} />
        </span>
      </span>
    </>
  );
  return (
    <li className={`${can ? "row-hover" : ""} relative flex ${ROW_HEIGHT} items-center gap-3 border-t border-separator px-5`}>
      {can ? (
        <button type="button" onClick={() => (b.file ? onFile(b.path) : onFolder(b.path))} title={b.file ? `${b.path}: open it in the Code window` : `Go inside ${b.path}`} className="plain-button flex min-w-0 flex-1 items-center gap-3 after:absolute after:inset-0">
          {body}
        </button>
      ) : (
        <span title="The Report keeps no folders deeper than this" className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </span>
      )}
      <span className="flex flex-none flex-col items-end tnum">
        <span className="type-ui whitespace-nowrap text-primary">{amount}</span>
        <span className="type-caption">{pct}</span>
      </span>
      {b.owner && <Owner p={b.owner} />}
    </li>
  );
}

function Owner({ p }: { p: PersonRef }) {
  const login = useLogin(p);
  return (
    <span className="hidden flex-none @min-[26rem]:inline-flex" title={`Most commits here by ${p.name}`}>
      <Face login={login} name={`Most commits here by ${p.name}`} size={24} tint="var(--color-text-secondary)" />
    </span>
  );
}
