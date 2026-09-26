/**
 * `/leaderboards` (IDEA.md): repositories, never people, ranked by what
 * commitscape measures. Written once a day from the seed repositories'
 * Builds; each board says when, and from how many.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import type { Boards } from "@commitscape/data";
import { Frame } from "../components/Frame";

export const Route = createFileRoute("/leaderboards")({ component: Leaderboards });

export function useBoards(): Boards | null {
  const [boards, setBoards] = useState<Boards | null>(null);
  useEffect(() => {
    fetch("/api/leaderboards")
      .then((r) => r.json() as Promise<Boards>)
      .then(setBoards)
      .catch(() => setBoards({ builtAt: 0, from: 0, boards: [] }));
  }, []);
  return boards;
}

const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Leaderboards() {
  const boards = useBoards();
  return (
    <Frame>
      <section className="boards">
        <Heading level={1}>Leaderboards</Heading>
        <p className="note">
          Repositories, never people, ranked by what commitscape measures in their history.
          {boards && boards.from > 0 && (
            <>
              {" "}
              Written {day(boards.builtAt)}, from {boards.from.toLocaleString("en-US")} of the most starred repositories on GitHub
              in each language.
            </>
          )}
        </p>
        {boards && boards.boards.length === 0 && <p>No boards yet: they are written once the first night's repositories are read.</p>}
        <div className="two">
          {boards?.boards.map((b) => (
            <Card key={b.id} padding={4} className="figure board" id={b.id}>
              <Heading level={2} className="figure-title">
                {b.title}
              </Heading>
              <p className="note">{b.how}</p>
              {b.rows.length === 0 ? (
                <p className="note">None yet.</p>
              ) : (
                <ol className="board-rows">
                  {b.rows.map((r) => (
                    <li key={`${r.owner}/${r.name}`}>
                      <a href={`/gh/${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                      </a>
                      <span className="note small">{r.language}</span>
                      <span className="board-value">{r.shown}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ))}
        </div>
      </section>
    </Frame>
  );
}
