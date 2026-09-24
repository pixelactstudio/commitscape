import type { ReactNode } from "react";
import type { Fact, Overview as Data, TimelineMoment, Worth } from "../api/types";
import { useData } from "../api/useData";
import { Bars } from "../charts/Bars";
import { Columns } from "../charts/Columns";
import { Figure, TableView } from "../charts/common";
import { useWidth } from "../charts/scale";
import { useTip } from "../charts/tip";
import { Name, Path } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, duration, grouped, many, share, WINDOW_WORDS } from "../format";
import { personColour } from "../theme";
import { openers, type ScreenProps } from "./props";

export function Overview({ meta, params, go }: ScreenProps) {
  const { data: o, error, stale } = useData<Data>("/api/overview", params, meta.generation);
  const open = openers(go);
  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="waiting">Reading…</p>;
  const t = o.totals;
  const span = WINDOW_WORDS[o.window] ?? o.window;
  const releases = o.timeline.filter((m) => m.kind === "release");
  const total = o.people.reduce((n, p) => n + p.commits, 0);
  const age = t.first_commit !== null && t.last_commit !== null ? (t.last_commit - t.first_commit) / 86_400 : null;
  const tiles: [string, string, string, string][] = [
    [grouped(t.commits - t.merges), "commits", `${grouped(o.commits)} in ${span}`, "Every commit on every branch, merges left out; the small number is the commits in the Window."],
    [grouped(t.people), "people", `${grouped(o.people.length)} in ${span}`, "Everyone who made a commit, with the addresses of one person counted once. Bots are left out."],
    [grouped(t.files), "files", `${grouped(t.code_files)} are code`, "Files at HEAD, the newest commit on the current branch; code is what is not prose, generated, vendored or binary."],
    [compact(t.code_lines), "lines of code", `${compact(t.prose_lines)} of prose`, "Lines in code files at HEAD, blank lines left out. Prose is Markdown and other text."],
    [age === null ? "—" : duration(age), "old", t.first_commit === null ? "no commits" : `since ${date(t.first_commit)}`, "From the first commit to the newest."],
    [grouped(o.active_days), "active days", `in ${span}`, "Days in the Window with at least one commit, on each author's own clock."],
  ];
  return (
    <main className={stale ? "stale" : undefined}>
      <section className="tiles">
        {tiles.map(([value, label, note, why]) => (
          <div className="tile" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            <span className="note small">{note}</span>
            <Explain>{why}</Explain>
          </div>
        ))}
      </section>

      <Figure title="The story so far" note={`The project's life in ${span}, oldest on the left.`}>
        <Story moments={o.timeline} onPerson={open.person} from={o.first_day * 86_400} until={(o.first_day + o.days.length) * 86_400} />
        <Explain>
          Moments worth telling: the first commit, releases (version tags), someone who made at least a twentieth of the
          commits joining or leaving (their last commit over 90 days before the end), the busiest day, the biggest
          clean-up (the commit that removed the most lines net, lockfiles and generated files left out, once lines are
          counted), stretches of a month or more with no commit, and a change in the language most lines were added in.
        </Explain>
      </Figure>

      <div className="two">
        <Figure title="Commits over time" note={`${grouped(o.commits)} commits in ${span}`}>
          <Columns
            firstDay={o.first_day}
            series={[{ label: "Commits", colour: "var(--s1)", values: o.days }]}
            marks={releases.map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name ?? "release" }))}
          />
          <Explain>Commits that are not merges, by the day they landed on their author's clock. Dashed lines are releases.</Explain>
        </Figure>
        <Figure title="Who writes the code" note={`${many(o.people.length, "person", "people")} in ${span}`}>
          <Bars
            unit="commits"
            bars={o.people.slice(0, 10).map((p) => ({
              key: String(p.person.id),
              label: <Name p={p.person} />,
              value: p.commits,
              shown: `${grouped(p.commits)} · ${share(p.commits, total)}`,
              colour: personColour(p.person.colour),
              tip: <>{p.person.name}: {grouped(p.commits)} commits, {share(p.commits, total)} of them</>,
              onClick: () => open.person(p.person.id),
            }))}
          />
          <Explain>Commits that are not merges, and each person's share of them. Click a name for their profile.</Explain>
        </Figure>
      </div>

      <div className="two">
        <Figure title="Did you know?">
          <Facts facts={o.facts} onFile={open.file} />
          <Explain>Only what is unusual for a repository: each fact appears only when it clears a bar most repositories fall short of.</Explain>
        </Figure>
        <Figure title="Worth a look">
          <WorthList worth={o.worth} open={open} />
          <Explain>
            A folder one person made most commits to, the file that is both changed most and most deeply nested, two files
            in different folders that change together, files nobody has changed in a year, and names that may be one
            person.
          </Explain>
        </Figure>
      </div>

      <div className="two">
        <Figure title="Languages" note="Lines of code at HEAD">
          {o.languages.length === 0 ? (
            <p className="note">No code at HEAD in a language this tool knows.</p>
          ) : (
            <Bars
              unit="lines"
              bars={o.languages.slice(0, 8).map((l) => ({
                key: l.name,
                label: l.name,
                value: l.lines,
                shown: `${compact(l.lines)} · ${share(l.lines, t.code_lines)}`,
              }))}
            />
          )}
        </Figure>
        <Figure title="Code age" note="Lines of code at HEAD, by the year their file first appeared">
          <CodeAge o={o} />
          <Explain>How much of today's code sits in files that appeared each year: old code that is still here, and how fast new code arrives.</Explain>
        </Figure>
      </div>
    </main>
  );
}

const SHAPES: Record<string, string> = {
  first_commit: "●",
  release: "▲",
  joined: "+",
  left: "−",
  busiest_day: "★",
  cleanup: "✂",
  quiet: "…",
  language_shift: "⇄",
};

/** A moment in words, with `who` for the person in it. */
function momentWords(m: TimelineMoment, who: ReactNode = m.person?.name ?? "someone"): ReactNode {
  switch (m.kind) {
    case "first_commit":
      return <>The first commit, by {who}</>;
    case "release":
      return `Released ${m.name ?? ""}`;
    case "joined":
      return <>{who} made their first commit</>;
    case "left":
      return <>{who}'s last commit so far</>;
    case "busiest_day":
      return `The busiest day: ${many(m.count ?? 0, "commit", "commits")}`;
    case "cleanup":
      return <>The biggest clean-up: {grouped(m.count ?? 0)} lines removed, by {who}</>;
    case "quiet":
      return `Quiet for ${duration(((m.until ?? m.time) - m.time) / 86_400)}`;
    case "language_shift":
      return `Most new lines were ${m.to ?? "?"}, no longer ${m.from ?? "?"}`;
    default:
      return m.kind;
  }
}

function Story({
  moments,
  onPerson,
  from,
  until,
}: {
  moments: TimelineMoment[];
  onPerson: (id: number) => void;
  /** Where the line starts and ends: the Window's first and last day. */
  from: number;
  until: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  if (moments.length === 0) return <p className="note">Nothing in this window stands out from the rest.</p>;
  const start = Math.min(from, ...moments.map((m) => m.time));
  const end = Math.max(until, start + 1, ...moments.map((m) => m.until ?? m.time));
  const x = (t: number) => 12 + ((t - start) / (end - start)) * Math.max(1, width - 24);
  const releases = moments.filter((m) => m.kind === "release");
  const told = moments.filter((m) => m.kind !== "release");
  // Releases are many in some repositories: the list names the first and
  // the last, and how many there were, and the line shows each.
  const words = [...told];
  if (releases.length > 0) {
    words.push(releases[0] as TimelineMoment);
    if (releases.length > 1) words.push(releases.at(-1) as TimelineMoment);
    words.sort((a, b) => a.time - b.time);
  }
  return (
    <div className="story" ref={ref}>
      {width > 0 && (
        <svg width={width} height={46} role="img" aria-label="The project's life on a line">
          <line className="story-line" x1={12} x2={width - 12} y1={30} y2={30} />
          {moments
            .filter((m) => m.kind === "quiet")
            .map((m) => (
              <rect
                key={`q${m.time}`}
                className="quiet"
                x={x(m.time)}
                width={Math.max(2, x(m.until ?? m.time) - x(m.time))}
                y={25}
                height={10}
                {...tip(<>{momentWords(m)}, from {date(m.time)} to {date(m.until ?? m.time)}</>)}
              />
            ))}
          {moments
            .filter((m) => m.kind !== "quiet")
            .map((m, i) => (
              <g key={`${m.kind}${m.time}${i}`} {...tip(<><strong>{date(m.time)}</strong><div>{momentWords(m)}</div></>)}>
                <rect className="hit" x={x(m.time) - 6} y={4} width={12} height={40} />
                <text
                  className={`moment ${m.kind}`}
                  x={x(m.time)}
                  y={m.kind === "release" ? 34 : 18}
                  textAnchor="middle"
                  fill={m.person ? personColour(m.person.colour) : undefined}
                >
                  {SHAPES[m.kind] ?? "•"}
                </text>
              </g>
            ))}
        </svg>
      )}
      <ol className="moments">
        {words.map((m, i) => (
          <li key={`${m.kind}${m.time}${i}`}>
            <span className="glyph" aria-hidden>
              {SHAPES[m.kind]}
            </span>
            <span className="when">{date(m.time)}</span>
            <span>{momentWords(m, m.person ? <Name p={m.person} onOpen={onPerson} /> : "someone")}</span>
          </li>
        ))}
        {releases.length > 2 && (
          <li className="note">
            <span className="glyph" aria-hidden>
              ▲
            </span>
            <span className="when" />
            <span>{many(releases.length, "release", "releases")} in all, each a ▲ on the line</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function Facts({ facts, onFile }: { facts: Fact[]; onFile: (path: string) => void }) {
  if (facts.length === 0) {
    return <p className="note">Nothing unusual stands out in this window: no late nights, no marathons, no giant files.</p>;
  }
  const line = (f: Fact) => {
    switch (f.kind) {
      case "night":
        return <><strong>Night owls:</strong> {f.value}% of commits land between 22:00 and 05:00.</>;
      case "weekend":
        return <><strong>Weekend warriors:</strong> {f.value}% of commits land on a Saturday or Sunday.</>;
      case "busiest_day":
        return (
          <>
            The busiest day, <strong>{f.time !== null ? date(f.time) : "?"}</strong>, had {grouped(f.value)} commits,{" "}
            {Math.round(f.value / Math.max(0.1, f.other ?? 1))} times a usual day.
          </>
        );
      case "streak":
        return (
          <>
            A streak of <strong>{grouped(f.value)} days</strong> in a row with commits
            {f.time !== null && <>, from {date(f.time)}</>}.
          </>
        );
      case "fixes":
        return <>Twice as many fixes as features: <strong>{grouped(f.value)}</strong> to {grouped(f.other ?? 0)}.</>;
      case "hottest_file":
        return (
          <>
            <Path path={f.subject ?? ""} onOpen={onFile} /> changed in <strong>{share(f.value, f.other ?? 0)}</strong> of all commits.
          </>
        );
      case "biggest_file":
        return (
          <>
            The biggest file, <Path path={f.subject ?? ""} onOpen={onFile} />, has <strong>{grouped(f.value)}</strong> lines.
          </>
        );
      case "untouched":
        return (
          <>
            <Path path={f.subject ?? ""} onOpen={onFile} /> has not been touched in <strong>{duration(f.value)}</strong>.
          </>
        );
      default:
        return f.kind;
    }
  };
  return (
    <ul className="facts">
      {facts.map((f) => (
        <li key={f.kind}>{line(f)}</li>
      ))}
    </ul>
  );
}

function WorthList({ worth, open }: { worth: Worth[]; open: ReturnType<typeof openers> }) {
  const folder = (p: string) => (p === "(root)" ? "" : p);
  const line = (w: Worth) => {
    switch (w.kind) {
      case "held":
        return (
          <>
            <Path path={w.paths[0] ?? ""} onOpen={(p) => open.folder(folder(p))} />: {w.value}% of commits by{" "}
            <Name p={w.person} onOpen={open.person} />
            {w.of !== null && <span className="note"> ({many(w.of, "commit", "commits")})</span>}
          </>
        );
      case "hotspot":
        return (
          <>
            Hottest file: <Path path={w.paths[0] ?? ""} onOpen={open.file} />
            <span className="note">, changed {many(w.value, "time", "times")}</span>
          </>
        );
      case "pair":
        return (
          <>
            <Path path={w.paths[0] ?? ""} onOpen={open.file} /> and <Path path={w.paths[1] ?? ""} onOpen={open.file} /> change
            together <span className="note">({w.value}% of the commits that change either)</span>
          </>
        );
      case "untouched":
        return (
          <>
            {grouped(w.value)} of {many(w.of ?? 0, "file", "files")} untouched for a year
          </>
        );
      case "same_person":
        return (
          <>
            {w.value === 1 ? "A pair of names may be one person" : `${grouped(w.value)} groups of names may be one person each`}:
            see People
          </>
        );
      default:
        return w.kind;
    }
  };
  const marks: Record<string, string> = { held: "▲", hotspot: "◆", pair: "⇄", untouched: "○", same_person: "●" };
  return (
    <ul className="worth">
      {worth.filter((w) => w.kind !== "untouched" || w.value > 0).map((w, i) => (
        <li key={`${w.kind}${i}`}>
          <span className="glyph" aria-hidden>
            {marks[w.kind]}
          </span>
          <span>{line(w)}</span>
        </li>
      ))}
    </ul>
  );
}

function CodeAge({ o }: { o: Data }) {
  const years = new Map<number, number>();
  for (const q of o.code_age) years.set(q.year, (years.get(q.year) ?? 0) + q.lines);
  const rows = [...years.entries()].sort((a, b) => a[0] - b[0]);
  if (rows.length === 0) return <p className="note">There is no code at HEAD.</p>;
  const all = rows.reduce((n, [, l]) => n + l, 0);
  return (
    <>
      <Bars
        unit="lines"
        bars={rows.map(([year, lines]) => ({
          key: String(year),
          label: String(year),
          value: lines,
          shown: `${compact(lines)} · ${share(lines, all)}`,
        }))}
      />
      <TableView
        caption="Show by quarter"
        head={["Quarter", "Lines"]}
        rows={o.code_age.map((q) => [`${q.year} Q${q.quarter}`, q.lines])}
      />
    </>
  );
}

