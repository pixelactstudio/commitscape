import { expect, test } from "vitest";
import { now, schema, seedIndex } from "@commitscape/server";
import { testDeps } from "#/test/deps";
import { commitsOnDay } from "./day-commits";

const { repoPeople, repositories } = schema;

const sha = (c: string) => c.repeat(20);

test("a day's commits carry the Lines Changed counted for them, none for a commit that changed no file or one not yet counted", async () => {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", status: "ok", factsAt: now(), reportKey: "r/rocket/b1", reportAt: 500 },
    { id: "acme/quick", owner: "acme", name: "quick", status: "ok", factsAt: now(), reportKey: "r/quick/b1", reportAt: 500 },
  ]);
  const person = (repoId: string, reportKey: string) => ({ repoId, reportKey, personId: 3, name: "Alice", login: "alice", commits: 2, linesAdded: 7, linesRemoved: 1, first: 1, last: 2 });
  await deps.db.insert(repoPeople).values([person("acme/rocket", "r/rocket/b1"), person("acme/quick", "r/quick/b1")]);
  const persons = [{ id: 3, name: "Alice", login: "alice" }];
  const files = [
    { file: 0, path: "a.ts" },
    { file: 1, path: "b.ts" },
  ];
  await seedIndex(deps.db, "acme/rocket", {
    anchor: 1000,
    persons,
    files,
    commits: [
      { sha: sha("a1"), at: 100, person: 3, subject: "feat: launch", files: [0, 1], added: [3, 4], removed: [1, 0] },
      { sha: sha("b2"), at: 200, person: 3, subject: "Merge branch", files: [], merge: true },
    ],
  });
  await seedIndex(deps.db, "acme/quick", { anchor: 1000, persons, files, lines: false, commits: [{ sha: sha("c3"), at: 300, person: 3, subject: "fix: fuel", files: [0] }] });
  const day = await commitsOnDay(deps, "alice", 0);
  const lines = Object.fromEntries(day.repos.flatMap((r) => r.commits.map((c) => [c.subject, [c.added, c.removed]])));
  expect(lines).toEqual({ "feat: launch": [7, 1], "Merge branch": [null, null], "fix: fuel": [null, null] });
});
