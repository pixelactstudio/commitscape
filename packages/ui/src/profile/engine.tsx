import type { EngineRepo, EngineView } from "@commitscape/data";
import { Figure } from "../charts/common";
import { Face } from "../components/Face";
import { Tile } from "../components/Tile";
import { compact, grouped, many } from "../format";
import { survival } from "./survival";

const WORDS: Record<EngineRepo["surviving"]["status"], string> = {
  counting: "counting…",
  counted: "",
  over_budget: "not counted: too big to count in time",
  not_counted: "not counted: its history is read without old files",
  failed: "not counted: the count failed",
  stale: "counting…",
};


/** The headline Surviving Lines, across the repositories commitscape has read. */
export function SurvivingTile({ engine }: { engine: EngineView }) {
  const counted = engine.repos.filter((r) => r.surviving.status === "counted").length;
  if (engine.repos.length === 0) return <Tile value="—" label="lines that still run" note="no repository read here yet" />;
  if (engine.surviving === null) return <Tile value="counting…" label="lines that still run" note={`in ${many(engine.repos.length, "repository", "repositories")} read here`} />;
  const share = survival(engine.surviving, engine.added);
  return (
    <Tile
      value={compact(engine.surviving)}
      label="lines that still run"
      note={engine.counting > 0 ? `in ${grouped(counted)} of ${grouped(engine.repos.length)} read, counting…` : `${share ? `${share} of what they added, ` : ""}${many(counted, "repository", "repositories")}`}
    />
  );
}

/** Each repository commitscape has read that the person committed to: their Lines Changed and Surviving Lines from its history. */
export function EngineRepos({ engine, login }: { engine: EngineView; login: string }) {
  if (engine.repos.length === 0) return null;
  return (
    <Figure title="In the repositories commitscape has read" note="From each repository's own history, under every address they commit with: lines they changed, and the lines of theirs still at its head">
      <ol className="repo-list engine-list">
        <li className="repo-row engine-row repo-head-row note small" aria-hidden>
          <span />
          <span>Repository</span>
          <span className="num">commits</span>
          <span className="num hide-narrow">lines changed</span>
          <span className="num">still run</span>
          <span className="num hide-narrow">survival</span>
        </li>
        {engine.repos.map((r) => (
          <li key={`${r.owner}/${r.name}`} className="repo-row engine-row">
            <Face login={r.owner} name={r.owner} size={32} />
            <a className="repo-row-name" href={`/u/${login}/${r.owner}/${r.name}`}>
              <span className="note">{r.owner}/</span>
              {r.name}
            </a>
            <span className="num">{grouped(r.commits)}</span>
            <span className="num small hide-narrow">
              {r.linesAdded === null ? (
                <span className="note">—</span>
              ) : (
                <>
                  <span className="added">+{compact(r.linesAdded)}</span> <span className="removed">−{compact(r.linesRemoved ?? 0)}</span>
                </>
              )}
            </span>
            <span className="num">{r.surviving.status === "counted" && r.surviving.lines !== null ? grouped(r.surviving.lines) : <span className="note small">{WORDS[r.surviving.status]}</span>}</span>
            <span className="num hide-narrow">{survival(r.surviving.lines, r.surviving.added) ?? <span className="note">—</span>}</span>
          </li>
        ))}
      </ol>
    </Figure>
  );
}
