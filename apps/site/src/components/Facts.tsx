/**
 * GitHub's instant facts (ADR-0015), shown while a repository's first Build
 * runs: what GitHub tells anyone, with its people's avatars.
 */
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import type { Facts as Data } from "@commitscape/data";
import { Tile } from "@commitscape/ui";

const number = (n: number) => n.toLocaleString("en-US");
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export function Facts({ facts }: { facts: Data }) {
  const bytes = facts.languages.reduce((n, l) => n + l.bytes, 0);
  return (
    <div className="facts-view">
      {facts.description && <p className="facts-line">{facts.description}</p>}
      <div className="facts-tags">
        {facts.archived && <Badge label="archived" variant="warning" />}
        {facts.license && <Badge label={facts.license} variant="neutral" />}
        {facts.topics.map((t) => (
          <Badge key={t} label={t} variant="info" />
        ))}
      </div>
      <section className="tiles">
        <Tile value={number(facts.stars)} label="stars" />
        <Tile value={number(facts.forks)} label="forks" />
        <Tile value={number(facts.openIssues)} label="open issues and pull requests" />
        <Tile value={date(facts.createdAt)} label="created" note={`last pushed ${date(facts.pushedAt)}`} />
      </section>
      <div className="two">
        <Card padding={4} className="figure">
          <Heading level={2} className="figure-title">
            Languages
          </Heading>
          <p className="note">As GitHub counts them, by bytes</p>
          <ol className="bars">
            {facts.languages.map((l) => (
              <li key={l.name}>
                <span className="bar-label">{l.name}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${Math.max(0.5, (l.bytes * 100) / Math.max(1, facts.languages[0]?.bytes ?? 1))}%`, background: "var(--s1)" }} />
                </span>
                <span className="bar-value">{Math.round((l.bytes * 100) / Math.max(1, bytes))}%</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card padding={4} className="figure">
          <Heading level={2} className="figure-title">
            Who GitHub says contributed most
          </Heading>
          <p className="note">By commits GitHub linked to an account</p>
          <ul className="people-faces">
            {facts.contributors.map((c) => (
              <li key={c.login}>
                <Avatar src={`${c.avatar}${c.avatar.includes("?") ? "&" : "?"}s=64`} name={c.login} size="sm" tooltip={false} />
                <span>{c.login}</span>
                <span className="note">{number(c.contributions)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {facts.releases.length > 0 && (
        <Card padding={4} className="figure">
          <Heading level={2} className="figure-title">
            Latest releases
          </Heading>
          <ul className="facts">
            {facts.releases.map((r) => (
              <li key={r.tag}>
                <strong>{r.name}</strong> <span className="note">{date(r.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
