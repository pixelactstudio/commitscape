import { describe, expect, test } from "vitest";
import { FILE_BINARY, FILE_STORED } from "@commitscape/data";
import { now, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { codeLog, codeStory } from "./code";
import { SiteError } from "./http";

const { pullRequests, repoGit, repositories } = schema;

const sha = (c: string) => c.repeat(40);
const commit = (k: number) => `c${k}`.repeat(20);
const DAY = 86_400;
const ANCHOR = 1000 * DAY;

const seed: SeedIndex = {
  anchor: ANCHOR,
  head: sha("a"),
  persons: [
    { id: 3, name: "Alice Example", login: "alice" },
    { id: 4, name: "Bob Example", login: "bob" },
    { id: 5, name: "dependabot", login: "dependabot", bot: true },
  ],
  files: [
    { file: 0, path: "README.md", born: 100, last: 100 },
    { file: 1, path: "src/a.ts", born: 100, last: ANCHOR - DAY },
    { file: 2, path: "src/b.ts", born: 100, last: 200 },
    { file: 3, path: "logo.png", born: 100, last: 100 },
  ],
  headFiles: [
    { file: 0, blob: sha("1"), bytes: 5, lines: 1, class: "prose" },
    { file: 1, blob: sha("2"), bytes: 20, lines: 3, class: "source" },
    { file: 2, blob: sha("3"), bytes: 20, lines: 1, class: "source" },
    { file: 3, blob: sha("4"), bytes: 900, lines: 0, class: "binary" },
  ],
  commits: [
    { sha: commit(0), at: 100, person: 4, subject: "first", files: [0, 1, 2, 3], added: [1, 10, 1, 0], removed: [0, 0, 0, 0] },
    { sha: commit(1), at: 400 * DAY, person: 3, subject: "fix: the fuel (#12)", files: [1], kind: 1, added: [4], removed: [2] },
    { sha: commit(2), at: 420 * DAY, person: null, subject: "merge", files: [], merge: true },
    { sha: commit(3), at: ANCHOR - 30 * DAY, person: 3, subject: "feat: more", files: [1, 2], added: [2, 1], removed: [1, 1] },
    { sha: commit(4), at: ANCHOR - 20 * DAY, person: 3, subject: "feat: still more (#13)", files: [1], added: [1], removed: [0] },
    { sha: commit(5), at: ANCHOR - 2 * DAY, person: 5, subject: "chore: bump", files: [1] },
    { sha: commit(6), at: ANCHOR - DAY, person: 3, subject: "fix: again", files: [1], kind: 1 },
  ],
};

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", isPrivate: false, factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 });
  await deps.db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "git/gh/acme/rocket", buildId: "b1", builtAt: 900, head: sha("b"), branch: "main", branches: 1, tags: 0, files: 4, stored: 0, pulls: 1, bytes: 10, logged: 6, complete: true });
  await seedIndex(deps.db, "acme/rocket", seed);
  await deps.db.insert(pullRequests).values({ repoId: "acme/rocket", number: 12, state: "MERGED", author: "alice", title: "Fix the fuel line", createdAt: 1, mergedAt: 2, updatedAt: 3, additions: 4, deletions: 2 });
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the Code window's story of a file", () => {
  test("tells when it was born, its commits and people, its last change, who holds it and their share of fixes", async () => {
    const deps = await stored();
    const story = await codeStory(deps, viewer(), "acme", "rocket", "src/a.ts");
    expect(story).toMatchObject({
      path: "src/a.ts",
      kind: "file",
      head: sha("a"),
      raw: `https://raw.githubusercontent.com/acme/rocket/${sha("a")}/`,
      file: { sha: sha("2"), bytes: 20, lines: 3, lang: "typescript", flags: FILE_STORED },
      commits: 6,
      counted: 6,
      people: 2,
      fixes: 2,
      classified: 2,
      born: { at: 100, sha: commit(0), person: { login: "bob" } },
      last: { at: ANCHOR - DAY, sha: commit(6), person: { login: "alice" } },
    });
    expect(story.holders[0]).toMatchObject({ person: { login: "alice" }, commits: 4, maintainer: true });
    expect(story.holders.find((h) => h.person.login === "bob")).toMatchObject({ commits: 1, maintainer: false });
    expect(story.holders.some((h) => h.person.login === "dependabot")).toBe(false);
  });

  test("counts lines by year and names the top owners of each year", async () => {
    const deps = await stored();
    const story = await codeStory(deps, viewer(), "acme", "rocket", "src/a.ts");
    expect(story.years.map((y) => [y.year, y.commits, y.added, y.removed])).toEqual([
      [1970, 1, 10, 0],
      [1971, 1, 4, 2],
      [1972, 4, 5, 1],
    ]);
    expect(story.years[2]?.owners.map((o) => [o.person.login, o.commits])).toEqual([["alice", 3]]);
    expect(story.years[2]?.others).toBe(1);
  });

  test("sums a folder and the whole repository, with a Bus Factor", async () => {
    const deps = await stored();
    const folder = await codeStory(deps, viewer(), "acme", "rocket", "src/");
    expect(folder).toMatchObject({ kind: "folder", file: null, files: 2, bytes: 40, lines: 4, commits: 6 });
    expect(folder.busFactor).toBeGreaterThanOrEqual(1);
    const root = await codeStory(deps, viewer(), "acme", "rocket", "/");
    expect(root).toMatchObject({ kind: "folder", path: "", files: 4 });
  });

  test("marks a binary file and says when a path is not at HEAD", async () => {
    const deps = await stored();
    expect((await codeStory(deps, viewer(), "acme", "rocket", "logo.png")).file?.flags).toBe(FILE_BINARY);
    expect(await codeStory(deps, viewer(), "acme", "rocket", "src/gone.ts")).toMatchObject({ kind: "missing", file: null, commits: 0, born: null });
    expect(await failure(codeStory(deps, viewer(), "acme", "rocket", "a\0b"))).toEqual([400, "That is not a path."]);
  });
});

describe("the Code window's history of a file", () => {
  test("lists every commit newest first, merges left out, with its lines there and the pull request it names", async () => {
    const deps = await stored();
    const log = await codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 1);
    expect(log).toMatchObject({ total: 6, page: 1, pages: 1 });
    expect(log.commits.map((c) => c.sha)).toEqual([commit(6), commit(5), commit(4), commit(3), commit(1), commit(0)]);
    expect(log.commits[4]).toMatchObject({ subject: "fix: the fuel (#12)", added: 4, removed: 2, kind: 1, pull: { number: 12, title: "Fix the fuel line", state: "merged" } });
    expect(log.commits[2]?.pull).toEqual({ number: 13, title: null, state: null });
    expect(log.commits[3]).toMatchObject({ added: 2, removed: 1 });
  });

  test("pages, and refuses a page that is not one", async () => {
    const deps = await stored();
    expect((await codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 2)).commits).toEqual([]);
    expect(await failure(codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 0))).toEqual([400, "That is not a page."]);
  });
});
