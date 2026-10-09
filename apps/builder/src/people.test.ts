import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { peopleOf } from "./people";

const report = gzipSync(
  JSON.stringify({
    data: {
      "/api/people?window=all": {
        people: [
          { person: { id: 0, name: "Alice Example", login: "alice" }, commits: 9, lines_added: 120, lines_removed: 30, first: 10, last: 90 },
          { person: { id: 1, name: "Bob Example", login: null }, commits: 5, lines_added: null, lines_removed: null, first: 20, last: 80 },
        ],
      },
    },
  }),
);

test("a Report's people over all of history, with the logins the Report gives them", () => {
  expect(peopleOf(report).map((p) => [p.personId, p.name, p.login, p.commits, p.linesAdded, p.first, p.last])).toEqual([
    [0, "Alice Example", "alice", 9, 120, 10, 90],
    [1, "Bob Example", null, 5, null, 20, 80],
  ]);
  expect(peopleOf(gzipSync(JSON.stringify({ data: {} })))).toEqual([]);
});
