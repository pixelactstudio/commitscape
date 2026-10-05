import { useMemo, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { ChevronRight, File, Folder, House, Map as MapIcon } from "lucide-react";
import type { MapBlock, MapLevel, Params } from "@commitscape/data";
import { arcsOf, Sunburst, type SunNode } from "../charts/Sunburst";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useLazyData } from "../data";
import { Explain } from "../explain";
import { compact, date, grouped, many, share } from "../format";
import { Panel } from "../kit/layout";
import { Quiet } from "./kit";

type Size = "churn" | "lines";

const LISTED = 8;
const DEEPEST = 2;

const depthOf = (path: string) => path.split("/").filter(Boolean).length;
const topOf = (path: string) => (path ? `${path.split("/")[0]}/` : null);
const parentOf = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 1 ? "" : `${parts.slice(0, -1).join("/")}/`;
};

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

/** Where the work is, as a sunburst of folders sized by their commits in the Window (or their lines), entered a ring at a time, with a list of the level beside it. */
export function WhereWork({ root, name, params, span, commits, onFile, onFolder }: { root: MapLevel | null; name: string; params: Params; span: string; commits: number; onFile: (path: string) => void; onFolder: (path: string) => void }) {
  const paramsKey = JSON.stringify(params);
  const [chosen, setChosen] = useState({ at: paramsKey, path: "" });
  const focus = chosen.at === paramsKey ? chosen.path : "";
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hover, setHover] = useState<string | null>(null);
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
  const unit = by === "churn" ? ["commit", "commits"] : ["line", "lines"];
  const amount = (n: number) => (by === "churn" ? many(n, unit[0] ?? "", unit[1] ?? "") : `${compact(n)} ${n === 1 ? "line" : "lines"}`);
  const inside = focus ? `of ${focus}` : "of all";

  const nodesOf = (path: string, rings: number, colourOf: (i: number) => string): SunNode[] | null => {
    const list = lists.get(path);
    if (!list) return null;
    return [...list]
      .filter((b) => value(b) > 0)
      .sort((a, b) => value(b) - value(a))
      .map((b, i) => {
        const colour = colourOf(i);
        const open = !b.file && depthOf(b.path) <= DEEPEST;
        return {
          key: b.path,
          name: b.file ? b.name : `${b.name}/`,
          value: value(b),
          colour,
          file: b.file,
          open,
          inside: rings > 1 && !b.file ? nodesOf(b.path, rings - 1, () => colour) : null,
          tip: (
            <>
              <strong className="font-mono text-[0.78rem]">{b.path}</strong>
              <div>
                {amount(value(b))} · {share(value(b), whole)} {inside}
              </div>
              <div className="note">
                {by === "churn" ? `${compact(b.lines)} lines` : many(b.churn, "commit", "commits")}
                {b.file ? "" : ` in ${many(b.files, "file", "files")}`}
                {b.last_touched > 0 ? `, last changed ${date(b.last_touched)}` : ""}
              </div>
              {b.owner && <div className="note">most commits by {b.owner.name}</div>}
              <div className="note">{b.file ? "click to open it on the Map" : open ? "click to go inside" : "the Report keeps no deeper folders"}</div>
            </>
          ),
        };
      });
  };

  const nodes = nodesOf(focus, 2, (i) => `var(--s${(i % 8) + 1})`);
  const more = (count: number, v: number, parent: SunNode | null): SunNode => ({
    key: `${parent?.key ?? focus}…`,
    name: `${count} more`,
    value: v,
    colour: "var(--other)",
    file: false,
    open: false,
    inside: null,
    tip: (
      <>
        <strong>
          {count} smaller {count === 1 ? "one" : "ones"}
        </strong>
        <div className="note">{amount(v)} between them</div>
      </>
    ),
  });
  const arcs = nodes ? arcsOf(nodes, more, LISTED) : [];
  const go = (path: string) => {
    setDirection(path.length >= focus.length ? 1 : -1);
    setHover(null);
    setChosen({ at: paramsKey, path });
  };
  const pick = (n: SunNode) => {
    if (n.file) onFile(n.key);
    else if (n.open) go(n.key);
  };
  const lit = hover ? arcs.find((a) => a.node.key === hover)?.node : null;
  const block = lit ? blocks.get(lit.key) : null;
  const crumbs = [{ name, path: "" }];
  let at = "";
  for (const part of focus.split("/").filter(Boolean)) {
    at += `${part}/`;
    crumbs.push({ name: part, path: at });
  }
  const listed = nodes ?? [];
  const rest = listed.slice(LISTED);
  const loading = nodes === null && deeper.data?.path !== top;

  return (
    <Panel
      title="Where the work is"
      description={by === "churn" ? `Commits ${span} by folder: the inner ring is each folder here, the outer ring what is inside it. Click a ring to go in.` : changed ? "Lines of code at HEAD by folder; click a ring to go in." : `Nothing changed ${span}, so these are the lines of code at HEAD by folder.`}
      actions={
        changed ? (
          <SegmentedControl label="Size by" size="sm" value={size} onChange={(v) => setSize(v as Size)}>
            <SegmentedControlItem value="churn" label="Commits" />
            <SegmentedControlItem value="lines" label="Lines" />
          </SegmentedControl>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder of the sunburst" className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={14} className="flex-none text-secondary" aria-hidden />}
              {i === crumbs.length - 1 ? (
                <span aria-current="location" className="inline-flex items-center gap-1.5 truncate rounded-[var(--radius-element)] px-2 py-1 font-mono text-[0.82rem] font-semibold">
                  {i === 0 && <House size={14} aria-hidden />}
                  {c.name}
                </span>
              ) : (
                <button type="button" onClick={() => go(c.path)} className="inline-flex cursor-pointer items-center gap-1.5 truncate rounded-[var(--radius-element)] border-0 bg-transparent px-2 py-1 font-mono text-[0.82rem] text-secondary transition-colors hover:bg-[var(--color-overlay-hover)] hover:text-primary">
                  {i === 0 && <House size={14} aria-hidden />}
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        {depthOf(focus) <= 1 && (
          <button type="button" onClick={() => onFolder(focus)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-element)] border-0 bg-transparent px-2 py-1 font-[inherit] text-[0.82rem] text-secondary transition-colors hover:bg-[var(--color-overlay-hover)] hover:text-primary">
            <MapIcon size={14} aria-hidden />
            {focus ? "This folder on the Map" : "Everything on the Map"}
          </button>
        )}
      </div>
      <div className="grid items-center gap-x-10 gap-y-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[21rem]">
          {loading ? (
            <div className="grid aspect-square place-items-center">
              <Spinner size="lg" aria-label="Opening the folder" />
            </div>
          ) : arcs.length === 0 ? (
            <div className="grid aspect-square place-items-center">
              <Quiet>{focus ? `Nothing in ${focus} to show ${span}.` : `Nothing changed ${span}.`}</Quiet>
            </div>
          ) : (
            <Sunburst
              level={`${by}:${focus}`}
              arcs={arcs}
              direction={direction}
              hover={hover}
              onHover={setHover}
              onPick={pick}
              onUp={focus ? () => go(parentOf(focus)) : undefined}
              label={`${focus || name}: ${listed.length} folders and files, sized by ${by === "churn" ? "commits" : "lines"}`}
              centre={
                lit ? (
                  <>
                    <span className="max-w-full truncate font-mono text-[0.78rem] font-semibold">{lit.name}</span>
                    <span className="text-[1.15rem] leading-tight font-semibold tracking-[-0.02em] tnum">{share(lit.value, whole)}</span>
                    <span className="max-w-full truncate text-[0.72rem] text-secondary">{amount(lit.value)}</span>
                  </>
                ) : (
                  <>
                    <span className="max-w-full truncate font-mono text-[0.78rem] font-semibold">{focus ? crumbs.at(-1)?.name : name}</span>
                    <span className="text-[1.15rem] leading-tight font-semibold tracking-[-0.02em] tnum">{by === "churn" ? grouped(whole) : compact(whole)}</span>
                    <span className="text-[0.72rem] text-secondary">{by === "churn" ? (whole === 1 ? "commit" : "commits") : "lines"}</span>
                    {focus && <span className="mt-0.5 text-[0.68rem] text-secondary">click to go up</span>}
                  </>
                )
              }
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          {listed.length === 0 ? null : (
            <ol className="m-0 flex list-none flex-col p-0" aria-label={`Inside ${focus || name}`} onMouseLeave={() => setHover(null)}>
              {listed.slice(0, LISTED).map((n) => (
                <Row key={n.key} node={n} block={blocks.get(n.key) ?? null} whole={whole} amount={amount} lit={hover === n.key || block?.path === n.key} dim={hover !== null && hover !== n.key && !hover.startsWith(n.key)} onHover={setHover} onPick={pick} />
              ))}
              {rest.length > 0 && (
                <li className="flex items-center justify-between gap-3 px-2 pt-2 text-xs text-secondary">
                  <span>and {many(rest.length, "more", "more")}</span>
                  <span className="tnum">{amount(rest.reduce((n, r) => n + r.value, 0))}</span>
                </li>
              )}
            </ol>
          )}
        </div>
      </div>
      <Explain>
        {by === "churn"
          ? "Each slice is a folder or file, as wide as its share of the commits in the Window that touched it, merges and bulk commits left out; a commit touching two folders counts in both, so a level's slices are shares of each other. "
          : "Each slice is a folder or file, as wide as its share of the lines of code at HEAD. "}
        Paler slices are files. The Map shows the same folders sized by lines, coloured by how often, when and by whom they change.
      </Explain>
    </Panel>
  );
}

function Row({ node, block, whole, amount, lit, dim, onHover, onPick }: { node: SunNode; block: MapBlock | null; whole: number; amount: (n: number) => string; lit: boolean; dim: boolean; onHover: (k: string | null) => void; onPick: (n: SunNode) => void }) {
  const can = node.file || node.open;
  const body = (
    <>
      <span aria-hidden className="size-2.5 flex-none rounded-[3px]" style={{ background: node.file ? `color-mix(in srgb, ${node.colour} 62%, var(--color-background-surface))` : node.colour }} />
      {node.file ? <File size={14} className="flex-none text-secondary" aria-hidden /> : <Folder size={14} className="flex-none text-secondary" aria-hidden />}
      <span className="min-w-0 flex-1 truncate font-mono text-[0.82rem] text-primary">{node.name}</span>
      {block?.owner && <Owner p={block.owner} />}
      <span className="w-[5.5rem] flex-none text-end text-[0.8rem] whitespace-nowrap text-secondary tnum">{amount(node.value)}</span>
      <span className="w-10 flex-none text-end text-[0.8rem] font-medium tnum">{share(node.value, whole)}</span>
    </>
  );
  const cls = `flex w-full items-center gap-2.5 rounded-[var(--radius-element)] px-2 py-1.5 text-start transition-[background-color,opacity] duration-200 ${lit ? "bg-[var(--color-overlay-hover)]" : ""} ${dim ? "opacity-55" : ""}`;
  return (
    <li onMouseEnter={() => onHover(node.key)}>
      {can ? (
        <button type="button" onClick={() => onPick(node)} onFocus={() => onHover(node.key)} onBlur={() => onHover(null)} title={node.file ? "Open it on the Map" : "Go inside"} className={`${cls} cursor-pointer border-0 bg-transparent font-[inherit] hover:bg-[var(--color-overlay-hover)]`}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Owner({ p }: { p: NonNullable<MapBlock["owner"]> }) {
  const login = useLogin(p);
  return (
    <span className="hidden flex-none sm:inline-flex" title={`Most commits by ${p.name}`}>
      <Face login={login} name={p.name} size={16} />
    </span>
  );
}
