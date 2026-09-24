import { useEffect, useState } from "react";
import { api, listen } from "./api/client";
import type { Meta, Overview } from "./api/types";
import { compact, day, grouped, share } from "./format";

const WINDOW_WORDS: Record<string, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "all time",
};

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chosen, setWindow] = useState<string | null>(null);
  // The Window chosen, or the one the server opens on.
  const window = chosen ?? meta?.window ?? null;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => listen(setMeta), []);
  useEffect(() => {
    if (!window) return;
    api
      .overview(window)
      .then((o) => {
        setOverview(o);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [window, meta?.generation]);

  if (!meta) return <p className="waiting">Opening…</p>;
  return (
    <div className="app">
      <header>
        <h1>{meta.name}</h1>
        <nav aria-label="Window">
          {meta.windows.map((w) => (
            <button
              key={w}
              aria-pressed={w === window}
              onClick={() => setWindow(w)}
            >
              {WINDOW_WORDS[w] ?? w}
            </button>
          ))}
        </nav>
      </header>
      <Status meta={meta} />
      {error && <p className="error">{error}</p>}
      {overview && <OverviewView o={overview} />}
    </div>
  );
}

function Status({ meta }: { meta: Meta }) {
  const busy = [
    meta.history === "loading" && "reading the rest of history",
    meta.lines === "counting" && "counting lines",
    meta.github === "asking" && "asking GitHub",
  ].filter(Boolean);
  if (busy.length === 0) return null;
  return <p className="status">{busy.join(", ")}…</p>;
}

function OverviewView({ o }: { o: Overview }) {
  const t = o.totals;
  const tiles: [string, string][] = [
    [grouped(t.commits), "commits"],
    [grouped(t.people), "people"],
    [grouped(t.files), "files"],
    [compact(t.code_lines), "lines of code"],
    [grouped(o.active_days), `active days in ${WINDOW_WORDS[o.window] ?? o.window}`],
  ];
  const most = Math.max(1, ...o.days);
  const total = o.people.reduce((n, p) => n + p.commits, 0);
  return (
    <main>
      <section className="tiles">
        {tiles.map(([value, label]) => (
          <div className="tile" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <section>
        <h2>Commits over time</h2>
        <p className="note">
          {grouped(o.commits)} commits from {day(o.first_day)}, one bar a day
        </p>
        <svg
          className="columns"
          viewBox={`0 0 ${o.days.length} 100`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Commits per day, most ${most}`}
        >
          {o.days.map((n, i) => (
            <rect key={i} x={i + 0.1} width={0.8} y={100 - (n * 100) / most} height={(n * 100) / most}>
              <title>{`${day(o.first_day + i)}: ${n} commits`}</title>
            </rect>
          ))}
        </svg>
      </section>
      <section>
        <h2>Who writes the code</h2>
        <ol className="people">
          {o.people.slice(0, 10).map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <span>{grouped(p.commits)}</span>
              <span className="note">{share(p.commits, total)}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
