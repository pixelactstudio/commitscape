import { useState } from "react";
import type { File as FileData, MapBlock, MapLevel } from "../api/types";
import { useData } from "../api/useData";
import { TableView } from "../charts/common";
import { ranges, useWidth } from "../charts/scale";
import { useTip } from "../charts/tip";
import { squarify, type Rect } from "../charts/treemap";
import { Name } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, day, duration, grouped, many } from "../format";
import { personColour, ramp } from "../theme";
import { folderOf, openers, type ScreenProps } from "./props";

type Colour = "activity" | "age" | "owner";
const COLOURS: [Colour, string][] = [
  ["activity", "How often it changes"],
  ["age", "When it last changed"],
  ["owner", "Who changes it most"],
];

const HEIGHT = 540;
const HEADER = 16;

type Drawn = Rect & { block: MapBlock; depth: number };

const AGES = [
  [30, "under a month"],
  [90, "under 3 months"],
  [365, "under a year"],
  [Infinity, "a year or more"],
] as const;

export function MapScreen({ meta, params, route, go }: ScreenProps) {
  const path = route.path ?? "";
  const { data: level, error, stale } = useData<MapLevel>("/api/map", { ...params, path }, meta.generation);
  const file = useData<FileData>(route.file ? "/api/file" : null, { ...params, path: route.file }, meta.generation);
  const [colour, setColour] = useState<Colour>("activity");
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const open = openers(go);
  if (error) return <p className="error">{error}</p>;
  if (!level) return <p className="waiting">Reading…</p>;

  // Lay out the level, and each folder's own children inside it.
  const drawn: Drawn[] = [];
  for (const r of squarify(level.children, (b) => b.lines, { x: 0, y: 0, w: width, h: HEIGHT })) {
    drawn.push({ ...r, block: r.item, depth: 0 });
    if (!r.item.file && r.item.inside.length > 0 && r.w > 30 && r.h > HEADER + 12) {
      const inner = { x: r.x + 2, y: r.y + HEADER, w: r.w - 4, h: r.h - HEADER - 2 };
      for (const c of squarify(r.item.inside, (b) => b.lines, inner)) drawn.push({ ...c, block: c.item, depth: 1 });
    }
  }
  const churns = drawn.filter((d) => d.depth === 1 || d.block.file || d.block.inside.length === 0).map((d) => d.block.churn);
  const most = Math.max(1, ...churns);
  const activityStep = (churn: number) => (churn === 0 ? 0 : Math.max(1, Math.ceil((Math.log1p(churn) / Math.log1p(most)) * 4)));
  const bounds = [1, 2, 3, 4].map((s) => Math.round(Math.expm1((Math.log1p(most) * s) / 4)));
  const ageStep = (last: number) => {
    const days = (meta.anchor - last) / 86_400;
    return AGES.findIndex(([limit]) => days < limit) + 1;
  };
  const fill = (b: MapBlock) => {
    if (colour === "owner") return b.owner ? personColour(b.owner.colour) : "var(--empty)";
    if (colour === "age") return b.last_touched > 0 ? ramp("orange", ageStep(b.last_touched)) : "var(--empty)";
    const s = activityStep(b.churn);
    return s === 0 ? "var(--empty)" : ramp("blue", s);
  };
  const owners = new Map<number, MapBlock["owner"]>();
  for (const d of drawn) if (d.block.owner) owners.set(d.block.owner.id, d.block.owner);

  // Where each coupled file is drawn: itself, or the folder it is in.
  const centre = (p: string) => {
    let best: Drawn | undefined;
    for (const d of drawn) {
      const b = d.block;
      if (b.path === p || (!b.file && p.startsWith(b.path))) {
        if (!best || b.path.length > best.block.path.length) best = d;
      }
    }
    return best ? { x: best.x + best.w / 2, y: best.y + best.h / 2 } : null;
  };
  const chosen = route.file ? centre(route.file) : null;
  const coupled = file.data && !file.stale ? file.data.coupled : [];

  const crumbs = [{ name: "everything", path: "" }];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `${part}/`;
    crumbs.push({ name: part, path: at });
  }
  return (
    <main className={stale ? "stale" : undefined}>
      <div className="map-bar">
        <nav className="crumbs" aria-label="Folder">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && " / "}
              {i === crumbs.length - 1 ? (
                <strong>{c.name}</strong>
              ) : (
                <button type="button" className="link" onClick={() => open.folder(c.path)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <label>
          Colour by{" "}
          <select value={colour} onChange={(e) => setColour(e.target.value as Colour)}>
            {COLOURS.map(([k, words]) => (
              <option key={k} value={k}>
                {words}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MapLegend colour={colour} bounds={bounds} owners={[...owners.values()]} />
      <div className="map-and-file">
        <div className="treemap" ref={ref}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label={`The code at ${path || "the top"}, each block sized by its lines`}>
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
                return (
                  <g
                    key={`${d.depth}${b.path}`}
                    className={`block${b.path === route.file ? " chosen" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (b.file) go({ file: b.path }, true);
                      else open.folder(b.path);
                    }}
                    {...tip(words)}
                  >
                    <rect
                      x={d.x + 1}
                      y={d.y + 1}
                      width={Math.max(0, d.w - 2)}
                      height={Math.max(0, d.h - 2)}
                      rx="2"
                      fill={folder ? "var(--surface-2)" : fill(b)}
                    />
                    {d.w > 44 && d.h > 14 && (folder || d.depth === 1 || b.file || b.inside.length === 0) && (
                      <text x={d.x + 5} y={d.y + 12} className="block-label">
                        {fit(b.name + (b.file ? "" : "/"), d.w - 8)}
                      </text>
                    )}
                  </g>
                );
              })}
              {chosen &&
                coupled.map((c) => {
                  const to = centre(c.path);
                  if (!to) return null;
                  return (
                    <g key={c.path} className="coupling" {...tip(<>{c.path}: changed together in {many(c.together, "commit", "commits")}, {Math.round(c.degree * 100)}% of those that change either</>)}>
                      <line x1={chosen.x} y1={chosen.y} x2={to.x} y2={to.y} strokeWidth={1 + c.degree * 4} />
                      <circle cx={to.x} cy={to.y} r="4" />
                    </g>
                  );
                })}
              {chosen && <circle className="chosen-dot" cx={chosen.x} cy={chosen.y} r="5" />}
            </svg>
          )}
        </div>
        {route.file && <FilePanel anchor={meta.anchor} file={file.data} error={file.error} onClose={() => go({ file: undefined }, true)} open={open} />}
      </div>
      <Explain>
        Each block is a folder or file at HEAD, sized by its lines of code; a folder's own contents are drawn inside it. Click
        a folder to open it, a file for its details and the files that change with it, drawn as lines. How often it changes
        is its commits in the Window; who changes it most is the person with the most of them.
      </Explain>
      <TableView
        head={["Path", "Lines", "Files", "Commits", "Last changed", "Most commits by"]}
        rows={level.children.map((b) => [
          b.path,
          b.lines,
          b.files,
          b.churn,
          b.last_touched > 0 ? date(b.last_touched) : "—",
          b.owner?.name ?? "—",
        ])}
      />
    </main>
  );
}

/** A label cut to fit a width, at about 6.5 pixels a character. */
function fit(text: string, width: number): string {
  const n = Math.floor(width / 6.5);
  return text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`;
}

function MapLegend({ colour, bounds, owners }: { colour: Colour; bounds: number[]; owners: MapBlock["owner"][] }) {
  const swatch = (fill: string) => (
    <svg width="12" height="12" aria-hidden>
      <rect width="12" height="12" rx="2" fill={fill} />
    </svg>
  );
  if (colour === "owner") {
    const shown = owners.filter((o) => o && o.colour !== null).sort((a, b) => (a?.colour ?? 0) - (b?.colour ?? 0));
    return (
      <ul className="legend">
        {shown.map((o) => o && <li key={o.id}>{swatch(personColour(o.colour))}{o.name}</li>)}
        <li>{swatch("var(--other)")}everyone else</li>
      </ul>
    );
  }
  if (colour === "age") {
    return (
      <ul className="legend">
        <li className="note">Last changed:</li>
        {AGES.map(([, words], i) => (
          <li key={words}>
            {swatch(ramp("orange", i + 1))}
            {words}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="legend">
      <li className="note">Commits in the Window:</li>
      <li>{swatch("var(--empty)")}none</li>
      {ranges(bounds).map((r) => (
        <li key={r.step}>
          {swatch(ramp("blue", r.step))}
          {r.from === r.to ? grouped(r.to) : `${grouped(r.from)}–${grouped(r.to)}`}
        </li>
      ))}
    </ul>
  );
}

function FilePanel({
  file,
  error,
  onClose,
  open,
  anchor,
}: {
  anchor: number;
  file: FileData | null;
  error: string | null;
  onClose: () => void;
  open: ReturnType<typeof openers>;
}) {
  return (
    <aside className="file-panel">
      <button type="button" className="link close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {error && <p className="error">{error}</p>}
      {!file && !error && <p className="waiting">Reading…</p>}
      {file && (
        <>
          <h3>
            <code>{file.path}</code>
          </h3>
          <dl>
            <dt>Lines</dt>
            <dd>{file.lines === null ? "no longer at HEAD" : grouped(file.lines)}</dd>
            {file.class && (
              <>
                <dt>Kind</dt>
                <dd>{file.class}</dd>
              </>
            )}
            <dt>Changed</dt>
            <dd>{many(file.churn, "time", "times")} in the Window</dd>
            {file.first_seen !== null && (
              <>
                <dt>First seen</dt>
                <dd>{date(file.first_seen)}</dd>
              </>
            )}
            {file.last_touched !== null && (
              <>
                <dt>Last changed</dt>
                <dd>
                  {date(file.last_touched)} ({duration((anchor - file.last_touched) / 86_400)} ago)
                </dd>
              </>
            )}
          </dl>
          <h4>Who changes it</h4>
          <ul className="facts">
            {file.owners.slice(0, 6).map((o) => (
              <li key={o.person.id}>
                <Name p={o.person} onOpen={open.person} /> <span className="note">{many(o.commits, "commit", "commits")}</span>
              </li>
            ))}
          </ul>
          <h4>Changes with</h4>
          {file.coupled.length === 0 ? (
            <p className="note">No file changes with it often enough to say.</p>
          ) : (
            <ul className="facts">
              {file.coupled.map((c) => (
                <li key={c.path}>
                  <button type="button" className="path link" onClick={() => open.file(c.path)}>
                    {c.path}
                  </button>{" "}
                  <span className="note">
                    {Math.round(c.degree * 100)}%, {many(c.together, "commit", "commits")}
                  </span>
                  {folderOf(c.path) !== folderOf(file.path) && <span className="note"> · another folder</span>}
                </li>
              ))}
            </ul>
          )}
          <h4>Recent commits</h4>
          <ul className="facts commits">
            {file.commits.slice(0, 10).map((c) => (
              <li key={c.id}>
                <code>{c.id.slice(0, 8)}</code> {day(Math.floor(c.time / 86_400))} <Name p={c.person} />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
