import { brotliDecompressSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { decodeAtlas, decodeNames, folderPath, layoutOf } from "@commitscape/data/universe";
import { now, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { SiteError } from "./http";
import { atlasBody, atlasFile, warmAtlas } from "./universe";

const { repositories } = schema;

const commit = (k: number) => `c${k}`.repeat(20);

const seed: SeedIndex = {
  anchor: 1000,
  persons: [
    { id: 3, name: "Alice Example", login: "alice" },
    { id: 4, name: "Bob", login: null },
    { id: 5, name: "ci-bot", login: "ci[bot]", bot: true },
  ],
  files: [
    { file: 0, path: "README.md", born: 100, last: 100 },
    { file: 1, path: "src/a.ts", born: 100, last: 300 },
    { file: 2, path: "src/old.ts", born: 100, last: 250, alive: false },
    { file: 3, path: "side/branch.ts", born: 220, last: 220, alive: false },
  ],
  headFiles: [
    { file: 0, blob: "1".repeat(40), bytes: 5, lines: 3, class: "prose" },
    { file: 1, blob: "2".repeat(40), bytes: 20, lines: 12, class: "source" },
  ],
  commits: [
    { sha: commit(1), at: 100, person: 3, files: [0, 1, 2] },
    { sha: commit(2), at: 200, person: 4, files: [1] },
    { sha: commit(3), at: 220, person: 4, files: [3] },
    { sha: commit(4), at: 250, person: 3, files: [2] },
    { sha: commit(5), at: 260, person: 3, files: [1], merge: true },
    { sha: commit(6), at: 300, person: 5, files: [1] },
  ],
};

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
  ]);
  for (const id of ["acme/rocket", "acme/secret"]) await seedIndex(deps.db, id, seed);
  const main = [commit(1), commit(2), commit(4), commit(5), commit(6)];
  await deps.db.execute(sql`UPDATE index_commits SET flags = flags | 8, arrival = at WHERE encode(sha, 'hex') = ANY (${sql.param(main)}::text[])`);
  await deps.db.execute(sql`UPDATE index_commits SET arrival = 280 WHERE encode(sha, 'hex') = ${commit(2)}`);
  await deps.db.execute(sql`UPDATE index_commits SET changes = '{0,0,0}' WHERE encode(sha, 'hex') = ${commit(1)}`);
  await deps.db.execute(sql`UPDATE index_commits SET changes = '{2}' WHERE encode(sha, 'hex') = ${commit(4)}`);
  return deps;
}

const bytesOf = async (deps: Awaited<ReturnType<typeof stored>>, part: "map" | "names", v: number | null = null) => {
  const found = await atlasFile(deps, viewer(), "acme", "rocket", part, v);
  if (!found.body) throw new Error("no body");
  return { found, bytes: new Uint8Array(brotliDecompressSync(found.body.br)) };
};

describe("the Atlas", () => {
  test("carries the default branch's commits by when they arrived there, without Merge Commits or other branches", async () => {
    const deps = await stored();
    const { bytes } = await bytesOf(deps, "map");
    const atlas = decodeAtlas(bytes);
    expect(atlas.mainline).toBe(true);
    expect(Array.from(atlas.commits.time)).toEqual([100, 250, 280, 300]);
    expect(atlas.files.folder.length).toBe(3);
    expect(atlas.people.names).toEqual(["Alice Example", "Bob", "ci-bot"]);
    expect(Array.from(atlas.people.bot)).toEqual([0, 0, 1]);
    const { born, died } = layoutOf(atlas);
    const names = decodeNames((await bytesOf(deps, "names")).bytes).names;
    const old = names.indexOf("old.ts");
    expect(died[old]).toBe(250);
    expect(born[names.indexOf("a.ts")]).toBe(100);
    expect(folderPath(atlas, atlas.files.folder[old] as number)).toBe("src");
    expect(atlas.files.lines[names.indexOf("a.ts")]).toBe(12);
  });

  test("answers again with 304, pins a year when the address names the Report, and keeps what it made", async () => {
    const deps = await stored();
    const { found } = await bytesOf(deps, "map", 500);
    expect(found.cacheControl).toContain("immutable");
    const again = await atlasFile(deps, viewer(), "acme", "rocket", "map", 500, found.etag);
    expect(again.body).toBeNull();
    const loose = await atlasFile(deps, viewer(), "acme", "rocket", "map", 1);
    expect(loose.cacheControl).toBe("public, max-age=300");
    expect((await deps.storage.keys?.("atlas/"))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("is made ahead of its first visitor, and what an earlier load of the Stored Index left in storage is deleted", async () => {
    const deps = await stored();
    const [row] = await deps.db.select({ si: repositories.indexId }).from(repositories).where(sql`${repositories.id} = 'acme/rocket'`);
    const si = row?.si as number;
    await deps.storage.put(`atlas/${si}/0000000000000000/map.bin.br`, "old", { type: "application/octet-stream" });
    expect(await warmAtlas(deps.db, deps.storage, si)).toBe(true);
    expect(await warmAtlas(deps.db, deps.storage, si + 1000)).toBe(false);
    const kept = (await deps.storage.keys?.(`atlas/${si}/`)) ?? [];
    expect(kept.length).toBe(2);
    expect(kept.some((k) => k.includes("0000000000000000"))).toBe(false);
    const again = await atlasFile(deps, viewer(), "acme", "rocket", "map", null);
    expect(again.body).not.toBeNull();
  });

  test("sends brotli, gzip or plain bytes as the request accepts", async () => {
    const deps = await stored();
    const { found, bytes } = await bytesOf(deps, "map");
    if (!found.body) throw new Error("no body");
    expect((await atlasBody(found.body, "gzip, deflate, br")).encoding).toBe("br");
    expect((await atlasBody(found.body, "gzip")).encoding).toBe("gzip");
    const plain = await atlasBody(found.body, null);
    expect(plain.encoding).toBeNull();
    expect(plain.body).toEqual(bytes);
  });

  test("hides a private repository's Atlas from a visitor who cannot see it", async () => {
    const deps = await stored();
    await expect(atlasFile(deps, viewer(), "acme", "secret", "map", null)).rejects.toBeInstanceOf(SiteError);
  });
});
