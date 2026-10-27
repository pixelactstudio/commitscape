import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { atlasOf, decodeAtlas, decodeNames, encodeAtlas, encodeNames, type AtlasRows } from "@commitscape/data/universe";
import { atlasKey, now, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, testDeps, viewer, type Asked } from "#/test/deps";
import { SiteError } from "./http";
import { atlasBody, atlasFile, atlasOfPack, warmAtlas } from "./universe";

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

const answering = ({ endpoint }: Asked) => (endpoint === "/v1/universe/rows" ? rows : undefined);

async function stored() {
  const engine = fakeEngine(answering);
  const deps = await testDeps({ engine });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
  ]);
  const si = await seedIndex(deps.db, "acme/rocket", seed);
  const pack = await packed(deps.db, si, "packs/acme/rocket/1/pack.pack");
  await packed(deps.db, await seedIndex(deps.db, "acme/secret", seed), "packs/acme/secret/2/pack.pack");
  return Object.assign(deps, { engine, si, pack });
}

const bytesOf = async (deps: Awaited<ReturnType<typeof stored>>, part: "map" | "names", v: number | null = null) => {
  const found = await atlasFile(deps, viewer(), "acme", "rocket", part, v);
  if (!found.body) throw new Error("no body");
  return { found, bytes: new Uint8Array(brotliDecompressSync(found.body.br)) };
};

describe("the Atlas", () => {
  test("is made from the rows the engine service reads from the Stored Index's pack, once per pack", async () => {
    const deps = await stored();
    const atlas = decodeAtlas((await bytesOf(deps, "map")).bytes);
    expect(Array.from(atlas.commits.time)).toEqual([100, 300]);
    expect(atlas.people.names).toEqual(["Alice Example", "ci-bot"]);
    expect(decodeNames((await bytesOf(deps, "names")).bytes).names.sort()).toEqual(["README.md", "a.ts"]);
    expect(deps.engine.asked).toEqual([{ endpoint: "/v1/universe/rows", body: { pack: deps.pack } }]);
  });

  test("answers again with 304, pins a year when the address names the Report, and keeps what it made", async () => {
    const deps = await stored();
    const { found } = await bytesOf(deps, "map", 500);
    expect(found.cacheControl).toContain("immutable");
    const again = await atlasFile(deps, viewer(), "acme", "rocket", "map", 500, found.etag);
    expect(again.body).toBeNull();
    const loose = await atlasFile(deps, viewer(), "acme", "rocket", "map", 1);
    expect(loose.cacheControl).toBe("public, max-age=300");
    await (await atlasOfPack(deps, deps.si, deps.pack)).kept;
    expect((await deps.storage.keys?.("atlas/"))?.length ?? 0).toBeGreaterThanOrEqual(2);
    await packed(deps.db, deps.si, "packs/acme/rocket/1/next.pack");
    expect((await atlasFile(deps, viewer(), "acme", "rocket", "map", 500, found.etag)).etag).not.toBe(found.etag);
  });

  test("the Builder stored for a pack is sent as it is, and the Site never makes it or asks the engine service for rows", async () => {
    const deps = await stored();
    const { atlas, names } = atlasOf(rows);
    const map = brotliCompressSync(encodeAtlas(atlas));
    await deps.storage.put(atlasKey(deps.si, deps.pack, "map"), map, { type: "application/octet-stream", encoding: "br" });
    await deps.storage.put(atlasKey(deps.si, deps.pack, "names"), brotliCompressSync(encodeNames(names)), { type: "application/octet-stream", encoding: "br" });
    expect(await warmAtlas(deps, deps.si, deps.pack)).toBe(true);
    const { found, bytes } = await bytesOf(deps, "map");
    expect(Buffer.from(found.body?.br ?? new Uint8Array()).equals(map)).toBe(true);
    expect(decodeAtlas(bytes).people.names).toEqual(["Alice Example", "ci-bot"]);
    expect(deps.engine.asked).toEqual([]);
  });

  test("of a Build's quick pack is never made by the Site: the full pack brings it", async () => {
    const deps = await stored();
    const quick = await packed(deps.db, deps.si, "packs/acme/rocket/1/head-b2-quick.pack");
    expect(await warmAtlas(deps, deps.si, quick)).toBe(false);
    const asked = await atlasFile(deps, viewer(), "acme", "rocket", "map", null).then(
      () => null,
      (e: SiteError) => [e.status, e.message],
    );
    expect(asked).toEqual([404, "The Universe is drawn once this Build has read the whole history."]);
    expect(deps.engine.asked).toEqual([]);
  });

  test("is made ahead of its first visitor, and what the Stored Index's earlier packs left in storage is deleted", async () => {
    const deps = await stored();
    await deps.storage.put(`atlas/${deps.si}/0000000000000000/map.bin.br`, "old", { type: "application/octet-stream" });
    expect(await warmAtlas(deps, deps.si, deps.pack)).toBe(true);
    const kept = (await deps.storage.keys?.(`atlas/${deps.si}/`)) ?? [];
    expect(kept.length).toBe(2);
    expect(kept.some((k) => k.includes("0000000000000000"))).toBe(false);
    const again = await atlasFile(deps, viewer(), "acme", "rocket", "map", null);
    expect(again.body).not.toBeNull();
    expect(deps.engine.asked).toHaveLength(1);
  });

  test("is sent packed quickly at once, then packed as small as brotli makes it, which is stored and sent from then on, the same bytes once unpacked", async () => {
    const deps = await stored();
    const built = await atlasOfPack(deps, deps.si, deps.pack);
    const first = built.map.br;
    const raw = brotliDecompressSync(first);
    expect(first).toEqual(new Uint8Array(brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength } })));
    await built.kept;
    const kept = await deps.storage.get(`atlas/${deps.si}/${(await deps.storage.keys?.(`atlas/${deps.si}/`))?.[0]?.split("/")[2]}/map.bin.br`);
    expect(kept?.body).toEqual(built.map.br);
    expect(built.map.br.byteLength).toBeLessThanOrEqual(first.byteLength);
    expect(brotliDecompressSync(built.map.br)).toEqual(raw);
    expect(brotliDecompressSync(built.names.br).byteLength).toBeGreaterThan(0);
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
