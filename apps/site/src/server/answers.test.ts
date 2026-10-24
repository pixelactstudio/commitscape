import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { key, OVERVIEW_TOP, type Overview, type People } from "@commitscape/data";
import { now, schema, seedIndex, sha256, storeReport, type SeedIndex } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { analysisBytes, holds, keptAnswer, sizeOf, viewOf, wholeDays } from "./answers";
import { SiteError } from "./http";
import { RANGE_LIMIT } from "./limits";
import { bodyOf, encodingOf } from "./packed";
import { reportAnswer, reportEntry } from "./repos";
import { firstAnswers, warmLoaded } from "./warm";

const { rateLimits, repositories } = schema;

const DAY = 86_400;

const seed: SeedIndex = {
  anchor: 40 * DAY,
  persons: [
    { id: 3, name: "Alice Example", login: "alice" },
    { id: 4, name: "Bob Example", login: "bob" },
  ],
  files: [
    { file: 0, path: "a.ts" },
    { file: 1, path: "b.ts" },
  ],
  commits: [
    { sha: "a1".repeat(20), at: 10 * DAY, person: 3, subject: "one", files: [0] },
    { sha: "b2".repeat(20), at: 20 * DAY, person: 4, subject: "two", files: [1] },
    { sha: "c3".repeat(20), at: 30 * DAY, person: 3, subject: "three", files: [0, 1] },
  ],
};

const overview = key("/api/overview", { window: "all" });

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/old", owner: "acme", name: "old", githubId: 2, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/old/b1", reportAt: 700 },
  ]);
  const si = await seedIndex(deps.db, "acme/rocket", seed);
  const people = { window: "all", people: [{ person: { id: 1, name: "Ann" } }, { person: { id: 2, name: "Ben" } }], bots: [], suspects: [] };
  const meta = { name: "old", windows: ["all"], window: "all", anchor: 0, history: "full", lines: "counted", avatars: false };
  await storeReport(deps.storage, "reports/gh/acme/old/b1", gzipSync(JSON.stringify({ meta, data: { "/api/people?window=all": people } })));
  return { deps, si };
}

const brotliJson = async (sent: Awaited<ReturnType<typeof reportAnswer>>) => JSON.parse(brotliDecompressSync((await sent.packed?.br) ?? new Uint8Array()).toString()) as unknown;

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("a Report's answers as plain JSON", () => {
  test("are worked out from the Stored Index once, the same as the server's pages get, and kept for good when pinned to the Report", async () => {
    const { deps } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500);
    expect(sent.cacheControl).toBe("public, max-age=31536000, immutable");
    const body = (await brotliJson(sent)) as Overview;
    expect(body).toMatchObject({ window: "all", commits: 3 });
    expect(body).toEqual(await reportEntry(deps, viewer(), "acme", "rocket", overview));
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", overview, 1)).cacheControl).toBe("public, max-age=60");
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", overview, null)).packed).toBe(sent.packed);
  });

  test("answer an ETag they gave with no body, whatever params the answer does not depend on", async () => {
    const { deps } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "rocket", overview, 500);
    const again = await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/overview", { window: "all", person: 3, folder: "src/" }), 500, `W/${sent.etag}`);
    expect(again.packed).toBeNull();
    expect(again.etag).toBe(sent.etag);
    expect((await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all" }), 500, sent.etag)).packed).not.toBeNull();
  });

  test("cut to the first people asked for, saying how many there are", async () => {
    const { deps } = await stored();
    const whole = (await reportEntry(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all" }))) as People;
    const cut = (await brotliJson(await reportAnswer(deps, viewer(), "acme", "rocket", key("/api/people", { window: "all", top: 1 }), 500))) as People & { count: number };
    expect(whole.people).toHaveLength(2);
    expect(cut).toEqual({ ...whole, people: whole.people.slice(0, 1), count: 2 });
  });

  test("come from the stored Report when there is no Stored Index, cut the same way", async () => {
    const { deps } = await stored();
    const sent = await reportAnswer(deps, viewer(), "acme", "old", key("/api/people", { window: "all", top: 1 }), 700);
    expect(await brotliJson(sent)).toMatchObject({ people: [{ person: { name: "Ann" } }], count: 2 });
    expect(await reportEntry(deps, viewer(), "acme", "old", key("/api/people", { window: "all" }))).toMatchObject({ people: [{}, {}] });
    expect(await failure(reportAnswer(deps, viewer(), "acme", "old", key("/api/activity", { window: "all" }), 700))).toEqual([404, expect.stringContaining("without it")]);
    expect(await reportEntry(deps, viewer(), "acme", "old", key("/api/activity", { window: "all" }))).toBeNull();
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
    const packed = sent.packed;
    if (!packed) throw new Error("not packed");
    expect(encodingOf("gzip, deflate, br")).toBe("br");
    expect(encodingOf("gzip, br;q=0")).toBe("gzip");
    expect(encodingOf(null)).toBe("identity");
    const gz = await bodyOf(packed, "gzip");
    expect(gz.encoding).toBe("gzip");
    expect(JSON.parse(gunzipSync(gz.body as Uint8Array).toString())).toMatchObject({ commits: 3 });
    const plain = await bodyOf(packed, "identity");
    expect(JSON.parse(typeof plain.body === "string" ? plain.body : new TextDecoder().decode(plain.body))).toMatchObject({ commits: 3 });
  });
});

describe("the memory answers take", () => {
  test("a view counts its columns and strings, and each Analysis kept beside it", async () => {
    const { deps, si } = await stored();
    const view = await viewOf(deps.db, si);
    if (!view) throw new Error("no view");
    expect(sizeOf(view)).toBeGreaterThan(view.file.byteLength + view.time.byteLength + view.ids.join("").length);
    expect(analysisBytes(view)).toBeGreaterThan(64 * 1024);
    await keptAnswer(deps.db, si, overview);
    expect(holds(si)).toBe(true);
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
  test("a Stored Index a Build loaded is read with its first answers when its repository was viewed lately, and not otherwise", async () => {
    const { deps, si } = await stored();
    expect(firstAnswers("1y")).toContain(key("/api/overview", { window: "1y", top: OVERVIEW_TOP }));
    expect(await warmLoaded(deps.db, deps.storage, si + 100)).toBe(false);
    expect(await warmLoaded(deps.db, deps.storage, si)).toBe(holds(si));
    await deps.db.update(repositories).set({ viewedAt: now() }).where(eq(repositories.id, "acme/rocket"));
    expect(await warmLoaded(deps.db, deps.storage, si)).toBe(true);
    expect(holds(si)).toBe(true);
  });
});
