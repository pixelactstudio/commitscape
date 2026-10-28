import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { GIT_FORMAT, UNKNOWN_PERSON, type GitBranchDetail, type GitBranches } from "@commitscape/data";
import { gitBlobKey, now, putGitBlob, schema, seedIndex, writeBlobs, writeBranches, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, signedIn, testDeps, viewer, type Asked } from "#/test/deps";
import { reportCommitPage } from "./commits";
import { readThroughBlob } from "./blobs";
import { branchInsight, folderLast, gitFile, gitStatus, pathHistory } from "./git";
import { SiteError } from "./http";

const { access, repoGit, repositories, session, storedIndexes, user } = schema;

const sha = (c: string) => c.repeat(40);

const commit = (k: number) => `c${k}`.repeat(20);

const seed: SeedIndex = {
  anchor: 1000,
  persons: [{ id: 3, name: "Alice Example", login: "alice" }],
  files: [
    { file: 0, path: "README.md", born: 100, last: 100 },
    { file: 1, path: "src/a.ts", born: 100, last: 300 },
    { file: 2, path: "src/b.ts", born: 100, last: 200 },
    { file: 3, path: "old.txt", born: 50, last: 50, alive: false },
  ],
  headFiles: [
    { file: 0, blob: sha("1"), bytes: 5, lines: 1, class: "prose" },
    { file: 1, blob: sha("2"), bytes: 20, lines: 1, class: "source" },
    { file: 2, blob: sha("3"), bytes: 20, lines: 1, class: "source" },
  ],
  commits: [
    { sha: commit(0), at: 50, person: 3, subject: "zero", files: [3] },
    { sha: commit(1), at: 100, person: 3, subject: "first", files: [0, 1, 2] },
    { sha: commit(2), at: 200, person: null, subject: "second", files: [1, 2] },
    { sha: commit(3), at: 300, person: 3, subject: "third (#12)", files: [1] },
  ],
};

const branches: GitBranches = {
  v: GIT_FORMAT,
  builtAt: 900,
  default: "main",
  head: sha("a"),
  total: 1,
  inferred: true,
  branches: [{ name: "main", sha: sha("a"), at: 300, author: "Alice", login: "alice", subject: "third", ahead: 0, behind: 0, base: sha("a"), baseAt: 300, merged: false, squashed: false, parent: null, shared: 0 }],
  tags: [],
  tagsTotal: 0,
};

function answering({ endpoint, body }: Asked): unknown {
  if (endpoint === "/v1/git/tree") return { v: GIT_FORMAT, head: body.of.head, raw: body.of.raw ?? null, builtAt: body.of.builtAt, paths: ["README.md", "src/a.ts", "src/b.ts"] };
  if (endpoint === "/v1/git/coupling") return { v: GIT_FORMAT, of: {} };
  if (endpoint === "/v1/git/path-history") return { path: body.path, total: 3, commits: [], logged: 4, complete: true };
  if (endpoint === "/v1/git/folder-last") return { path: body.path, entries: [] };
  if (endpoint === "/v1/commits/under") {
    const said = body.said as string[] | null;
    const words: Record<string, string[]> = { third: [commit(3)], "nothing like it": [] };
    const q = body.query.q as string | undefined;
    const shas = [commit(3), commit(2), commit(1)].filter((c) => (said === null || said.includes(c)) && (q === undefined || (words[q] ?? []).includes(c)));
    return { shas: shas.slice(0, body.query.limit ?? 50), total: shas.length, next: (body.query.limit ?? 50) < shas.length ? "next-cursor" : null };
  }
  return undefined;
}

async function stored() {
  const deps = await testDeps({ engine: fakeEngine(answering) });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
    { id: "acme/bare", owner: "acme", name: "bare", githubId: 3, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/bare/b1", reportAt: 700 },
  ]);
  for (const id of ["acme/rocket", "acme/secret"]) {
    const prefix = `git/gh/${id}`;
    await deps.db.insert(repoGit).values({ repoId: id, prefix, buildId: "b1", builtAt: 900, head: sha("a"), branch: "main", branches: 2, tags: 1, files: 3, stored: 3, pulls: 1, bytes: 10, logged: 3, complete: true });
    await packed(deps.db, await seedIndex(deps.db, id, seed), `packs/${id}/1/pack.pack`);
    await writeBlobs(deps.db, id, new Map([sha("1"), sha("2"), sha("3")].map((s) => [s, { lines: 1, binary: false }])));
    await writeBranches(deps.db, id, branches, new Map());
    await putGitBlob(deps.storage, gitBlobKey(prefix, sha("2")), Buffer.from("export const a = 1;\n"));
  }
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the git data of a repository", () => {
  test("says what is kept, and nothing for a repository built before git data", async () => {
    const deps = await stored();
    expect(await gitStatus(deps, viewer(), "acme", "rocket")).toMatchObject({ builtAt: 900, branch: "main", branches: 2, branchesTotal: 0, openBranches: 0, tags: 1, tagsTotal: 0, files: 3, pulls: 1, complete: true });
    expect(await gitStatus(deps, viewer(), "acme", "bare")).toBeNull();
  });

  test("counts the open branches and says what a branch's changes meet, once its files are kept", async () => {
    const deps = await stored();
    const tip = (name: string, over: object = {}) => ({ name, sha: sha("b"), at: 800, author: "Alice", login: "alice", subject: "work", ahead: 1, behind: 0, base: sha("a"), baseAt: 150, merged: false, squashed: false, parent: "main", shared: 0, ...over });
    const more: GitBranches = { ...branches, total: 4, branches: [...branches.branches, tip("feature/x"), tip("old/done", { merged: true, ahead: 0 }), tip("deps/y", { bot: true })], tagsTotal: 2 };
    const details = new Map<number, GitBranchDetail>([[1, { v: GIT_FORMAT, name: "feature/x", against: "main", commits: [{ sha: sha("b"), at: 800, author: "Alice", subject: "work" }], commitsTotal: 1, files: [{ path: "src/a.ts", added: 2, removed: 1 }], filesTotal: 1, added: 2, removed: 1 }]]);
    await writeBranches(deps.db, "acme/rocket", more, details);
    await deps.db.update(schema.indexCommits).set({ flags: 8, arrival: sql`${schema.indexCommits.at}` });
    expect(await gitStatus(deps, viewer(), "acme", "rocket")).toMatchObject({ branchesTotal: 0, openBranches: 1 });
    const insight = await branchInsight(deps, viewer(), "acme", "rocket", 1);
    expect(insight).toMatchObject({ name: "feature/x", forkedAt: 150, touched: 1, known: 1, atHead: ["src/a.ts"] });
    expect(insight.holders.map((h) => h.login)).toEqual(["alice"]);
    expect(await failure(branchInsight(deps, viewer(), "acme", "rocket", 2))).toEqual([404, "This branch's files were not kept."]);
    expect(await failure(branchInsight(deps, viewer(), "acme", "rocket", -1))).toEqual([400, "That is not a branch."]);
    expect(await failure(branchInsight(deps, viewer(), "acme", "secret", 1))).toEqual([404, "No Report of this repository yet."]);
  });

  test("serves the engine's tree of the files at HEAD packed with brotli once per pack and build, kept for good when the address names its build", async () => {
    const deps = await stored();
    const engine = deps.engine as ReturnType<typeof fakeEngine>;
    const pinned = await gitFile(deps, viewer(), "acme", "rocket", "tree.json", 900);
    expect(pinned.cacheControl).toBe("public, max-age=31536000, immutable");
    const br = (await pinned.packed?.br) ?? new Uint8Array();
    expect(JSON.parse(brotliDecompressSync(br).toString())).toMatchObject({ head: commit(3), raw: `https://raw.githubusercontent.com/acme/rocket/${commit(3)}/` });
    const blob = { lines: 1, binary: false };
    expect(engine.asked).toEqual([{ endpoint: "/v1/git/tree", body: { pack: "packs/acme/rocket/1/pack.pack", blobs: { [sha("1")]: blob, [sha("2")]: blob, [sha("3")]: blob }, of: { builtAt: 900, head: commit(3), branch: "main", raw: `https://raw.githubusercontent.com/acme/rocket/${commit(3)}/` } } }]);
    expect((await gitFile(deps, viewer(), "acme", "rocket", "tree.json", 900)).packed).toBe(pinned.packed);
    expect((await gitFile(deps, viewer(), "acme", "rocket", "tree.json", 1)).cacheControl).toBe("public, max-age=60");
    const again = await gitFile(deps, viewer(), "acme", "rocket", "tree.json", null, pinned.etag);
    expect([again.packed, again.cacheControl]).toEqual([null, "public, max-age=60"]);
    expect(engine.asked).toHaveLength(1);
    expect(JSON.parse(brotliDecompressSync((await (await gitFile(deps, viewer(), "acme", "rocket", "coupling.json", 900)).packed?.br) ?? new Uint8Array()).toString())).toEqual({ v: GIT_FORMAT, of: {} });
  });

  test("the whole history as one file is no longer served: the Universe reads its Atlas, the Code window its pages", async () => {
    const deps = await stored();
    expect(await failure(gitFile(deps, viewer(), "acme", "rocket", "log.json", 500))).toEqual([404, "No such file."]);
  });

  test("says the tree and history are read at the next Build while the Stored Index has no pack", async () => {
    const deps = await stored();
    await deps.db.update(storedIndexes).set({ pack: null });
    expect(await failure(gitFile(deps, viewer(), "acme", "rocket", "tree.json", 900))).toEqual([404, expect.stringContaining("next Build")]);
    expect(await failure(pathHistory(deps, viewer(), "acme", "rocket", "src/"))).toEqual([404, expect.stringContaining("next Build")]);
    expect(await failure(reportCommitPage(deps, viewer(), "acme", "rocket", { under: "src/" }))).toEqual([404, expect.stringContaining("built again")]);
    expect((await reportCommitPage(deps, viewer(), "acme", "rocket", {})).page?.rows).toHaveLength(4);
  });

  test("answers an ETag it gave with no body", async () => {
    const deps = await stored();
    const first = await gitFile(deps, viewer(), "acme", "rocket", "branches.json", 900);
    const again = await gitFile(deps, viewer(), "acme", "rocket", "branches.json", 900, first.etag);
    expect(again.object).toBeNull();
    expect(again.etag).toBe(first.etag);
  });

  test("refuses a file it does not serve, and the history that is for the server alone", async () => {
    const deps = await stored();
    expect(await failure(gitFile(deps, viewer(), "acme", "rocket", "history.json", null))).toEqual([404, "No such file."]);
    expect(await failure(gitFile(deps, viewer(), "acme", "rocket", "../tree.json", null))).toEqual([404, "No such file."]);
    expect(await failure(gitFile(deps, viewer(), "acme", "rocket", "pull-9.json", null))).toEqual([404, "Git data of this pull request was not kept."]);
    expect(await failure(gitFile(deps, viewer(), "acme", "bare", "tree.json", null))).toEqual([404, expect.stringContaining("next Build")]);
  });

  test("serves a file's text by its blob id, kept for a year, and refuses an id that is not one", async () => {
    const deps = await stored();
    const blob = await readThroughBlob(deps, viewer(), "acme", "rocket", sha("2"));
    expect(blob.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(blob.etag).toBe(`"${sha("2")}"`);
    expect(gunzipSync(blob.object?.body ?? new Uint8Array()).toString()).toBe("export const a = 1;\n");
    expect((await readThroughBlob(deps, viewer(), "acme", "rocket", sha("2"), blob.etag)).object).toBeNull();
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", "../../etc/passwd"))).toEqual([404, "No such file."]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", sha("9")))).toEqual([404, "No file at this repository's HEAD has this text."]);
  });

  test("keeps a private repository's git data from anyone who cannot see it, and out of shared caches", async () => {
    const deps = await stored();
    expect(await failure(gitFile(deps, viewer(), "acme", "secret", "tree.json", 900))).toEqual([404, "No Report of this repository yet."]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "secret", sha("2")))).toEqual([404, "No Report of this repository yet."]);
    await deps.db.insert(user).values({ id: "u1", name: "U", email: "u@example.com" });
    await deps.db.insert(session).values({ id: "s1", expiresAt: new Date(Date.now() + 1e6), token: "t", userId: "u1", updatedAt: new Date() });
    await deps.db.insert(access).values({ sessionId: "s1", repoId: "acme/secret", allowed: true, until: now() + 100 });
    const mine = signedIn({ token: async () => "tok" });
    const tree = await gitFile(deps, mine, "acme", "secret", "tree.json", 900);
    expect(tree.cacheControl).toBe("private, max-age=300");
    expect(JSON.parse(brotliDecompressSync((await tree.packed?.br) ?? new Uint8Array()).toString()).raw).toBeNull();
    expect((await readThroughBlob(deps, mine, "acme", "secret", sha("2"))).cacheControl).toBe("private, max-age=31536000, immutable");
  });
});

describe("how a path has changed", () => {
  test("is the engine's answer for the path", async () => {
    const deps = await stored();
    const engine = deps.engine as ReturnType<typeof fakeEngine>;
    expect(await pathHistory(deps, viewer(), "acme", "rocket", "src/a.ts")).toMatchObject({ path: "src/a.ts", total: 3, logged: 4, complete: true });
    expect(await folderLast(deps, viewer(), "acme", "rocket", "src/")).toEqual({ path: "src/", entries: [] });
    expect(engine.asked.map((a) => [a.endpoint, a.body.path])).toEqual([["/v1/git/path-history", "src/a.ts"], ["/v1/git/folder-last", "src/"]]);
  });

  test("filters the Commits list to the commits under a path the engine finds, their rows read from Postgres", async () => {
    const deps = await stored();
    const engine = deps.engine as ReturnType<typeof fakeEngine>;
    const first = await reportCommitPage(deps, viewer(), "acme", "rocket", { under: "src/", limit: 2, at: 500 });
    expect(first.page?.rows.map((r) => r.sha)).toEqual([commit(3), commit(2)]);
    expect(first.page).toMatchObject({ total: 3, next: "next-cursor" });
    expect(first.page?.people).toEqual({ "3": { id: 3, name: "Alice Example", colour: null, login: "alice" }, [String(UNKNOWN_PERSON)]: expect.objectContaining({ id: UNKNOWN_PERSON }) });
    expect(first.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(engine.asked).toEqual([{ endpoint: "/v1/commits/under", body: { pack: "packs/acme/rocket/1/pack.pack", path: "src/", query: { limit: 2 }, said: null } }]);
    await reportCommitPage(deps, viewer(), "acme", "rocket", { under: "src/", limit: 2, cursor: "next-cursor" });
    expect(engine.asked.at(-1)?.body.cursor).toBe("next-cursor");
    const all = await reportCommitPage(deps, viewer(), "acme", "rocket", {});
    expect(all.page?.rows).toHaveLength(4);
    expect(all.etag).not.toBe(first.etag);
  });

  test("searches the commits under a folder by their words in the engine service, and reads only their rows from Postgres", async () => {
    const deps = await stored();
    const engine = deps.engine as ReturnType<typeof fakeEngine>;
    const found = await reportCommitPage(deps, viewer(), "acme", "rocket", { under: "src/", q: "third" });
    expect(found.page?.rows.map((r) => r.sha)).toEqual([commit(3)]);
    expect(found.page?.total).toBe(1);
    expect(engine.asked.at(-1)?.body).toMatchObject({ path: "src/", query: { q: "third" }, said: null });
    expect((await reportCommitPage(deps, viewer(), "acme", "rocket", { under: "src/", q: "nothing like it" })).page?.rows).toEqual([]);
  });

  test("refuses a path or a folder that is not one", async () => {
    const deps = await stored();
    expect(await failure(pathHistory(deps, viewer(), "acme", "rocket", "a\0b"))).toEqual([400, "That is not a path."]);
    expect(await failure(folderLast(deps, viewer(), "acme", "rocket", "src"))).toEqual([400, "That is not a folder."]);
  });
});
