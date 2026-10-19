import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { ChevronLeft, ChevronRight, ExternalLink, FileCode, House, X } from "lucide-react";
import { NOT_IN_REPORT, type File as FileData, type MapBlock, type MapLevel } from "@commitscape/data";
import { TableView } from "../charts/common";
import { useFocusOnChange } from "../components/focus";
import { LinesSkeleton } from "../components/Loading";
import { Name } from "../components/Name";
import { useData, useLazyData } from "../data";
import { heat, ICON } from "../design/tokens";
import { Explain } from "../explain";
import { useGitOptional } from "../git/source";
import { date, day, duration, grouped, many } from "../format";
import { activityScale, cellsOf, NARROW, WIDE, type Scale } from "../reading/cells";
import { Treemap } from "../reading/treemap";
import { personColour, ramp } from "../theme";
import { Failed, ScreenFrame } from "./kit";
import { useReload } from "./reload";
import { folderOf, openers, type ScreenProps } from "./props";

export { NARROW, WIDE };

type Colour = "activity" | "age" | "owner";

const COLOURS: [Colour, string][] = [
  ["activity", "How often"],
  ["age", "When last"],
  ["owner", "Who"],
];

const AGES = [
  [30, "under a month"],
  [90, "under 3 months"],
  [365, "under a year"],
  [Infinity, "a year or more"],
] as const;

/** The code at HEAD as nested blocks sized by lines, coloured by how often, when or by whom it changes; entered a folder at a time, a file opening its details and the files that change with it. */
export function MapScreen({ meta, params, route, go }: ScreenProps) {
  const path = route.path ?? "";
  const { data: level, error, stale } = useData<MapLevel>("/api/map", { ...params, path });
  const file = useLazyData<FileData>(route.file ? "/api/file" : null, { ...params, path: route.file });
  const reload = useReload();
  const git = useGitOptional();
  const [colour, setColour] = useState<Colour>("activity");
  const open = openers(go, route);
  useFocusOnChange(level?.path ?? null, () => document.querySelector<HTMLElement>("[data-cell][tabindex='0']"));
  if (error || !level) {
    const up = path.split("/").filter(Boolean).slice(0, -1);
    const missing = error === NOT_IN_REPORT;
    return (
      <Failed
        words={missing ? `The Report keeps the Map at the top and inside each top folder, not inside ${path}. Open its files from the folder above.` : error}
        retry={missing ? undefined : reload}
        action={path ? <Button label={up.length > 0 ? `Back to ${up.join("/")}/` : "Back to the top"} variant="secondary" size="sm" icon={<Icon icon={ChevronLeft} size="sm" />} onClick={() => open.folder(up.length > 0 ? `${up.join("/")}/` : "")} /> : undefined}
      />
    );
  }
  const wide = cellsOf(level.children, WIDE.w, WIDE.h);
  const narrow = cellsOf(level.children, NARROW.w, NARROW.h);
  const leaves = wide.filter((c) => c.role === "leaf");
  const most = Math.max(1, ...leaves.map((c) => c.block.churn));
  const scale = activityScale(most);
  const ageStep = (last: number) => 5 - (AGES.findIndex(([limit]) => (meta.anchor - last) / 86_400 < limit) + 1);
  const fill = (b: MapBlock) => {
    if (colour === "owner") return b.owner ? personColour(b.owner.colour) : "var(--empty)";
    if (colour === "age") return b.last_touched > 0 ? ramp("orange", ageStep(b.last_touched)) : "var(--empty)";
    return heat(scale.step(b.churn), "area");
  };
  const owners = new Map<number, NonNullable<MapBlock["owner"]>>();
  for (const c of leaves) if (c.block.owner) owners.set(c.block.owner.id, c.block.owner);
  const coupled = file.data && !file.stale ? file.data.coupled : [];
  const crumbs = [{ name: "Top level", path: "" }];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `${part}/`;
    crumbs.push({ name: part, path: at });
  }
  const pick = (b: MapBlock) => (b.file ? go({ file: b.path }, true) : open.folder(b.path));
  const label = `The code at ${path || "the top"}, each block sized by its lines`;
  return (
    <ScreenFrame stale={stale}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-0.5">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={ICON.sm} className="flex-none text-secondary" aria-hidden />}
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className={`inline-flex h-8 items-center gap-1.5 truncate rounded-md px-2 type-caption font-semibold text-primary ${i === 0 ? "" : "mono"}`}>
                  {i === 0 && <House size={ICON.sm} aria-hidden />}
                  {c.name}
                </span>
              ) : (
                <button type="button" onClick={() => open.folder(c.path)} className={`plain-button row-hover inline-flex h-8 items-center gap-1.5 truncate rounded-md px-2 type-caption text-secondary hover:text-primary ${i === 0 ? "" : "mono"}`}>
                  {i === 0 && <House size={ICON.sm} aria-hidden />}
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <SegmentedControl label="Colour by" size="md" value={colour} onChange={(v) => setColour(v as Colour)}>
          {COLOURS.map(([value, words]) => (
            <SegmentedControlItem key={value} value={value} label={words} />
          ))}
        </SegmentedControl>
      </div>
      <div className={`grid items-start gap-4 ${route.file ? "@min-[60rem]:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3 surface p-3 sm:p-panel">
          <MapLegend colour={colour} scale={scale} owners={[...owners.values()]} />
          <Treemap cells={wide} size={WIDE} className="hidden md:block" fill={fill} chosen={route.file ?? null} coupled={coupled} label={label} onPick={pick} />
          <Treemap cells={narrow} size={NARROW} className="md:hidden" fill={fill} chosen={route.file ?? null} coupled={coupled} label={label} onPick={pick} />
          <TableView
            title={label}
            head={["Path", "Lines", "Files", "Commits", "Last changed", "Most commits by"]}
            rows={level.children.map((b) => [
              <button key={b.path} type="button" onClick={() => pick(b)} className="plain-button inline-link hit mono inline-flex min-h-6 items-center type-caption">
                {b.path}
              </button>,
              b.lines,
              b.files,
              b.churn,
              b.last_touched > 0 ? date(b.last_touched) : "—",
              b.owner?.name ?? "—",
            ])}
          />
        </div>
        {route.file && <FilePanel path={route.file} block={blockAt(level.children, route.file)} anchor={meta.anchor} file={file.data} error={file.error} onClose={() => go({ file: undefined }, true)} open={open} github={git?.github ?? null} head={git?.status.head ?? null} />}
      </div>
      <Explain>
        Each block is a folder or file at HEAD, sized by its lines of code; a folder’s own contents are drawn inside it. Press Enter or click on a folder to open it, a file for its details and the files that change with it, drawn as lines. How often it changes is its commits in the Window; who changes it most is the
        person with the most of them. The arrow keys move between blocks.
      </Explain>
    </ScreenFrame>
  );
}

function Swatch({ fill, outlined = false, children }: { fill: string; outlined?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`inline-block size-3 flex-none rounded-cell ${outlined ? "border border-line" : ""}`} style={{ background: fill }} aria-hidden />
      {children}
    </li>
  );
}

function MapLegend({ colour, scale, owners }: { colour: Colour; scale: Scale; owners: NonNullable<MapBlock["owner"]>[] }) {
  const list = "m-0 flex min-h-5 list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 type-micro";
  let key: ReactNode;
  if (colour === "owner") {
    const shown = owners.filter((o) => o.colour !== null).sort((a, b) => (a.colour ?? 0) - (b.colour ?? 0));
    key = (
      <ul className={list}>
        <li className="font-medium text-primary">Most commits by</li>
        {shown.map((o) => (
          <Swatch key={o.id} fill={personColour(o.colour)}>
            <bdi>{o.name}</bdi>
          </Swatch>
        ))}
        <Swatch fill="var(--empty)" outlined>everyone else</Swatch>
      </ul>
    );
  } else if (colour === "age") {
    key = (
      <ul className={list}>
        <li className="font-medium text-primary">Last changed</li>
        {AGES.map(([, words], i) => (
          <Swatch key={words} fill={ramp("orange", 4 - i)}>
            {words}
          </Swatch>
        ))}
      </ul>
    );
  } else {
    key = (
      <ul className={list} aria-label="Commits in the Window, in steps of a log scale">
        <li className="font-medium text-primary">How often it changes</li>
        <Swatch fill="var(--empty)" outlined>none</Swatch>
        {scale.ranges.map((r) => (
          <Swatch key={r.step} fill={heat(r.step, "area")}>
            <span className="tnum">{r.low === r.high ? grouped(r.low) : `${grouped(r.low)}–${grouped(r.high)}`}</span>
          </Swatch>
        ))}
        <li>commits</li>
      </ul>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
      {key}
      <span className="type-micro">Block size: lines of code at HEAD</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-separator pt-4">
      <h3 className="m-0 type-eyebrow">{title}</h3>
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

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className="type-caption">{k}</dt>
          <dd className="m-0 truncate type-ui font-medium tnum">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function FilePanel({ path, block, file, error, onClose, open, anchor, github, head }: { path: string; block: MapBlock | null; anchor: number; file: FileData | null; error: string | null; onClose: () => void; open: ReturnType<typeof openers>; github: string | null; head: string | null }) {
  const missing = error === NOT_IN_REPORT;
  const shown = file?.path ?? path;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, [path]);
  return (
    <aside ref={panel} className="fade flex min-w-0 scroll-mt-(--chrome-top) flex-col gap-4 surface p-panel @min-[60rem]:sticky @min-[60rem]:top-[calc(var(--chrome-top)+1rem)] @min-[60rem]:max-h-[calc(var(--main-height)-2rem)] @min-[60rem]:overflow-auto @min-[60rem]:overscroll-contain" aria-label="The file chosen">
      <div className="flex items-start justify-between gap-2">
        <h2 className="mono m-0 min-w-0 type-ui font-semibold break-all">{shown}</h2>
        <IconButton label="Close the file" tooltip="Close (Esc)" variant="ghost" size="sm" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button label="Open in Code" variant="secondary" size="sm" icon={<Icon icon={FileCode} size="sm" />} onClick={() => open.code(shown)} />
        {github && head && <Button label="GitHub" variant="ghost" size="sm" icon={<Icon icon={ExternalLink} size="sm" />} href={`${github}/blob/${head}/${shown}`} target="_blank" rel="noopener noreferrer" />}
      </div>
      {missing && block && (
        <Facts
          items={[
            ["Lines", grouped(block.lines)],
            ["Changed", many(block.churn, "time", "times")],
            ["Last changed", block.last_touched > 0 ? `${duration((anchor - block.last_touched) / 86_400)} ago` : "—"],
            ["Most commits by", block.owner?.name ?? "—"],
          ]}
        />
      )}
      {error && <p className="m-0 type-description">{missing ? "This Report keeps no more of a file than the Map shows: which files change with it, and its recent commits, are left out." : error}</p>}
      {!file && !error && <LinesSkeleton lines={8} />}
      {file && (
        <>
          <Facts
            items={[
              ["Lines", file.lines === null ? "gone from HEAD" : grouped(file.lines)],
              ["Changed", many(file.churn, "time", "times")],
              ["First seen", file.first_seen !== null ? date(file.first_seen) : "—"],
              ["Last changed", file.last_touched !== null ? `${duration((anchor - file.last_touched) / 86_400)} ago` : "—"],
            ]}
          />
          {file.class && <p className="m-0 type-caption">A {file.class} file</p>}
          <Section title="Who changes it">
            <ul className="m-0 flex list-none flex-col gap-2 p-0 type-ui">
              {file.owners.slice(0, 6).map((o) => (
                <li key={o.person.id} className="flex items-center justify-between gap-2">
                  <Name p={o.person} onOpen={open.person} />
                  <span className="flex-none type-caption tnum">{many(o.commits, "commit", "commits")}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Changes with">
            {file.coupled.length === 0 ? (
              <p className="m-0 type-description">No file changes with it often enough to say.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {file.coupled.map((c) => (
                  <li key={c.path} className="flex flex-col gap-0.5">
                    <button type="button" onClick={() => open.file(c.path)} className="plain-button hit mono min-h-6 w-fit max-w-full truncate type-caption text-primary hover:underline hover:decoration-line-strong hover:underline-offset-4" title={c.path}>
                      {c.path}
                    </button>
                    <span className="type-caption">
                      {Math.round(c.degree * 100)}% together, {many(c.together, "commit", "commits")}
                      {folderOf(c.path) !== folderOf(file.path) ? " · another folder" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Recent commits">
            <ul className="m-0 flex list-none flex-col gap-2 p-0 type-ui">
              {file.commits.slice(0, 10).map((c) => (
                <li key={c.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
                  {github ? (
                    <a href={`${github}/commit/${c.id}`} target="_blank" rel="noreferrer noopener" title="Open this commit on GitHub" className="mono type-caption text-secondary no-underline hover:text-primary hover:underline hover:underline-offset-4">
                      {c.id.slice(0, 7)}
                    </a>
                  ) : (
                    <code className="mono type-caption text-secondary">{c.id.slice(0, 7)}</code>
                  )}
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <Name p={c.person} />
                    <span className="flex-none type-caption tnum">{day(Math.floor(c.time / 86_400))}</span>
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

/** The Map while its level is fetched: the folder, the colour choice and the box the blocks fill. */
export function MapSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-8 items-center">
          <Skeleton height={14} width={140} radius={1} />
        </div>
        <Skeleton height={32} width={236} index={1} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 surface p-3 sm:p-panel">
        <div className="flex min-h-5 items-center">
          <Skeleton height={12} width={320} radius={1} />
        </div>
        <div className="hidden md:block" style={{ aspectRatio: `${WIDE.w} / ${WIDE.h}` }}>
          <Skeleton height="100%" index={2} />
        </div>
        <div className="md:hidden" style={{ aspectRatio: `${NARROW.w} / ${NARROW.h}` }}>
          <Skeleton height="100%" index={2} />
        </div>
        <div className="h-7" />
      </div>
    </ScreenFrame>
  );
}
