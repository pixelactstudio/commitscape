import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { now, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, testDeps, viewer, type Asked } from "#/test/deps";
import { codeLog, codeStory } from "./code";
import { SiteError } from "./http";

const { pullRequests, repoGit, repositories, storedIndexes } = schema;

const sha = (c: string) => c.repeat(40);
const commit = (k: number) => `c${k}`.repeat(20);

const seed: SeedIndex = {
  anchor: 1000,
  head: sha("a"),
  persons: [{ id: 3, name: "Alice Example", login: "alice" }],
  files: [{ file: 0, path: "src/a.ts", born: 100, last: 900 }],
  commits: [{ sha: commit(0), at: 100, person: 3, subject: "first", files: [0] }],
};

const story = { path: "src/a.ts", kind: "file", file: { sha: sha("2"), bytes: 20, lines: 3, lang: "typescript", flags: 1 }, commits: 6, paths: ["src/old.ts"] };

const pull = (number: number) => ({ number, title: null, state: null });

function answering({ endpoint, body }: Asked): unknown {
  if (endpoint === "/v1/code/story") return { ...story, path: body.path };
  if (endpoint === "/v1/code/log") return { path: body.path, total: 3, page: body.page, pages: 1, commits: [{ sha: commit(2), pull: pull(12) }, { sha: commit(1), pull: pull(13) }, { sha: commit(0), pull: null }] };
  return undefined;
}

async function stored() {
  const engine = fakeEngine(answering);
  const deps = await testDeps({ engine });
  await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", isPrivate: false, factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 });
  await deps.db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "git/gh/acme/rocket", buildId: "b1", builtAt: 900, head: sha("b"), branch: "main", branches: 1, tags: 0, files: 4, stored: 0, pulls: 1, bytes: 10, logged: 6, complete: true });
  const si = await seedIndex(deps.db, "acme/rocket", seed);
  const pack = await packed(deps.db, si);
  await deps.db.insert(pullRequests).values({ repoId: "acme/rocket", number: 12, state: "MERGED", author: "alice", title: "Fix the fuel line", createdAt: 1, mergedAt: 2, updatedAt: 3, additions: 4, deletions: 2 });
  return { deps, engine, si, pack };
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the Code window's story of a file", () => {
  test("is the engine's story of the path at the Stored Index's head, with where its text can be read", async () => {
    const { deps, engine, pack } = await stored();
    expect(await codeStory(deps, viewer(), "acme", "rocket", "src/a.ts")).toEqual({ ...story, head: sha("a"), raw: `https://raw.githubusercontent.com/acme/rocket/${sha("a")}/` });
    expect(engine.asked).toEqual([{ endpoint: "/v1/code/story", body: { pack, path: "src/a.ts" } }]);
  });

  test("asks for the whole repository by its empty path, falls back to the git data's head, and refuses what is not a path", async () => {
    const { deps, engine, si } = await stored();
    await deps.db.update(storedIndexes).set({ head: null }).where(eq(storedIndexes.id, si));
    expect(await codeStory(deps, viewer(), "acme", "rocket", "/")).toMatchObject({ path: "", head: sha("b") });
    expect(engine.asked[0]?.body.path).toBe("");
    expect(await failure(codeStory(deps, viewer(), "acme", "rocket", "a\0b"))).toEqual([400, "That is not a path."]);
  });

  test("is read at the next Build when the Stored Index has no pack", async () => {
    const { deps, si } = await stored();
    await deps.db.update(storedIndexes).set({ pack: null }).where(eq(storedIndexes.id, si));
    expect(await failure(codeStory(deps, viewer(), "acme", "rocket", "src/a.ts"))).toEqual([404, expect.stringContaining("next Build")]);
  });
});

describe("the Code window's history of a file", () => {
  test("is the engine's page of commits, with the pull requests they name as GitHub has them", async () => {
    const { deps, engine, pack } = await stored();
    const log = await codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 1);
    expect(engine.asked).toEqual([{ endpoint: "/v1/code/log", body: { pack, path: "src/a.ts", page: 1 } }]);
    expect(log.commits.map((c) => c.pull)).toEqual([{ number: 12, title: "Fix the fuel line", state: "merged" }, pull(13), null]);
  });

  test("refuses a page that is not one", async () => {
    const { deps } = await stored();
    expect(await failure(codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 0))).toEqual([400, "That is not a page."]);
    expect(await failure(codeLog(deps, viewer(), "acme", "rocket", "src/a.ts", 100_001))).toEqual([400, "That is not a page."]);
  });
});
