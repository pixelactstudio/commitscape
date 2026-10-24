import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { GIT_FORMAT, type GitPull } from "@commitscape/data";
import { gitPullKey, now, putGitJson, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { forgetStamp } from "./answers";
import { SiteError } from "./http";
import { pullInsight } from "./pull-insight";

const { pullRequests, repoGit, repositories } = schema;

const DAY = 86_400;
const ANCHOR = 1000 * DAY;
const commit = (k: number) => `c${k}`.repeat(20);
const sha = (c: string) => c.repeat(40);

const seed: SeedIndex = {
  anchor: ANCHOR,
  head: sha("a"),
  persons: [
    { id: 3, name: "Alice Example", login: "alice" },
    { id: 4, name: "Bob Example", login: "bob" },
    { id: 5, name: "Cy Example", login: "cy" },
    { id: 6, name: "dependabot", login: "dependabot", bot: true },
  ],
  files: [
    { file: 0, path: "src/a.ts", born: 100, last: ANCHOR },
    { file: 1, path: "src/b.ts", born: 100, last: ANCHOR },
    { file: 2, path: "src/c.ts", born: 100, last: ANCHOR },
    { file: 3, path: "docs/x.md", born: 100, last: ANCHOR },
  ],
  headFiles: [0, 1, 2, 3].map((file) => ({ file, blob: sha(String(file + 1)), bytes: 10, lines: 1, class: "source" })),
  commits: [
    { sha: commit(0), at: ANCHOR - 50 * DAY, person: 4, subject: "first", files: [0, 1, 2] },
    { sha: commit(1), at: ANCHOR - 49 * DAY, person: 4, subject: "again", files: [0, 2] },
    { sha: commit(2), at: ANCHOR - 40 * DAY, person: 3, subject: "docs", files: [0, 2, 3] },
    { sha: commit(3), at: ANCHOR - 30 * DAY, person: 3, subject: "more", files: [0, 2] },
    { sha: commit(4), at: ANCHOR - 20 * DAY, person: 5, subject: "other", files: [0, 1] },
    { sha: commit(5), at: ANCHOR - 15 * DAY, person: 6, subject: "chore: bump", files: [0, 2] },
    { sha: commit(6), at: ANCHOR - 5 * DAY, person: 3, subject: "feat: the thing (#7)", files: [0, 1], added: [10, 5], removed: [2, 1] },
    { sha: commit(7), at: ANCHOR - 4 * DAY, person: 4, subject: "fix: later (#8)", files: [2, 3], added: [3, 3], removed: [0, 0] },
  ],
};

let made = 0;

async function stored(kept: boolean, head = sha("a")) {
  const prefix = `git/gh/acme/rocket${made++}`;
  const deps = await testDeps();
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", isPrivate: false, factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 });
  await deps.db.insert(repoGit).values({ repoId: "acme/rocket", prefix, buildId: "b1", builtAt: ANCHOR, head: sha("b"), branch: "main", branches: 1, tags: 0, files: 4, stored: 0, pulls: 1, bytes: 10, logged: 8, complete: true });
  forgetStamp(await seedIndex(deps.db, "acme/rocket", { ...seed, head }));
  const base = { repoId: "acme/rocket", state: "MERGED", title: "x", createdAt: 1, mergedAt: 2, updatedAt: 3, additions: 1, deletions: 1 };
  await deps.db.insert(pullRequests).values([
    { ...base, number: 7, author: "alice", mergeCommit: commit(6) },
    { ...base, number: 8, author: "bob" },
    { ...base, number: 9, author: "bob" },
  ]);
  if (kept) {
    const pull: GitPull = {
      v: GIT_FORMAT,
      number: 7,
      head: sha("1"),
      base: sha("2"),
      basis: "fork",
      commits: [],
      commitsTotal: 0,
      files: ["src/a.ts", "src/b.ts"].map((path) => ({ path, old: null, status: "M", added: 1, removed: 1, binary: false, patch: null, omitted: null })),
      filesTotal: 2,
      added: 2,
      removed: 2,
    };
    await putGitJson(deps.storage, gitPullKey(prefix, 7), pull);
  }
  return deps;
}

describe("a pull request against the Stored Index", () => {
  test("tells who holds its files other than its author, bots never, and the files that usually change with them", async () => {
    const insight = await pullInsight(await stored(true), viewer(), "acme", "rocket", 7);
    expect(insight).toMatchObject({ number: 7, source: "kept", touched: 2, known: 2 });
    expect(insight.holders.map((h) => [h.person.login, h.files, h.commits])).toEqual([["bob", 2, 2], ["cy", 0, 1]]);
    expect(insight.holders.some((h) => h.person.login === "dependabot" || h.person.login === "alice")).toBe(false);
    expect(insight.partners).toEqual([{ path: "src/c.ts", together: 5, commits: 6 }]);
  });

  test("names the commits on the default branch that mention it, with the lines they changed", async () => {
    const insight = await pullInsight(await stored(true), viewer(), "acme", "rocket", 7);
    expect(insight.landed).toEqual([{ sha: commit(6), at: ANCHOR - 5 * DAY, subject: "feat: the thing (#7)", person: expect.objectContaining({ login: "alice" }), added: 15, removed: 3, files: 2 }]);
  });

  test("takes the files of the commit that squashed it when git kept none", async () => {
    const insight = await pullInsight(await stored(false), viewer(), "acme", "rocket", 7);
    expect(insight.source).toBe("commit");
    expect(insight.touched).toBe(2);
    expect(insight.holders.length).toBeGreaterThan(0);
    expect(insight.filesTotal).toBe(2);
    expect(insight.files.map((f) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(insight.files.reduce((n, f) => n + (f.added ?? 0), 0)).toBe(15);
    expect(insight.files.reduce((n, f) => n + (f.removed ?? 0), 0)).toBe(3);
  });

  test("says what it can when nothing names its files", async () => {
    const insight = await pullInsight(await stored(false), viewer(), "acme", "rocket", 9);
    expect(insight).toEqual({ number: 9, source: "none", touched: 0, known: 0, together: 0, holders: [], partners: [], landed: [], files: [], filesTotal: 0 });
  });

  test("leaves out commits other branches hold once the index knows the Mainline", async () => {
    const deps = await stored(true, sha("e"));
    await deps.db.execute(sql`update index_commits set flags = 8 where encode(sha, 'hex') <> ${commit(0)}`);
    const insight = await pullInsight(deps, viewer(), "acme", "rocket", 7);
    expect(insight.partners).toEqual([{ path: "src/c.ts", together: 4, commits: 5 }]);
  });

  test("refuses a number that is not one and a pull request that is not there", async () => {
    const deps = await stored(true);
    const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => e.status);
    expect(await failure(pullInsight(deps, viewer(), "acme", "rocket", 0))).toBe(400);
    expect(await failure(pullInsight(deps, viewer(), "acme", "rocket", 99))).toBe(404);
  });
});
