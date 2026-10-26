import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { key, limited, OVERVIEW_TOP, topOf, type People, type Params } from "@commitscape/data";
import { now, schema, seedIndex, sha256, storeReport, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, testDeps, viewer, type Asked } from "#/test/deps";
import { forgetPack, packOf, wholeDays } from "./answers";
import { NoPack } from "./engine-service";
import { SiteError } from "./http";
import { RANGE_LIMIT } from "./limits";
import { bodyOf, encodingOf } from "./packed";
import { reportAnswer, reportEntry } from "./repos";
import { firstAnswers, warmLoaded } from "./warm";

const { rateLimits, repositories, storedIndexes } = schema;

const DAY = 86_400;

const seed: SeedIndex = {
  anchor: 40 * DAY,
  persons: [{ id: 3, name: "Alice Example", login: "alice" }],
  files: [{ file: 0, path: "a.ts" }],
  commits: [{ sha: "a1".repeat(20), at: 10 * DAY, person: 3, subject: "one", files: [0] }],
};

const people = { window: "all", people: [{ person: { id: 3, name: "Alice" } }, { person: { id: 4, name: "Bob" } }], bots: [], suspects: [] };

function answering({ endpoint, body }: Asked): unknown {
  if (endpoint === "/v1/warm") return { made: (body.keys as string[]).length };
  if (endpoint !== "/v1/answer") return undefined;
  const params = body.params as Params;
  if (body.path === "/api/overview") return params.from !== undefined ? { window: "range", commits: 2 } : { window: params.window ?? "all", commits: 3 };
  if (body.path === "/api/people") return limited("/api/people", topOf(params), people);
  return undefined;
}

const overview = key("/api/overview", { window: "all" });

async function stored(handle: (asked: Asked) => unknown = answering) {
  const engine = fakeEngine(handle);
  const deps = await testDeps({ engine });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/old", owner: "acme", name: "old", githubId: 2, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/old/b1", reportAt: 700 },
  ]);
  const si = await seedIndex(deps.db, "acme/rocket", seed);
  const pack = await packed(deps.db, si);
  const meta = { name: "old", windows: ["all"], window: "all", anchor: 0, history: "full", lines: "counted", avatars: false };
  await storeReport(deps.storage, "reports/gh/acme/old/b1", gzipSync(JSON.stringify({ meta, data: { "/api/people?window=all": { ...people, people: [{ person: { name: "Ann" } }, { person: { name: "Ben" } }] } } })));
  return { deps, si, pack, engine };
}

const brotliJson = async (sent: Awaited<ReturnType<typeof reportAnswer>>) => JSON.parse(brotliDecompressSync((await sent.packed?.br) ?? new Uint8Array()).toString()) as unknown;

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("a Report's answers as plain JSON", () => {
  test("are asked of the engine service with the Stored Index's pack once, the same as the server's pages get, and kept for good when pinned to the Report", async () => {
    const { deps, pack, engine } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500);
    expect(sent.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(await brotliJson(sent)).toEqual({ window: "all", commits: 3 });
    expect(engine.asked).toEqual([{ endpoint: "/v1/answer", body: { pack, path: "/api/overview", params: { window: "all" } } }]);
    expect(await reportEntry(deps, viewer(), "acme", "rocket", overview)).toEqual({ window: "all", commits: 3 });
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", overview, 1)).cacheControl).toBe("public, max-age=60");
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", overview, null)).packed).toBe(sent.packed);
    expect(engine.asked).toHaveLength(1);
  });

  test("answer an ETag they gave with no body, whatever params the answer does not depend on, and another once the pack is another", async () => {
    const { deps, si, engine } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500);
    const again = await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/overview", { window: "all", person: 3, folder: "src/" }), 500, `W/${sent.etag}`);
    expect(again.packed).toBeNull();
    expect(again.etag).toBe(sent.etag);
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all" }), 500, sent.etag)).packed).not.toBeNull();
    await packed(deps.db, si, "packs/test/next.pack");
    const fresh = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500, sent.etag);
    expect(fresh.etag).not.toBe(sent.etag);
    expect(engine.asked.at(-1)?.body.pack).toBe("packs/test/next.pack");
  });

  test("cut to the first people asked for, as the engine cuts them", async () => {
    const { deps } = await stored();
    const whole = (await reportEntry(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all" }))) as People;
    const cut = (await brotliJson(await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all", top: 1 }), 500))) as People & { count: number };
    expect(whole.people).toHaveLength(2);
    expect(cut).toEqual({ ...whole, people: whole.people.slice(0, 1), count: 2 });
  });

  test("come from the stored Report of a repository without a pack, cut the same way", async () => {
    const { deps, engine } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "old", key("/api/people", { window: "all", top: 1 }), 700);
    expect(await brotliJson(sent)).toMatchObject({ people: [{ person: { name: "Ann" } }], count: 2 });
    expect(await reportEntry(deps, viewer(), "acme", "old", key("/api/people", { window: "all" }))).toMatchObject({ people: [{}, {}] });
    expect(await failure(reportAnswer(deps, viewer(), "acme", "old", key("/api/activity", { window: "all" }), 700))).toEqual([404, expect.stringContaining("without it")]);
    expect(await reportEntry(deps, viewer(), "acme", "old", key("/api/activity", { window: "all" }))).toBeNull();
    const si = await seedIndex(deps.db, "acme/old", seed);
    expect(await reportEntry(deps, viewer(), "acme", "old", key("/api/people", { window: "all" }))).toMatchObject({ people: [{ person: { name: "Ann" } }, {}] });
    expect(await packOf(deps.db, si, { waits: 0 })).toBeNull();
    expect(engine.asked).toEqual([]);
  });

  test("say an answer the engine does not have is not in the Report", async () => {
    const { deps } = await stored();
    expect(await failure(reportAnswer(deps, viewer(), "acme", "rocket", key("/api/activity", { window: "all" }), 500))).toEqual([404, expect.stringContaining("without it")]);
    expect(await reportEntry(deps, viewer(), "acme", "rocket", key("/api/activity", { window: "all" }))).toBeNull();
  });

  test("ask again with the pack a newer publish left when the engine no longer has the one read", async () => {
    let si = 0;
    const { deps, engine } = await stored(async (asked) => {
      if (asked.body.pack === "packs/test/gone.pack") {
        await packed(deps.db, si, "packs/test/new.pack");
        throw new NoPack(String(asked.body.pack));
      }
      return answering(asked);
    });
    si = (await deps.db.select({ id: storedIndexes.id }).from(storedIndexes))[0]?.id ?? 0;
    await packed(deps.db, si, "packs/test/gone.pack");
    expect(await reportEntry(deps, viewer(), "acme", "rocket", overview)).toEqual({ window: "all", commits: 3 });
    expect(engine.asked.map((a) => a.body.pack)).toEqual(["packs/test/gone.pack", "packs/test/new.pack"]);
  });

  test("wait a moment for the pack of a Stored Index a Build has just loaded", async () => {
    const { deps, si, engine } = await stored();
    await deps.db.update(storedIndexes).set({ pack: null, loadedAt: now() }).where(eq(storedIndexes.id, si));
    setTimeout(() => void packed(deps.db, si, "packs/test/published.pack"), 300);
    expect(await reportEntry(deps, viewer(), "acme", "rocket", overview)).toEqual({ window: "all", commits: 3 });
    expect(engine.asked.map((a) => a.body.pack)).toEqual(["packs/test/published.pack"]);
    await deps.db.update(storedIndexes).set({ pack: null, loadedAt: now() - 3600 }).where(eq(storedIndexes.id, si));
    expect(await packOf(deps.db, si)).toBe("packs/test/published.pack");
    forgetPack(deps.db, si);
    const started = Date.now();
    expect(await packOf(deps.db, si)).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("a range of dates only as whole days, and only so many new ones an hour from one address", async () => {
    const { deps } = await stored();
    const range = (from: number, to: number) => key("/api/overview", { from, to });
    expect(await brotliJson(await reportAnswer(deps, viewer(), "acme", "rocket", range(5 * DAY, 25 * DAY - 1), 500))).toMatchObject({ window: "range", commits: 2 });
    expect(await failure(reportAnswer(deps, viewer(), "acme", "rocket", range(5 * DAY + 7, 25 * DAY - 1), 500))).toEqual([400, expect.stringContaining("start of one day")]);
    expect(await failure(reportEntry(deps, viewer(), "acme", "rocket", range(5 * DAY, 25 * DAY)))).toEqual([400, expect.stringContaining("start of one day")]);
    const address = viewer().address;
    const window = Math.floor(now() / RANGE_LIMIT.seconds);
    await deps.db.insert(rateLimits).values({ key: `${RANGE_LIMIT.action}:${sha256(`${RANGE_LIMIT.action}:${address}`)}:${window}`, count: RANGE_LIMIT.max, until: (window + 1) * RANGE_LIMIT.seconds }).onConflictDoUpdate({ target: rateLimits.key, set: { count: RANGE_LIMIT.max } });
    expect(await failure(reportAnswer(deps, viewer(), "acme", "rocket", range(6 * DAY, 25 * DAY - 1), 500))).toEqual([429, expect.stringContaining("date ranges")]);
    expect(await reportAnswer(deps, viewer(), "acme", "rocket", range(5 * DAY, 25 * DAY - 1), 500)).toMatchObject({ cacheControl: "public, max-age=31536000, immutable" });
    expect(await reportAnswer(deps, viewer({ address: "198.51.100.1" }), "acme", "rocket", range(6 * DAY, 25 * DAY - 1), 500)).toMatchObject({ etag: expect.any(String) });
  });

  test("refuse what is not a question to a Report", async () => {
    const { deps } = await stored();
    expect(await failure(reportAnswer(deps, viewer(), "acme", "rocket", "/etc/passwd", 500))).toEqual([400, expect.any(String)]);
  });
});

describe("a packed body", () => {
  test("is sent as brotli, else gzip, else as it is, as the request accepts", async () => {
    const { deps } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500);
    const body = sent.packed;
    if (!body) throw new Error("not packed");
    expect(encodingOf("gzip, deflate, br")).toBe("br");
    expect(encodingOf("gzip, br;q=0")).toBe("gzip");
    expect(encodingOf(null)).toBe("identity");
    const gz = await bodyOf(body, "gzip");
    expect(gz.encoding).toBe("gzip");
    expect(JSON.parse(gunzipSync(gz.body as Uint8Array).toString())).toMatchObject({ commits: 3 });
    const plain = await bodyOf(body, "identity");
    expect(JSON.parse(typeof plain.body === "string" ? plain.body : new TextDecoder().decode(plain.body))).toMatchObject({ commits: 3 });
  });

  test("whole days run from the start of one day to the end of another", () => {
    expect(wholeDays({ from: 2 * DAY, to: 3 * DAY - 1 })).toBe(true);
    expect(wholeDays({ from: 2 * DAY })).toBe(true);
    expect(wholeDays({ from: 2 * DAY + 1 })).toBe(false);
    expect(wholeDays({ to: 3 * DAY })).toBe(false);
    expect(wholeDays({ from: "soon" })).toBe(false);
  });
});

describe("warming", () => {
  test("a Stored Index a Build loaded or published has the engine read its pack and first answers when its repository was viewed lately, and not otherwise", async () => {
    const { deps, si, pack, engine } = await stored();
    const w = { db: deps.db, storage: deps.storage, engine };
    expect(firstAnswers("1y")).toContain(key("/api/overview", { window: "1y", top: OVERVIEW_TOP }));
    expect(await warmLoaded(w, si + 100)).toBe(false);
    expect(await warmLoaded(w, si)).toBe(false);
    expect(engine.asked).toEqual([]);
    await deps.db.update(repositories).set({ viewedAt: now() }).where(eq(repositories.id, "acme/rocket"));
    expect(await warmLoaded(w, si)).toBe(true);
    expect(engine.asked).toEqual([
      { endpoint: "/v1/warm", body: { pack, keys: firstAnswers("all") } },
      { endpoint: "/v1/universe/rows", body: { pack } },
    ]);
    await deps.db.update(storedIndexes).set({ pack: null }).where(eq(storedIndexes.id, si));
    engine.asked.length = 0;
    expect(await warmLoaded(w, si)).toBe(false);
    expect(engine.asked).toEqual([]);
  });
});
