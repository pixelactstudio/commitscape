import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { peopleOf, resolveLogins } from "./people";

const oid = (n: number) => String(n).repeat(40).slice(0, 40);
const alice = { id: 0, name: "Alice Example", login: null };
const bob = { id: 1, name: "Bob Example", login: "bob" };
const carol = { id: 2, name: "Carol Example", login: null };

const report = gzipSync(
  JSON.stringify({
    data: {
      "/api/people?window=all": {
        people: [
          { person: alice, commits: 9, lines_added: 120, lines_removed: 30, first: 10, last: 90 },
          { person: bob, commits: 5, lines_added: null, lines_removed: null, first: 20, last: 80 },
          { person: carol, commits: 2, lines_added: 4, lines_removed: 0, first: 30, last: 70 },
        ],
      },
      "/api/commits?": { people: [{ person: alice }, { person: bob }, { person: carol }], ids: [oid(1), oid(2), oid(3), oid(4)], person: [0, 1, 0, 2] },
    },
  }),
);

test("a Report's people over all of history, each with their newest commit", () => {
  const { people, newest } = peopleOf(report);
  expect(people.map((p) => [p.personId, p.name, p.login, p.commits, p.linesAdded])).toEqual([
    [0, "Alice Example", null, 9, 120],
    [1, "Bob Example", "bob", 5, null],
    [2, "Carol Example", null, 2, 4],
  ]);
  expect(newest).toEqual(new Map([[0, oid(1)], [1, oid(2)], [2, oid(4)]]));
});

test("logins come from the account GitHub links to a commit, one request for fifty people, none asked for those already known", async () => {
  const { people, newest } = peopleOf(report);
  const asked: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: { owner: string; name: string } };
    asked.push(body.query);
    expect(body.variables).toEqual({ owner: "acme", name: "rocket" });
    expect(body.query).not.toContain(oid(2));
    return Response.json({ data: { repository: { c0: { author: { user: { login: "alice" } } }, c1: { author: { user: null } } } } });
  }) as unknown as typeof fetch;
  const { found, requests } = await resolveLogins({ api: "http://github.test", token: "t", fetcher }, "acme", "rocket", people, newest);
  expect(found).toEqual(new Map([[0, "alice"]]));
  expect(requests).toBe(1);
  expect(asked).toHaveLength(1);
});

test("without a token nothing is asked", async () => {
  const { people, newest } = peopleOf(report);
  await expect(resolveLogins({ api: "http://github.test", token: null }, "acme", "rocket", people, newest)).rejects.toThrow("needs a token");
});
