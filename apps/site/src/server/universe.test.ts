import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { atlasOf, decodeAtlas, decodeNames, encodeAtlas, encodeNames, type AtlasRows } from "@commitscape/data/universe";
import { atlasKey, now, schema, seedIndex, type AtlasJob, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, testDeps, viewer } from "#/test/deps";
import { SiteError } from "./http";
import { atlasBody, atlasFile } from "./universe";

const { repositories } = schema;

const seed: SeedIndex = { anchor: 1000, persons: [{ id: 3, name: "Alice Example", login: "alice" }], files: [{ file: 0, path: "a.ts" }], commits: [{ sha: "c1".repeat(20), at: 100, person: 3, files: [0] }] };

const rows: AtlasRows = {
  mainline: true,
  newest: 300,
  files: [
    { file: 0, path: "README.md", alive: true, role: 3, language: "Markdown", generated: false, lockfile: false, lines: 3 },
    { file: 1, path: "src/a.ts", alive: true, role: 0, language: "TypeScript", generated: false, lockfile: false, lines: 12 },
  ],
  people: [
    { id: 3, name: "Alice Example", login: "alice", bot: false },
    { id: 5, name: "ci-bot", login: "ci[bot]", bot: true },
  ],
  commits: [
    { time: 100, person: 3, bulk: false, firstParent: true, files: [0, 1], changes: [0, 0] },
    { time: 300, person: 5, bulk: false, firstParent: true, files: [1], changes: [1] },
  ],
  releases: [],
};

async function stored(made = true) {
  const engine = fakeEngine(() => undefined);
  const queued: AtlasJob[] = [];
  const deps = await testDeps({ engine, queue: async () => ({ send: async () => {}, atlas: async (job) => void queued.push(job) }) });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
  ]);
  const si = await seedIndex(deps.db, "acme/rocket", seed);
  const pack = await packed(deps.db, si, "packs/acme/rocket/1/head-b1-lines.pack");
  await packed(deps.db, await seedIndex(deps.db, "acme/secret", seed), "packs/acme/secret/2/head-b1-lines.pack");
  if (made) {
    const { atlas, names } = atlasOf(rows);
    await deps.storage.put(atlasKey(si, pack, "map"), brotliCompressSync(encodeAtlas(atlas)), { type: "application/octet-stream", encoding: "br" });
    await deps.storage.put(atlasKey(si, pack, "names"), brotliCompressSync(encodeNames(names)), { type: "application/octet-stream", encoding: "br" });
  }
  return Object.assign(deps, { engine, si, pack, queued });
}

const bytesOf = async (deps: Awaited<ReturnType<typeof stored>>, part: "map" | "names", v: number | null = null) => {
  const found = await atlasFile(deps, viewer(), "acme", "rocket", part, v);
  if (!found.body) throw new Error("no body");
  return { found, bytes: new Uint8Array(brotliDecompressSync(found.body.br)) };
};

const refused = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the Atlas", () => {
  test("is the one the Builder stored for the Stored Index's pack, sent as it is, never made by the Site", async () => {
    const deps = await stored();
    const atlas = decodeAtlas((await bytesOf(deps, "map")).bytes);
    expect(Array.from(atlas.commits.time)).toEqual([100, 300]);
    expect(atlas.people.names).toEqual(["Alice Example", "ci-bot"]);
    expect(decodeNames((await bytesOf(deps, "names")).bytes).names.sort()).toEqual(["README.md", "a.ts"]);
    expect(deps.engine.asked).toEqual([]);
    expect(deps.queued).toEqual([]);
  });

  test("answers again with 304, pins a year when the address names the Report, and has another ETag once the pack is another", async () => {
    const deps = await stored();
    const { found } = await bytesOf(deps, "map", 500);
    expect(found.cacheControl).toContain("immutable");
    const again = await atlasFile(deps, viewer(), "acme", "rocket", "map", 500, found.etag);
    expect(again.body).toBeNull();
    const loose = await atlasFile(deps, viewer(), "acme", "rocket", "map", 1);
    expect(loose.cacheControl).toBe("public, max-age=300");
    await packed(deps.db, deps.si, "packs/acme/rocket/1/head-b2-lines.pack");
    expect((await atlasFile(deps, viewer(), "acme", "rocket", "map", 500, found.etag).catch(() => ({ etag: "none" }))).etag).not.toBe(found.etag);
  });

  test("of a pack the Builder made none for is read at the next Build, and the Builder is asked once to make it; the engine service is never asked for rows", async () => {
    const deps = await stored(false);
    expect(await refused(atlasFile(deps, viewer(), "acme", "rocket", "map", null))).toEqual([404, "This repository's history is read at its next Build."]);
    expect(await refused(atlasFile(deps, viewer(), "acme", "rocket", "names", null))).toEqual([404, "This repository's history is read at its next Build."]);
    expect(deps.queued).toEqual([{ repoId: "acme/rocket", si: deps.si, pack: deps.pack }]);
    expect(deps.engine.asked).toEqual([]);
    const { atlas, names } = atlasOf(rows);
    await deps.storage.put(atlasKey(deps.si, deps.pack, "map"), brotliCompressSync(encodeAtlas(atlas)), { type: "application/octet-stream", encoding: "br" });
    await deps.storage.put(atlasKey(deps.si, deps.pack, "names"), brotliCompressSync(encodeNames(names)), { type: "application/octet-stream", encoding: "br" });
    expect(decodeAtlas((await bytesOf(deps, "map")).bytes).people.names).toEqual(["Alice Example", "ci-bot"]);
  });

  test("of a Build's quick pack is drawn once the Build has read the whole history, and nothing is asked for", async () => {
    const deps = await stored(false);
    await packed(deps.db, deps.si, "packs/acme/rocket/1/head-b2-quick.pack");
    expect(await refused(atlasFile(deps, viewer(), "acme", "rocket", "map", null))).toEqual([404, "The Universe is drawn once this Build has read the whole history."]);
    expect(deps.queued).toEqual([]);
  });

  test("is read at the next Build while the Stored Index has no pack", async () => {
    const deps = await stored();
    await deps.db.update(schema.storedIndexes).set({ pack: null }).where(eq(schema.storedIndexes.id, deps.si));
    await expect(atlasFile(deps, viewer(), "acme", "rocket", "map", null)).rejects.toThrow("next Build");
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
