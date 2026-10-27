import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import * as Sentry from "@sentry/tanstackstart-react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CommitQuery, Params } from "@commitscape/data";
import { s3Storage } from "@commitscape/server";
import { ENGINE_DOWN, engineService, httpPost, NoPack, type Blob, type EngineService, type Named, type TreeOf } from "./engine-service";
import { SiteError } from "./http";

const reported: Sentry.ErrorEvent[] = [];
const measured: { name: string; value: number; attributes?: Record<string, unknown> }[] = [];

Sentry.init({
  dsn: "https://public@o0.ingest.sentry.io/0",
  tracesSampleRate: 1,
  transport: () => ({ send: async () => ({}), flush: async () => true }),
  beforeSend: (event) => {
    reported.push(event);
    return null;
  },
  beforeSendMetric: (metric) => {
    measured.push(metric as (typeof measured)[number]);
    return null;
  },
});

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const bin = join(root, "target/release/commitscape");
const engineBin = join(root, "target/release/commitscape-engine");
const goldens = join(root, "apps/engine/tests/golden");
const s3 = process.env.TEST_S3_ENDPOINT;
const TOKEN = "site-test";

const failure = (p: Promise<unknown>) => p.then(() => null, (e: Error) => (e instanceof SiteError ? [e.status, e.message] : e.name));

describe("a request to the engine service", () => {
  test("carries the token, the body as JSON and the trace of the request it is made for", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('{"window":"all"}');
    }) as typeof fetch;
    const engine = engineService("http://engine.test:4100/", TOKEN, { fetcher });
    const traceId = await Sentry.startSpan({ name: "GET /gh/acme/rocket", op: "http.server" }, async (span) => {
      expect(await engine.answer("packs/a.pack", "/api/overview", { window: "all" })).toEqual({ window: "all" });
      return span.spanContext().traceId;
    });
    const [asked] = seen;
    expect(asked?.url).toBe("http://engine.test:4100/v1/answer");
    expect(asked?.init.method).toBe("POST");
    expect(JSON.parse(String(asked?.init.body))).toEqual({ pack: "packs/a.pack", path: "/api/overview", params: { window: "all" } });
    const headers = asked?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["sentry-trace"]?.startsWith(`${traceId}-`)).toBe(true);
    expect(headers.baggage).toContain(`sentry-trace_id=${traceId}`);
    expect(asked?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("turns the engine's failures into the Site's", async () => {
    const answering = (status: number, body: unknown) => httpPost("http://engine.test", TOKEN, { fetcher: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
    expect(await answering(404, { error: "no such answer" })("/v1/answer", { pack: "p" })).toBeNull();
    expect(await failure(answering(404, { error: "no such pack" })("/v1/answer", { pack: "p" }))).toBe("NoPack");
    expect(await failure(answering(400, { error: "not a pack key" })("/v1/answer", { pack: "p" }))).toEqual([400, "not a pack key"]);
    for (const status of [401, 404, 500, 503]) expect(await failure(answering(status, { error: "x" })("/v1/git/log", { pack: "p" }))).toEqual([503, ENGINE_DOWN]);
    const down = httpPost("http://engine.test", TOKEN, { fetcher: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch });
    expect(await failure(down("/v1/answer", { pack: "p" }))).toEqual([503, ENGINE_DOWN]);
    const slow = httpPost("http://engine.test", TOKEN, { timeout: 20, fetcher: ((_: string, init: RequestInit) => new Promise((_, fail) => init.signal?.addEventListener("abort", () => fail(init.signal?.reason)))) as unknown as typeof fetch });
    expect(await failure(slow("/v1/answer", { pack: "p" }))).toEqual([503, ENGINE_DOWN]);
    expect(new NoPack("p").message).toBe("no such pack: p");
  });

  test("reports failures and timeouts to Sentry with their endpoint and pack, and times every request by endpoint and outcome", async () => {
    await Sentry.flush(1000);
    reported.length = 0;
    measured.length = 0;
    const failing = httpPost("http://engine.test", TOKEN, { fetcher: (async () => new Response('{"error":"pack format 1, expected 2"}', { status: 500 })) as unknown as typeof fetch });
    await failure(failing("/v1/git/tree", { pack: "packs/acme/rocket/7/head-b1-lines.pack" }));
    const slow = httpPost("http://engine.test", TOKEN, { timeout: 20, fetcher: ((_: string, init: RequestInit) => new Promise((_, fail) => init.signal?.addEventListener("abort", () => fail(init.signal?.reason)))) as unknown as typeof fetch });
    await failure(slow("/v1/answer", { pack: "packs/acme/rocket/7/head-b1-lines.pack" }));
    const fine = httpPost("http://engine.test", TOKEN, { fetcher: (async () => new Response("{}")) as unknown as typeof fetch });
    await fine("/v1/answer", { pack: "p" });
    await Sentry.flush(1000);
    expect(reported.filter((e) => e.contexts?.engine?.pack === "packs/acme/rocket/7/head-b1-lines.pack").map((e) => [e.tags?.["engine.endpoint"], e.tags?.["engine.outcome"], e.contexts?.engine?.pack, e.contexts?.engine?.status, e.fingerprint])).toEqual([
      ["/v1/git/tree", "failed", "packs/acme/rocket/7/head-b1-lines.pack", 500, ["engine", "/v1/git/tree", "failed"]],
      ["/v1/answer", "timeout", "packs/acme/rocket/7/head-b1-lines.pack", null, ["engine", "/v1/answer", "timeout"]],
    ]);
    expect(reported.find((e) => e.tags?.["engine.endpoint"] === "/v1/git/tree")?.exception?.values?.[0]?.value).toBe("engine /v1/git/tree: failed 500: pack format 1, expected 2");
    const latency = measured.filter((m) => m.name === "engine.latency").map((m) => ({ endpoint: m.attributes?.endpoint, outcome: m.attributes?.outcome }));
    expect(latency).toEqual([
      { endpoint: "/v1/git/tree", outcome: "failed" },
      { endpoint: "/v1/answer", outcome: "timeout" },
      { endpoint: "/v1/answer", outcome: "ok" },
    ]);
  });

  test("gives the large files as text, and their missing answers as a 404", async () => {
    const engine = engineService("http://engine.test", TOKEN, { fetcher: (async (url: string) => (String(url).endsWith("/v1/git/log") ? new Response('{"v":1}') : new Response('{"error":"no such answer"}', { status: 404 }))) as unknown as typeof fetch });
    expect(await engine.logText("p")).toBe('{"v":1}');
    expect(await failure(engine.couplingText("p"))).toEqual([404, "No such answer."]);
  });
});

const why = !existsSync(bin) || !existsSync(engineBin) ? "build the binaries first: cargo build --release -p commitscape -p commitscape-engine" : !existsSync(join(root, "fixtures/crafted/.git")) ? "build the fixtures first: cargo xtask fixtures --force" : null;

type Golden = { fixture: string; flags: string[]; anchor: number; asked: [string, Record<string, unknown>, number][]; answers: unknown[] };

const goldenOf = (name: string): Golden => JSON.parse(gunzipSync(readFileSync(join(goldens, `${name}.json.gz`))).toString("utf8")) as Golden;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

type Running = { base: string; process: ChildProcess };

async function startEngine(env: Record<string, string>): Promise<Running> {
  const port = await freePort();
  const child = spawn(engineBin, [], { env: { PATH: process.env.PATH ?? "", RUST_LOG: "warn", COMMITSCAPE_THREADS: "2", ENGINE_TOKEN: TOKEN, PORT: String(port), ...env }, stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`commitscape-engine exited with ${child.exitCode}`);
    if (await fetch(`${base}/healthz`).then((r) => r.ok, () => false)) return { base, process: child };
    await new Promise((done) => setTimeout(done, 50));
  }
  child.kill();
  throw new Error("commitscape-engine did not start");
}

async function stopEngine(running: Running | null): Promise<void> {
  if (!running || running.process.exitCode !== null) return;
  const exited = new Promise((done) => running.process.once("exit", done));
  running.process.kill("SIGTERM");
  await exited;
}

function buildPack(golden: Golden, into: string, key: string): void {
  const work = mkdtempSync(join(tmpdir(), "engine-service-"));
  const out = join(work, "build");
  execFileSync(bin, ["build", "--offline", "--anchor", String(golden.anchor), "--cache-dir", join(work, "cache"), "--out", out, ...golden.flags, "--", join(root, "fixtures", golden.fixture)], { stdio: "ignore" });
  mkdirSync(join(into, key, ".."), { recursive: true });
  copyFileSync(join(out, "pack.bin"), join(into, key));
}

async function ask(engine: EngineService, pack: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const b = body as { path: string; params: Params; blobs: Record<string, Blob>; of: TreeOf; page: number; query: CommitQuery; cursor?: string; said: string[] | null; number: number; paths: string[]; author: string | null; named: Named[] };
  switch (endpoint) {
    case "/v1/answer":
      return engine.answer(pack, b.path, b.params ?? {});
    case "/v1/git/tree":
      return JSON.parse(await engine.treeText(pack, b.blobs, b.of));
    case "/v1/git/log":
      return JSON.parse(await engine.logText(pack));
    case "/v1/git/coupling":
      return JSON.parse(await engine.couplingText(pack));
    case "/v1/git/path-history":
      return engine.pathHistory(pack, b.path);
    case "/v1/git/folder-last":
      return engine.folderLast(pack, b.path);
    case "/v1/code/story":
      return engine.story(pack, b.path);
    case "/v1/code/log":
      return engine.codeLog(pack, b.path, b.page);
    case "/v1/commits/under":
      return engine.under(pack, b.path, b.query, b.cursor, b.said ?? null);
    case "/v1/commits/search":
      return engine.search(pack, b.query, b.cursor);
    case "/v1/pulls/insight":
      return engine.insight(pack, b.number, b.paths, b.author, b.named);
    case "/v1/universe/rows":
      return engine.universeRows(pack);
    default:
      throw new Error(`no call for ${endpoint}`);
  }
}

describe.skipIf(why !== null)(`the Site's engine client against a running engine, on packs commitscape builds${why ? ` (skipped: ${why})` : ""}`, () => {
  const packs = mkdtempSync(join(tmpdir(), "engine-service-packs-"));
  let running: Running | null = null;

  beforeAll(async () => {
    running = await startEngine({ PACK_SOURCE: `dir:${packs}`, PACK_DIR: join(packs, ".kept") });
  });

  afterAll(() => stopEngine(running));

  test.each(["linear", "lines-with-no-time-to-count", "merges-with-tags", "crafted"])("every question of the %s goldens is answered as the goldens say", async (name) => {
    if (!running) throw new Error("no engine");
    const golden = goldenOf(name);
    const key = `packs/golden/${name}/1/pack-${name}-lines.pack`;
    buildPack(golden, packs, key);
    const engine = engineService(running.base, TOKEN);
    const differences: string[] = [];
    for (const [endpoint, body, at] of golden.asked) {
      const got = await ask(engine, key, endpoint, body);
      try {
        expect(got).toEqual(golden.answers[at]);
      } catch {
        differences.push(`${endpoint} ${JSON.stringify(body).slice(0, 200)}`);
        if (differences.length >= 8) break;
      }
    }
    expect(differences).toEqual([]);
    await expect(engine.answer(`${key}.gone`, "/api/overview", {})).rejects.toBeInstanceOf(NoPack);
  }, 300_000);

  test.skipIf(!s3)("a pack in the bucket is read through a signed GET, as in production", async () => {
    if (!s3) return;
    const bucket = "commitscape-reports";
    const golden = goldenOf("linear");
    const key = `packs/engine-service-test/${Date.now()}/pack.pack`;
    buildPack(golden, packs, key);
    const storage = s3Storage({ endpoint: s3, bucket, accessKeyId: "commitscape", secretAccessKey: "commitscape", forcePathStyle: true });
    await storage.put(key, readFileSync(join(packs, key)), { type: "application/octet-stream" });
    const fromBucket = await startEngine({ S3_ENDPOINT: s3, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: "commitscape", S3_SECRET_ACCESS_KEY: "commitscape", S3_FORCE_PATH_STYLE: "true", PACK_DIR: mkdtempSync(join(tmpdir(), "engine-service-s3-")) });
    try {
      const engine = engineService(fromBucket.base, TOKEN);
      const asked = golden.asked.filter(([endpoint]) => endpoint === "/v1/answer").slice(0, 40);
      for (const [endpoint, body, at] of asked) expect(await ask(engine, key, endpoint, body)).toEqual(golden.answers[at]);
      expect(await engine.warm(key, ["/api/stats", "/api/overview?window=all", "/api/nothing"])).toBe(2);
      await expect(engine.answer(`${key}.missing`, "/api/overview", {})).rejects.toBeInstanceOf(NoPack);
    } finally {
      await stopEngine(fromBucket);
      await storage.delete([key]);
    }
  }, 300_000);
});
