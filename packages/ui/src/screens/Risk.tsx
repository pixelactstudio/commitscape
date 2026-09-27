import { pixel, proportional, Table, type TableColumn } from "@astryxdesign/core/Table";
import type { HotspotRow, Risk as Data } from "@commitscape/data";
import { useData } from "../data";
import { Figure, TableView } from "../charts/common";
import { ticks, useWidth } from "../charts/scale";
import { useTip } from "../charts/tip";
import { Name, Path } from "../components/Name";
import { Explain } from "../explain";
import { compact, grouped, many, WINDOW_WORDS } from "../format";
import { openers, type ScreenProps } from "./props";

const HEIGHT = 340;
const LEFT = 58;
const BOTTOM = 34;
const TOP = 12;

export function Risk({ meta, params, go }: ScreenProps) {
  const { data: r, error, stale } = useData<Data>("/api/risk", params, meta.generation);
  const open = openers(go);
  if (error) return <p className="error">{error}</p>;
  if (!r) return <p className="waiting">Reading…</p>;
  const span = WINDOW_WORDS[r.window] ?? r.window;
  return (
    <div className={stale ? "screen stale" : "screen"}>
      <Figure
        title="Changed often, and hard to follow"
        note={`Each dot a file: how often it changed in ${span}, against how much of its code is nested, and how deeply. The top right is where a change is most likely to go wrong.`}
      >
        {r.files.length === 0 ? (
          <p className="note">No code file changed in this window.</p>
        ) : (
          <Scatter r={r} onFile={open.file} />
        )}
        <Explain>
          How often: commits that changed the file, bulk commits left out. Nesting: every line's indentation level at HEAD,
          added up, so a long file with deeply nested code scores highest. It is a cheap stand-in for how hard the code is
          to follow, the same in every language. A file ranks high only when it is high on both; neither alone is a
          problem. The shaded corner is the top quarter of both.
        </Explain>
      </Figure>

      <Figure title="Hotspots" note="Ranked by both at once">
        <div className="table-wrap">
          <Table<Hot> data={r.hotspots as Hot[]} columns={hotColumns(open.file)} idKey="path" density="compact" hasHover />
        </div>
      </Figure>

      <div className="two">
        <Figure title="Files that change together" note="Groups of files most often changed in the same commit">
          {r.groups.length === 0 ? (
            <p className="note">No files change together often enough to say.</p>
          ) : (
            <ol className="groups">
              {r.groups.map((g, i) => (
                <li key={i}>
                  {g.paths.map((p, j) => (
                    <span key={p}>
                      {j > 0 && <span className="note"> + </span>}
                      <Path path={p} onOpen={open.file} />
                    </span>
                  ))}
                  <span className="note">
                    {" "}
                    · together in {many(g.together, "commit", "commits")}
                    {g.cross_directory ? " · across folders" : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Explain>
            Files changed in the same commits again and again, bulk commits left out. Across folders is worth a look: the
            code may depend on each other in ways its layout does not show.
          </Explain>
        </Figure>
        <Figure title="Held by one person" note="Folders where one person made most commits">
          {r.silos.length === 0 ? (
            <p className="note">No folder depends on one person.</p>
          ) : (
            <ul className="facts">
              {r.silos.map((s) => (
                <li key={s.folder}>
                  <Path path={s.folder} onOpen={(f) => open.folder(f === "(root)" ? "" : f)} />: <Name p={s.holder} onOpen={open.person} />{" "}
                  <span className="note">of {many(s.commits, "commit", "commits")}</span>
                  <div className="note small">
                    {s.successor ? (
                      <>
                        next most: <Name p={s.successor.person} onOpen={open.person} /> with {grouped(s.successor.commits)}
                      </>
                    ) : (
                      "nobody else has changed it"
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Explain>If the person who holds a folder moved on, the next most would be the one who knows it best.</Explain>
        </Figure>
      </div>
    </div>
  );
}

type Hot = HotspotRow & Record<string, unknown>;

function hotColumns(onFile: (path: string) => void): TableColumn<Hot>[] {
  return [
    { key: "path", header: "File", width: proportional(3), renderCell: (h) => <Path path={h.path} onOpen={onFile} /> },
    { key: "churn", header: "Changed", align: "end", width: pixel(96), renderCell: (h) => <span className="num">{grouped(h.churn)}</span> },
    { key: "nesting", header: "Nesting", align: "end", width: pixel(96), renderCell: (h) => <span className="num">{grouped(h.nesting)}</span> },
    {
      key: "place",
      header: "Place by each",
      width: proportional(3),
      renderCell: (h) => (
        <span className="note">
          {ordinal(h.churn_place)} of {grouped(h.churn_of)} for changes, {ordinal(h.nesting_place)} of {grouped(h.nesting_of)} for nesting
        </span>
      ),
    },
  ];
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${grouped(n)}${s}`;
}

function Scatter({ r, onFile }: { r: Data; onFile: (path: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const maxC = Math.max(1, ...r.files.map((f) => f.churn));
  const maxN = Math.max(1, ...r.files.map((f) => f.nesting));
  // How often, on a square-root scale: a few files change far more than
  // the rest, and a straight scale would crowd everyone else at zero.
  const cTicks = ticks(maxC, 4);
  const nTicks = ticks(maxN, 4);
  const cTop = cTicks.at(-1) ?? maxC;
  const nTop = nTicks.at(-1) ?? maxN;
  const x = (c: number) => LEFT + Math.sqrt(c / cTop) * (width - LEFT - 12);
  const y = (n: number) => TOP + (1 - n / nTop) * (HEIGHT - TOP - BOTTOM);
  // The danger corner: the top quarter of both, by rank.
  const sortedC = r.files.map((f) => f.churn).sort((a, b) => a - b);
  const sortedN = r.files.map((f) => f.nesting).sort((a, b) => a - b);
  const q = (list: number[]) => list[Math.floor(list.length * 0.75)] ?? 0;
  const cornerC = q(sortedC);
  const cornerN = q(sortedN);
  const top = new Set(r.hotspots.slice(0, 5).map((h) => h.path));
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="Files by how often they change and how deeply they are nested">
          <rect className="danger" x={x(cornerC)} y={TOP} width={Math.max(0, width - 12 - x(cornerC))} height={Math.max(0, y(cornerN) - TOP)} />
          <text className="danger-label" x={width - 16} y={TOP + 14} textAnchor="end">
            changed often and heavily nested
          </text>
          <g className="axis">
            {nTicks.map((v) => (
              <g key={`n${v}`}>
                <line x1={LEFT} x2={width - 12} y1={y(v)} y2={y(v)} />
                <text x={LEFT - 6} y={y(v)} dy="0.32em" textAnchor="end">
                  {compact(v)}
                </text>
              </g>
            ))}
            {cTicks.map((v) => (
              <text key={`c${v}`} x={x(v)} y={HEIGHT - BOTTOM + 14} textAnchor="middle">
                {grouped(v)}
              </text>
            ))}
            <text x={(width + LEFT) / 2} y={HEIGHT - 4} textAnchor="middle">
              commits that changed it →
            </text>
            <text transform={`translate(10 ${(HEIGHT - BOTTOM) / 2}) rotate(-90)`} textAnchor="middle">
              nesting →
            </text>
          </g>
          {r.files.map((f) => (
            <g key={f.path} className="dot" onClick={() => onFile(f.path)} {...tip(<><strong>{f.path}</strong><div>changed in {many(f.churn, "commit", "commits")}</div><div>nesting {grouped(f.nesting)}</div></>)}>
              <circle className="hit" cx={x(f.churn)} cy={y(f.nesting)} r="9" />
              <circle cx={x(f.churn)} cy={y(f.nesting)} r="4" className={top.has(f.path) ? "top" : undefined} />
            </g>
          ))}
          {r.files
            .filter((f) => top.has(f.path))
            .map((f) => (
              <text key={`l${f.path}`} className="dot-label" x={x(f.churn) - 7} y={y(f.nesting) - 7} textAnchor="end">
                {f.path.split("/").at(-1)}
              </text>
            ))}
        </svg>
      )}
      <TableView head={["File", "Commits", "Nesting"]} rows={r.files.map((f) => [f.path, f.churn, f.nesting])} />
    </div>
  );
}
