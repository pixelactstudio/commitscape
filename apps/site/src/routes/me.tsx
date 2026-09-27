/**
 * `/me` (ADR-0017): signed in, the repositories commitscape's GitHub App
 * may read for you, each opening its Report; "Add repositories" goes to the
 * App's page on GitHub; "Delete my data" removes your account, sessions and
 * the Reports of what you connected, at once.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Frame } from "../components/Frame";

export const Route = createFileRoute("/me")({ component: Me });

type Mine = {
  user: { login: string; name: string | null; avatar: string | null } | null;
  installations: { id: number; account: string; repositories: { name: string; private: boolean; description: string | null }[] }[];
  install: string | null;
};

function Me() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then(async (r) => {
        const body = (await r.json()) as Mine & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "The Site could not answer.");
        setMine(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const post = async (path: string, done: string) => {
    const answer = await fetch(path, { method: "POST" });
    if (answer.ok) {
      setMine(null);
      setOut(done);
    } else setError(((await answer.json()) as { error?: string }).error ?? "That did not work.");
  };
  const count = mine?.installations.reduce((n, i) => n + i.repositories.length, 0) ?? 0;
  return (
    <Frame>
      <section className="repo-waiting me">
        <Heading level={1}>Your repositories</Heading>
        {out && <Banner status="success" title={out} />}
        {!out && error && (
          <>
            <Banner status="info" title={error} />
            <p>
              <Button label="Sign in with GitHub" variant="primary" href="/api/auth/github" />
            </p>
          </>
        )}
        {mine && (
          <>
            <p className="note">
              Signed in as <strong>{mine.user?.login}</strong>. These are the repositories you let commitscape's GitHub App read,
              which can only read. Each one's Report is shown only to people GitHub shows it to, checked on every visit.
            </p>
            <div className="actions">
              {mine.install && <Button label="Add repositories" variant="primary" size="sm" href={mine.install} />}
              <Button label="Sign out" variant="secondary" size="sm" onClick={() => void post("/api/auth/signout", "Signed out.")} />
            </div>
            {count === 0 && <p>None yet: add some through the GitHub App.</p>}
            {mine.installations.map((i) => (
              <Card key={i.id} padding={4} className="figure">
                <Heading level={2} className="figure-title">
                  {i.account}
                </Heading>
                <ul className="facts">
                  {i.repositories.map((r) => (
                    <li key={r.name}>
                      <a href={`/gh/${r.name}`}>{r.name}</a> {r.private && <Badge label="private" variant="neutral" />}{" "}
                      {r.description && <span className="note">{r.description}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            <Card padding={4} className="figure danger-zone">
              <Heading level={2} className="figure-title">
                Delete my data
              </Heading>
              <p className="note">
                Removes your account, every session, and the Reports of the repositories you connected, at once. Removing the
                App on GitHub deletes those Reports too.
              </p>
              <Button
                label="Delete my data"
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (window.confirm("Delete your account, sessions and the Reports you connected?")) void post("/api/me/delete", "Your data is deleted.");
                }}
              />
            </Card>
          </>
        )}
      </section>
    </Frame>
  );
}
