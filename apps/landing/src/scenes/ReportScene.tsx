import { Face } from "@commitscape/ui/components/Face";
import { Chip } from "@commitscape/ui/kit/primitives";
import { Cursor, Mini, MiniHead } from "./parts";
import { HOLDERS, ROW } from "./report";

const NAV = ["Overview", "People", "Map", "Universe", "Code", "Branches", "Pull requests"] as const;

const BRANCHES = [
  { name: "feat/streaming-parser", state: "In flight", from: 0.55, to: 1, tone: "var(--brand)" },
  { name: "fix/utf8-boundary", state: "Waiting", from: 0.3, to: 0.62, tone: "var(--s4)" },
  { name: "chore/old-bench", state: "Abandoned", from: 0.05, to: 0.28, tone: "var(--other)" },
  { name: "release/2.0", state: "Merged", from: 0.4, to: 0.8, tone: "var(--s7)" },
];

const CODE = ["pub fn blame(path: &Path) -> Result<Lines> {", "    let history = log.follow(path)?;", "    let mut owners = Owners::new();", "    for commit in history.newest_first() {", "        owners.credit(commit.author, commit.lines());", "    }", "    Ok(owners.surviving())", "}"];

const CELLS = Array.from({ length: 40 }, (_, i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  const r = x - Math.floor(x);
  return { height: 28 + Math.round(r * 72), tone: i % 7 === 0 ? "var(--brand)" : i % 5 === 0 ? "var(--s1)" : i % 3 === 0 ? "var(--s7)" : "var(--s3)" };
});

const most = HOLDERS[0]?.lines ?? 1;

/** A repository's Report in five seconds: the cursor opens the Universe, a file in Code, the branches, then People again. */
export function ReportScene() {
  return (
    <div data-scene="report" className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-120 overflow-hidden">
        <MiniHead title="acme/engine" end={<Chip tone="brand">Report</Chip>} />
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)]">
          <ul className="relative m-0 flex list-none flex-col border-e border-line p-1.5">
            <span data-pill aria-hidden className="absolute start-1.5 end-1.5 top-1.5 rounded-md bg-sunken" style={{ height: ROW, transform: `translateY(${1 * ROW}px)` }} />
            {NAV.map((label, i) => (
              <li key={label} data-item data-on={i === 1 ? "" : undefined} className="relative flex items-center ps-2.5 type-caption data-[on]:font-medium data-[on]:text-primary" style={{ height: ROW }}>
                {label}
              </li>
            ))}
          </ul>
          <div className="relative h-60">
            <div data-pane className="absolute inset-0 flex flex-col gap-3 p-4">
              <span className="type-caption font-medium text-primary">Who holds the lines still running</span>
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {HOLDERS.map((h, i) => (
                  <li key={h.name} className="flex items-center gap-2.5">
                    <Face login={null} name={h.name} size={24} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between type-caption">
                        <span className="text-primary">{h.name}</span>
                        <span data-hnum className="tnum">
                          {Math.round(h.lines / 100) / 10}k
                        </span>
                      </div>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-sunken">
                        <span data-hbar className={`block h-full origin-left rounded-full ${i === 0 ? "bg-brand" : "bg-line-strong"}`} style={{ width: `${(h.lines / most) * 100}%` }} />
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div data-pane className="absolute inset-0 flex flex-col gap-3 p-4 opacity-0">
              <span className="type-caption font-medium text-primary">Every file it ever had, one cell each</span>
              <div className="grid flex-1 grid-cols-8 items-end gap-1">
                {CELLS.map((c, i) => (
                  <span key={i} data-cell className="block origin-bottom rounded-xs" style={{ height: `${c.height}%`, background: c.tone, opacity: 0.85 }} />
                ))}
              </div>
              <span className="type-micro">Height is commits so far; colour is who holds it.</span>
            </div>
            <div data-pane className="absolute inset-0 flex flex-col gap-2 p-4 opacity-0">
              <div className="flex items-center justify-between gap-2">
                <span className="mono type-caption font-medium text-primary">src/blame.rs</span>
                <span className="type-micro">born 2019 · 41 commits · 6 people</span>
              </div>
              <ol className="mono m-0 flex list-none flex-col gap-0.5 rounded-md bg-sunken p-2.5 type-micro">
                {CODE.map((line, i) => (
                  <li key={line} data-line className="flex gap-3 whitespace-pre text-primary">
                    <span className="w-3 flex-none text-end text-tertiary">{i + 1}</span>
                    {line}
                  </li>
                ))}
              </ol>
            </div>
            <div data-pane className="absolute inset-0 flex flex-col gap-3 p-4 opacity-0">
              <span className="type-caption font-medium text-primary">What is stuck, and what is safe to delete</span>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {BRANCHES.map((b) => (
                  <li key={b.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 type-micro">
                      <span className="mono truncate text-primary">{b.name}</span>
                      <span>{b.state}</span>
                    </div>
                    <span className="relative block h-1.5 rounded-full bg-sunken">
                      <span data-branch className="absolute inset-y-0 origin-left rounded-full" style={{ background: b.tone, insetInlineStart: `${b.from * 100}%`, insetInlineEnd: `${(1 - b.to) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Mini>
      <Cursor />
    </div>
  );
}
