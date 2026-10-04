import type { ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import type { Facts as Data, Lookup } from "@commitscape/data";
import { avatarUrl, Face, Tile } from "@commitscape/ui";

const number = (n: number) => n.toLocaleString("en-US");
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const many = (n: number, one: string, more: string) => `${number(n)} ${n === 1 ? one : more}`;

/** A repository's name, owner and what GitHub says of it, drawn at once from the lookup. */
export function RepoHeader({ lookup, children }: { lookup: Lookup; children?: ReactNode }) {
  const f = lookup.facts;
  return (
    <header className="repo-head">
      <Avatar src={avatarUrl(lookup.owner, 48)} name={lookup.owner} size={48} tooltip={false} />
      <div className="min-w-0 flex-1">
        <Heading level={1} className="repo-title">
          <a href={`https://github.com/${lookup.owner}/${lookup.name}`}>
            <span className="note">{lookup.owner} / </span>
            {lookup.name}
          </a>
        </Heading>
        {f?.description && <p className="repo-line">{f.description}</p>}
        <p className="repo-facts note small">
          {f && (
            <>
              <span>{many(f.stars, "star", "stars")}</span>
              <span>{many(f.forks, "fork", "forks")}</span>
              {f.languages[0] && <span>mostly {f.languages[0].name}</span>}
              {f.license && f.license !== "NOASSERTION" && <span>{f.license}</span>}
              <span>created {date(f.createdAt)}</span>
              {f.archived && <Badge label="archived" variant="warning" />}
            </>
          )}
          {children}
        </p>
      </div>
    </header>
  );
}

export function Facts({ facts }: { facts: Data }) {
  const bytes = facts.languages.reduce((n, l) => n + l.bytes, 0);
  return (
    <div className="facts-view">
      {facts.topics.length > 0 && (
        <div className="facts-tags">
          {facts.topics.map((t) => (
            <Badge key={t} label={t} variant="info" />
          ))}
        </div>
      )}
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
                <div className="bar-row">
                  <span className="bar-label">{l.name}</span>
                  <span className="bar-track">
                    <span className="bar" style={{ width: `${Math.max(0.5, (l.bytes * 100) / Math.max(1, facts.languages[0]?.bytes ?? 1))}%`, background: "var(--s1)" }} />
                  </span>
                  <span className="bar-value">{Math.round((l.bytes * 100) / Math.max(1, bytes))}% of bytes</span>
                </div>
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
                <Face login={c.login} name={c.login} size={24} />
                <a href={`/u/${c.login}`}>{c.login}</a>
                <span className="note">{many(c.contributions, "commit", "commits")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
