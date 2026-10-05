import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ChevronLeft, ChevronRight, House, X } from "lucide-react";
import { NOT_IN_REPORT, type File as FileData, type MapBlock, type MapLevel } from "@commitscape/data";
import { useData, useLazyData } from "../data";
import { TableView } from "../charts/common";
import { useTip } from "../charts/tip";
import { squarify, type Rect } from "../charts/treemap";
import { LinesSkeleton } from "../components/Loading";
import { Name } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, day, duration, grouped, many } from "../format";
import { personColour, ramp } from "../theme";
import { Failed, ScreenFrame } from "./kit";
import { folderOf, openers, type ScreenProps } from "./props";

type Colour = "activity" | "age" | "owner";
const COLOURS: [Colour, string][] = [
  ["activity", "How often"],
  ["age", "When last"],
  ["owner", "Who"],
];

export const WIDE = { w: 1200, h: 540 };
export const NARROW = { w: 400, h: 560 };
const HEADER = 22;

type Drawn = Rect & { block: MapBlock; depth: number };

const AGES = [
  [30, "under a month"],
  [90, "under 3 months"],
  [365, "under a year"],
  [Infinity, "a year or more"],
] as const;

function layout(children: MapBlock[], w: number, h: number): Drawn[] {
  const drawn: Drawn[] = [];
  for (const r of squarify(children, (b) => b.lines, { x: 0, y: 0, w, h })) {
    drawn.push({ ...r, block: r.item, depth: 0 });
    if (!r.item.file && r.item.inside.length > 0 && r.w > 30 && r.h > HEADER + 12) {
      const inner = { x: r.x + 2, y: r.y + HEADER, w: r.w - 4, h: r.h - HEADER - 2 };
      for (const c of squarify(r.item.inside, (b) => b.lines, inner)) drawn.push({ ...c, block: c.item, depth: 1 });
    }
  }
  return drawn;
}

function centre(drawn: Drawn[], p: string) {
  let best: Drawn | undefined;
  for (const d of drawn) {
    const b = d.block;
    if (b.path === p || (!b.file && p.startsWith(b.path))) {
      if (!best || b.path.length > best.block.path.length) best = d;
    }
  }
  return best ? { x: best.x + best.w / 2, y: best.y + best.h / 2 } : null;
}

/** The code at HEAD as nested blocks sized by lines, coloured by how often, when or by whom it changes; entered a folder at a time, a file opening its details. */
export function MapScreen({ meta, params, route, go }: ScreenProps) {
  const path = route.path ?? "";
  const { data: level, error, stale } = useData<MapLevel>("/api/map", { ...params, path });
  const file = useLazyData<FileData>(route.file ? "/api/file" : null, { ...params, path: route.file });
  const [colour, setColour] = useState<Colour>("activity");
  const open = openers(go);
  if (error || !level) {
    const up = path.split("/").filter(Boolean).slice(0, -1);
    return (
      <Failed
        words={error === NOT_IN_REPORT ? `The Report keeps the Map at the top and inside each top folder, not inside ${path}. Open its files from the folder above.` : error}
        action={path ? <Button label={up.length > 0 ? `Back to ${up.join("/")}/` : "Back to the top"} variant="secondary" size="sm" icon={<Icon icon={ChevronLeft} size="sm" />} onClick={() => open.folder(up.length > 0 ? `${up.join("/")}/` : "")} /> : undefined}
      />
    );
  }

  const wide = layout(level.children, WIDE.w, WIDE.h);
  const narrow = layout(level.children, NARROW.w, NARROW.h);
  const churns = wide.filter((d) => d.depth === 1 || d.block.file || d.block.inside.length === 0).map((d) => d.block.churn);
  const most = Math.max(1, ...churns);
  const activityStep = (churn: number) => (churn === 0 ? 0 : Math.max(1, Math.ceil((Math.log1p(churn) / Math.log1p(most)) * 4)));
  const bounds = [1, 2, 3, 4].map((s) => Math.round(Math.expm1((Math.log1p(most) * s) / 4)));
  const ageStep = (last: number) => AGES.findIndex(([limit]) => (meta.anchor - last) / 86_400 < limit) + 1;
  const fill = (b: MapBlock) => {
    if (colour === "owner") return b.owner ? personColour(b.owner.colour) : "var(--empty)";
    if (colour === "age") return b.last_touched > 0 ? ramp("orange", ageStep(b.last_touched)) : "var(--empty)";
    const s = activityStep(b.churn);
    return s === 0 ? "var(--empty)" : ramp("blue", s);
  };
  const owners = new Map<number, NonNullable<MapBlock["owner"]>>();
  for (const d of wide) if (d.block.owner) owners.set(d.block.owner.id, d.block.owner);
  const coupled = file.data && !file.stale ? file.data.coupled : [];

  const crumbs = [{ name: "everything", path: "" }];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `${part}/`;
    crumbs.push({ name: part, path: at });
  }
  const tree = (drawn: Drawn[], size: { w: number; h: number }, className: string) => (
    <Treemap drawn={drawn} size={size} className={className} fill={fill} chosen={route.file ?? null} coupled={coupled} label={`The code at ${path || "the top"}, each block sized by its lines`} onPick={(b) => (b.file ? go({ file: b.path }, true) : open.folder(b.path))} />
  );
  return (
    <ScreenFrame stale={stale}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={14} className="flex-none text-secondary" aria-hidden />}
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="inline-flex items-center gap-1.5 truncate rounded-[var(--radius-element)] px-2 py-1 font-mono text-[0.82rem] font-semibold">
                  {i === 0 && <House size={14} aria-hidden />}
                  {c.name}
                </span>
              ) : (
                <button type="button" onClick={() => open.folder(c.path)} className="inline-flex cursor-pointer items-center gap-1.5 truncate rounded-[var(--radius-element)] border-0 bg-transparent px-2 py-1 font-mono text-[0.82rem] text-secondary transition-colors hover:bg-[var(--color-overlay-hover)] hover:text-primary">
                  {i === 0 && <House size={14} aria-hidden />}
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <SegmentedControl label="Colour by" size="sm" value={colour} onChange={(v) => setColour(v as Colour)}>
          {COLOURS.map(([value, label]) => (
            <SegmentedControlItem key={value} value={value} label={label} />
          ))}
        </SegmentedControl>
      </div>
      <div className={`grid items-start gap-4 ${route.file ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-container)] border border-line bg-surface p-3 sm:p-4">
          <MapLegend colour={colour} bounds={bounds} owners={[...owners.values()]} />
          {tree(wide, WIDE, "hidden md:block")}
          {tree(narrow, NARROW, "md:hidden")}
          <TableView
            head={["Path", "Lines", "Files", "Commits", "Last changed", "Most commits by"]}
            rows={level.children.map((b) => [b.path, b.lines, b.files, b.churn, b.last_touched > 0 ? date(b.last_touched) : "—", b.owner?.name ?? "—"])}
          />
        </div>
        {route.file && <FilePanel path={route.file} block={blockAt(level.children, route.file)} anchor={meta.anchor} file={file.data} error={file.error} onClose={() => go({ file: undefined }, true)} open={open} />}
      </div>
      <Explain>
        Each block is a folder or file at HEAD, sized by its lines of code; a folder's own contents are drawn inside it. Click a folder to open it, a file for its details and the files that change with it, drawn as lines. How often
        it changes is its commits in the Window; who changes it most is the person with the most of them.
      </Explain>
    </ScreenFrame>
  );
}

function Treemap({ drawn, size, className, fill, chosen, coupled, label, onPick }: { drawn: Drawn[]; size: { w: number; h: number }; className: string; fill: (b: MapBlock) => string; chosen: string | null; coupled: FileData["coupled"]; label: string; onPick: (b: MapBlock) => void }) {
  const tip = useTip();
  const from = chosen ? centre(drawn, chosen) : null;
  return (
    <svg viewBox={`0 0 ${size.w} ${size.h}`} className={`h-auto w-full overflow-visible ${className}`} role="group" aria-label={label}>
      {drawn.map((d) => {
        const b = d.block;
        const folder = !b.file && d.depth === 0 && b.inside.length > 0;
        const words = (
          <>
            <strong>{b.path}</strong>
            <div>
              {compact(b.lines)} lines{b.file ? "" : ` in ${many(b.files, "file", "files")}`}
            </div>
            <div>changed in {many(b.churn, "commit", "commits")}</div>
            {b.last_touched > 0 && <div>last changed {date(b.last_touched)}</div>}
            {b.owner && <div>most commits by {b.owner.name}</div>}
            <div className="note">{b.file ? "click for its details" : "click to open"}</div>
          </>
        );
        const picked = b.path === chosen;
        return (
          <g
            key={`${d.depth}${b.path}`}
            className="group cursor-pointer outline-none"
            onClick={(e) => {
              e.stopPropagation();
              onPick(b);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(b);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`${b.path}: ${b.file ? "details" : "open"}`}
            {...tip(words)}
          >
            <rect
              x={d.x + 1}
              y={d.y + 1}
              width={Math.max(0, d.w - 2)}
              height={Math.max(0, d.h - 2)}
              rx="3"
              fill={folder ? "var(--color-background-muted)" : fill(b)}
              stroke={picked ? "var(--color-text-primary)" : "var(--color-background-surface)"}
              strokeWidth={picked ? 2.5 : 1}
              className="transition-[stroke] group-hover:stroke-[var(--color-text-primary)] group-focus-visible:stroke-[var(--color-accent)]"
            />
            {d.w > 48 && d.h > 20 && (folder || d.depth === 1 || b.file || b.inside.length === 0) && (
              <Label x={d.x} y={d.y} text={fit(b.name + (b.file ? "" : "/"), d.w - 12)} />
            )}
          </g>
        );
      })}
      {from &&
        coupled.map((c) => {
          const to = centre(drawn, c.path);
          if (!to) return null;
          return (
            <g key={c.path} {...tip(<>{c.path}: changed together in {many(c.together, "commit", "commits")}, {Math.round(c.degree * 100)}% of those that change either</>)}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={1 + c.degree * 4} strokeLinecap="round" className="stroke-[var(--color-text-primary)] opacity-75" />
              <circle cx={to.x} cy={to.y} r="4" className="fill-[var(--color-text-primary)] stroke-[var(--color-background-surface)]" strokeWidth={2} />
            </g>
          );
        })}
      {from && <circle cx={from.x} cy={from.y} r="5" className="pointer-events-none fill-[var(--color-background-surface)] stroke-[var(--color-text-primary)]" strokeWidth={2.5} />}
    </svg>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g className="pointer-events-none">
      <rect x={x + 3} y={y + 3} width={text.length * 7 + 8} height={17} rx={4} className="fill-[var(--color-background-surface)] opacity-80" />
      <text x={x + 7} y={y + 15.5} className="fill-[var(--color-text-primary)] font-mono text-[11.5px]">
        {text}
      </text>
    </g>
  );
}

function fit(text: string, width: number): string {
  const n = Math.floor((width - 8) / 7);
  return text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`;
}

function Swatch({ fill, children }: { fill: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="inline-block size-3 flex-none rounded-[3px]" style={{ background: fill }} aria-hidden />
      {children}
    </li>
  );
}

function MapLegend({ colour, bounds, owners }: { colour: Colour; bounds: number[]; owners: NonNullable<MapBlock["owner"]>[] }) {
  const list = "m-0 flex min-h-5 list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-xs text-secondary";
  if (colour === "owner") {
    const shown = owners.filter((o) => o.colour !== null).sort((a, b) => (a.colour ?? 0) - (b.colour ?? 0));
    return (
      <ul className={list}>
        <li className="font-medium text-primary">Most commits by</li>
        {shown.map((o) => (
          <Swatch key={o.id} fill={personColour(o.colour)}>
            {o.name}
          </Swatch>
        ))}
        <Swatch fill="var(--other)">everyone else</Swatch>
      </ul>
    );
  }
  if (colour === "age") {
    return (
      <ul className={list}>
        <li className="font-medium text-primary">Last changed</li>
        {AGES.map(([, words], i) => (
          <Swatch key={words} fill={ramp("orange", i + 1)}>
            {words}
          </Swatch>
        ))}
      </ul>
    );
  }
  const most = bounds.at(-1) ?? 0;
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
      <span className="font-medium text-primary">How often it changes</span>
      <span className="flex items-center gap-1.5" aria-label={`From no commits to ${grouped(most)} commits in the Window, on a log scale`}>
        <span className="inline-block size-3 rounded-[3px] border border-line" style={{ background: "var(--empty)" }} aria-hidden />
        <span>none</span>
        <span className="ms-2 tnum">1</span>
        <span aria-hidden className="flex h-3 w-28 overflow-hidden rounded-[3px]">
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className="block h-full flex-1" style={{ background: ramp("blue", step) }} />
          ))}
        </span>
        <span className="tnum">{many(most, "commit", "commits")}</span>
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h4 className="m-0 text-xs font-semibold tracking-[0.04em] text-secondary uppercase">{title}</h4>
      {children}
    </section>
  );
}

function blockAt(children: MapBlock[], path: string): MapBlock | null {
  for (const b of children) {
    if (b.path === path) return b;
    const inside = b.inside.find((c) => c.path === path);
    if (inside) return inside;
  }
  return null;
}

function FilePanel({ path, block, file, error, onClose, open, anchor }: { path: string; block: MapBlock | null; anchor: number; file: FileData | null; error: string | null; onClose: () => void; open: ReturnType<typeof openers> }) {
  const missing = error === NOT_IN_REPORT;
  return (
    <aside className="fade flex min-w-0 flex-col gap-3 rounded-[var(--radius-container)] border border-line bg-surface p-4 lg:sticky lg:top-[120px] lg:max-h-[calc(100dvh-140px)] lg:overflow-auto" aria-label="The file chosen">
      <div className="flex items-start justify-between gap-2">
        <h3 className="m-0 min-w-0 font-mono text-[0.85rem] font-semibold break-all">{file?.path ?? path}</h3>
        <IconButton label="Close" tooltip="Close (Esc)" variant="ghost" size="sm" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </div>
      {missing && block && (
        <dl className="m-0 grid grid-cols-2 gap-3">
          {[
            ["Lines", grouped(block.lines)],
            ["Changed", many(block.churn, "time", "times")],
            ["Last changed", block.last_touched > 0 ? `${duration((anchor - block.last_touched) / 86_400)} ago` : "—"],
            ["Most commits by", block.owner?.name ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-xs text-secondary">{k}</dt>
              <dd className="m-0 truncate text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && <p className="m-0 text-sm text-pretty text-secondary">{missing ? "This Report keeps no more of a file than the Map shows: which files change with it, and its recent commits, are left out." : error}</p>}
      {!file && !error && <LinesSkeleton lines={8} />}
      {file && (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3">
            {[
              ["Lines", file.lines === null ? "gone from HEAD" : grouped(file.lines)],
              ["Changed", many(file.churn, "time", "times")],
              ["First seen", file.first_seen !== null ? date(file.first_seen) : "—"],
              ["Last changed", file.last_touched !== null ? `${duration((anchor - file.last_touched) / 86_400)} ago` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-xs text-secondary">{k}</dt>
                <dd className="m-0 text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {file.class && <p className="m-0 text-xs text-secondary">A {file.class} file</p>}
          <Section title="Who changes it">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
              {file.owners.slice(0, 6).map((o) => (
                <li key={o.person.id} className="flex items-center justify-between gap-2">
                  <Name p={o.person} onOpen={open.person} />
                  <span className="flex-none text-xs text-secondary tnum">{many(o.commits, "commit", "commits")}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Changes with">
            {file.coupled.length === 0 ? (
              <p className="m-0 text-sm text-secondary">No file changes with it often enough to say.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {file.coupled.map((c) => (
                  <li key={c.path} className="flex flex-col gap-0.5">
                    <button type="button" onClick={() => open.file(c.path)} className="cursor-pointer truncate border-0 bg-transparent p-0 text-start font-mono text-[0.8rem] text-primary underline-offset-[3px] hover:underline" title={c.path}>
                      {c.path}
                    </button>
                    <span className="text-xs text-secondary">
                      {Math.round(c.degree * 100)}% together, {many(c.together, "commit", "commits")}
                      {folderOf(c.path) !== folderOf(file.path) ? " · another folder" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Recent commits">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
              {file.commits.slice(0, 10).map((c) => (
                <li key={c.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
                  <code className="font-mono text-xs text-secondary">{c.id.slice(0, 8)}</code>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <Name p={c.person} />
                    <span className="flex-none text-xs text-secondary tnum">{day(Math.floor(c.time / 86_400))}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </aside>
  );
}
