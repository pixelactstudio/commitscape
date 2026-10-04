import { ARCHETYPES, type Achievement, type Archetype } from "@commitscape/data";
import { Figure } from "../charts/common";

/** A person's Archetype with the rule that gave it, every rule on request, and their Achievements, the next ones showing what reaches them. */
export function Traits({ archetypes, achievements, login, complete }: { archetypes: Archetype[]; achievements: Achievement[]; login: string; complete: boolean }) {
  const main = archetypes[0];
  const earned = achievements.filter((a) => a.earned);
  const next = achievements.filter((a) => !a.earned);
  return (
    <div className="two">
      <Figure title="Archetype" note="A label from a written rule over the numbers above; no guessing">
        <div className="archetype">
          <strong className="archetype-title">{main ? main.title : "Not decided yet"}</strong>
          <p>{main ? main.rule : "None of the rules fits yet. They need 50 contributions or more, and then each its own threshold."}</p>
          {archetypes.length > 1 && <p className="note small">Also: {archetypes.slice(1).map((a) => a.title).join(", ")}</p>}
          {!complete && <p className="note small">Some rules wait for the pull requests to be read.</p>}
        </div>
        <details className="table-view">
          <summary>Every rule, in the order they are tried</summary>
          <dl className="rules">
            {ARCHETYPES.map((a) => (
              <div key={a.id}>
                <dt>{a.title}</dt>
                <dd>{a.rule}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Figure>
      <Figure title="Achievements" note={`${earned.length} of ${achievements.length} reached`}>
        <ul className="achievements">
          {earned.map((a) => (
            <li key={a.id} className="achievement earned">
              <span className="medal" aria-hidden />
              <span>
                <strong>{a.title}</strong>
                <span className="note small">{[a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule}</span>
              </span>
              <a href={`/api/cards/u/${login}/achievement-${a.id}.png`} className="small">
                Card
              </a>
            </li>
          ))}
          {next.map((a) => (
            <li key={a.id} className="achievement">
              <span className="medal" aria-hidden />
              <span>
                <strong>{a.title}</strong>
                <span className="note small">{a.rule}</span>
              </span>
            </li>
          ))}
        </ul>
      </Figure>
    </div>
  );
}
