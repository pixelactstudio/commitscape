import { Button } from "@astryxdesign/core/Button";
import type { Overview as Data, People } from "@commitscape/data";
import { useData } from "../data";
import { Bars } from "../charts/Bars";
import { Columns } from "../charts/Columns";
import { Figure } from "../charts/common";
import { Name } from "../components/Name";
import { Tile } from "../components/Tile";
import { Explain } from "../explain";
import { compact, date, duration, grouped, many, share, WINDOW_WORDS } from "../format";
import { openers, type ScreenProps } from "./props";

export const CONTRIBUTORS_SHOWN = 10;

export function Overview({ params, go }: ScreenProps) {
  const { data: o, error, stale } = useData<Data>("/api/overview", params);
  const people = useData<People>("/api/people", params);
  const open = openers(go);
  if (error || !o) return <p className="error">{error}</p>;
  const t = o.totals;
  const span = WINDOW_WORDS[o.window] ?? o.window;
  const releases = o.timeline.filter((m) => m.kind === "release");
  const age = t.first_commit !== null && t.last_commit !== null ? (t.last_commit - t.first_commit) / 86_400 : null;
  const rows = people.data?.people ?? [];
  const lines = rows.some((r) => r.lines_added !== null);
  const tiles: [string, string, string, string][] = [
    [grouped(t.commits - t.merges), "commits", `${grouped(o.commits)} in ${span}`, "Every commit on every branch, merges left out; the small number is the commits in the Window."],
    [grouped(t.people), "people", `${grouped(o.people.length)} in ${span}`, "Everyone who made a commit, with the addresses of one person counted once. Bots are left out."],
    [grouped(t.files), "files", `${grouped(t.code_files)} of them code`, "Files at HEAD, the newest commit on the current branch; code is what is not prose, generated, vendored or binary."],
    [compact(t.code_lines), "lines of code", `and ${compact(t.prose_lines)} of prose`, "Lines in code files at HEAD, blank lines left out. Prose is Markdown and other text."],
    [age === null ? "—" : duration(age), "of history", t.first_commit === null ? "no commits" : `since ${date(t.first_commit)}`, "From the first commit to the newest."],
    [grouped(o.active_days), "active days", `in ${span}`, "Days in the Window with at least one commit, on each author's own clock."],
  ];
  return (
    <div className={stale ? "screen stale" : "screen"}>
      <section className="tiles">
        {tiles.map(([value, label, note, why]) => (
          <Tile key={label} value={value} label={label} note={note}>
            <Explain>{why}</Explain>
          </Tile>
        ))}
      </section>

      <Figure title="Commits over time" note={`${many(o.commits, "commit", "commits")} in ${span}, merges left out`}>
        <div className="overview-chart">
          <Columns firstDay={o.first_day} series={[{ label: "Commits", colour: "var(--s1)", values: o.days }]} marks={releases.map((r) => ({ day: Math.floor(r.time / 86_400), label: r.name ?? "release" }))} />
        </div>
        <Explain>Commits that are not merges, by the day they landed on their author's clock. Dashed lines are releases, drawn where they fit.</Explain>
      </Figure>

      <div className="two">
        <Figure title="Contributors" note={`${many(rows.length, "person", "people")} in ${span}, most commits first`}>
          <ol className="contributors">
            {rows.slice(0, CONTRIBUTORS_SHOWN).map((r) => (
              <li key={r.person.id}>
                <Name p={r.person} onOpen={open.person} />
                <span className="num">{many(r.commits, "commit", "commits")}</span>
                <span className="num note small">{share(r.commits, o.commits)}</span>
                {lines && (
                  <span className="num small lines-changed">
                    {r.lines_added === null ? (
                      "—"
                    ) : (
                      <>
                        <span className="added">+{compact(r.lines_added)}</span> <span className="removed">−{compact(r.lines_removed ?? 0)}</span>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {rows.length > CONTRIBUTORS_SHOWN && <Button label={`All ${many(rows.length, "person", "people")}`} variant="ghost" size="sm" onClick={() => go({ screen: "people", id: undefined })} />}
          <Explain>Commits that are not merges, each person's share of them, and the lines they added and removed (lockfiles and generated files left out). Click a name for what they did here.</Explain>
        </Figure>
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
                shown: `${compact(l.lines)} lines · ${share(l.lines, t.code_lines)}`,
              }))}
            />
          )}
        </Figure>
      </div>
    </div>
  );
}
