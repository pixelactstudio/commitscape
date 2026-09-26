// The CPU each API handler takes (ADR-0014: well under 10 ms on the free
// plan). Runs the real handlers in Node against SQLite, an in-memory R2
// and canned GitHub and Builder answers, timing each request with
// process.cpuUsage(). An upper bound: here SQLite's work is on our CPU too,
// which D1's never is on Cloudflare, so the Worker's own share, without
// SQLite, is shown too, and is what must stay under 10 ms. Anything a run needs first (a fresh
// Build, a signed request) is made outside the timed part.
//
//   pnpm exec vitest run --config scripts/vitest.config.ts
import { createHmac, generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { SIGNATURE, sign } from "@commitscape/data";
import { api } from "../src/api";
import { page } from "../src/api/builds";
import { sha256 } from "../src/api/http";
import { boardsIfOld } from "../src/api/boards";
import { expire } from "../src/api/shares";
import { seal } from "../src/api/crypto";
import { sqlite, testD1 } from "../src/test/d1";
import { testR2 } from "../src/test/r2";

const SECRET = "cpu-secret-cpu-secret-cpu-secret-cpu";
type Case = { name: string; request: (i: number) => Promise<Request>; before?: (i: number) => Promise<void>; handler?: "api" | "page" };

const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} } as unknown as ExecutionContext;

async function measure(env: Env, c: Case, runs = 200) {
  const times: number[] = [];
  const own: number[] = [];
  let status = 0;
  for (let i = 0; i < runs + 20; i++) {
    await c.before?.(i);
    const request = await c.request(i);
    const before = process.cpuUsage();
    const inSqlite = sqlite.ms;
    const response = c.handler === "page" ? await page(request, env) : await api(request, env, ctx);
    await response.arrayBuffer();
    const used = process.cpuUsage(before);
    status = response.status;
    if (i >= 20) {
      times.push((used.user + used.system) / 1000);
      own.push((used.user + used.system) / 1000 - (sqlite.ms - inSqlite));
    }
  }
  const at = (list: number[], q: number) => list.sort((a, b) => a - b)[Math.floor(list.length * q)] ?? 0;
  return { median: at(times, 0.5), p99: at(times, 0.99), own: at(own, 0.5), ownP99: at(own, 0.99), status };
}

const recorded = readFileSync(join(import.meta.dirname, "../e2e/github/acme-ownership.json"), "utf8");
const report = readFileSync(process.env.REPORT_FILE ?? "../../target/ownership.json.gz");

test("every handler's CPU time", async () => {
  // GitHub and the Builder, answered at once.
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/builds")) return new Response('{"queued":1}', { status: 202 });
    if (url.includes("/login/oauth/access_token")) return new Response('{"access_token":"ghu_x","expires_in":28800,"refresh_token":"ghr_x"}');
    if (url.endsWith("/user")) return new Response('{"id":1001,"login":"alice","name":"Alice","avatar_url":"https://a/a.png"}');
    if (url.includes("/user/installations/")) return new Response(JSON.stringify({ repositories: Array.from({ length: 30 }, (_, i) => ({ full_name: `acme/r${i}`, private: true, description: "d" })) }));
    if (url.includes("/user/installations")) return new Response('{"installations":[{"id":42,"account":{"login":"acme"}}]}');
    if (url.endsWith("/installation")) return new Response('{"id":42}');
    if (url.includes("/access_tokens")) return new Response('{"token":"ghs_x"}', { status: 201 });
    if (url.endsWith("/languages")) return new Response('{"Rust":120000,"Shell":900}');
    if (url.includes("/contributors")) return new Response(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ login: `p${i}`, avatar_url: "https://a/b", contributions: 100 - i }))));
    if (url.includes("/releases")) return new Response(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ name: `v${i}`, tag_name: `v${i}`, published_at: "2026-01-01T00:00:00Z" }))));
    const name = url.split("/repos/")[1] ?? "acme/ownership";
    return new Response(recorded.replace('"acme/ownership"', JSON.stringify(name)));
  });
  const shell = "<!doctype html><html><head><title>commitscape</title></head><body><div id=root></div></body></html>";
  const env = {
    DB: testD1(),
    REPORTS: testR2(),
    ASSETS: { fetch: async () => new Response(shell, { headers: { "content-type": "text/html" } }) },
    BUILDER_URL: "http://builder",
    GITHUB_API: "http://github",
    BUILDER_SECRET: SECRET,
    GITHUB_TOKEN: "",
    GITHUB_OAUTH: "http://github",
    GITHUB_APP_ID: "777",
    GITHUB_APP_CLIENT_ID: "Iv1.x",
    GITHUB_APP_CLIENT_SECRET: "s",
    GITHUB_APP_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    GITHUB_WEBHOOK_SECRET: "hook",
    SESSION_KEY: "k".repeat(40),
  } as unknown as Env;
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  await env.REPORTS.put("reports/gh/acme/ownership/b.json.gz", report);
  await env.REPORTS.put("cards/gh/acme/ownership/b.png", new Uint8Array(40_000));
  await env.REPORTS.put("pages/gh/acme/ownership.html", shell);
  await db
    .prepare(
      "INSERT INTO repositories (id, owner, name, status, facts, facts_at, size_kb, report_key, report_at, report_bytes, card_key, page_key) VALUES ('acme/ownership','acme','ownership','ok',?1,?2,12,'reports/gh/acme/ownership/b.json.gz',?2,?3,'cards/gh/acme/ownership/b.png','pages/gh/acme/ownership.html')",
    )
    .bind(recorded, now, report.length)
    .run();
  const token = "t".repeat(43);
  const newBuild = async (id: string, withReport = false) =>
    db
      .prepare("INSERT OR REPLACE INTO builds (id, repo_id, state, requested_at, upload_hash, report_key, report_bytes) VALUES (?1, 'acme/ownership', 'running', ?2, ?3, ?4, ?5)")
      .bind(id, now, await sha256(token), withReport ? "reports/gh/acme/ownership/b.json.gz" : null, withReport ? report.length : null)
      .run();
  await newBuild("build-running");
  const signed = async (method: string, path: string, content: string, init: RequestInit = {}) =>
    new Request(`http://site${path}`, { method, ...init, headers: { ...(init.headers as Record<string, string>), [SIGNATURE]: await sign(SECRET, method, path, content) } });
  const upload = new Uint8Array(200_000);
  // A signed-in person, and a Connected Repository with its Report.
  const cookieSecret = "c".repeat(43);
  await db.prepare("INSERT INTO users (id, login, created_at) VALUES ('1001', 'alice', ?1)").bind(now).run();
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, github_token) VALUES (?1, '1001', ?2, ?3, ?4)")
    .bind(await sha256(cookieSecret), now, now + 86400, await seal("k".repeat(40), "ghu_x"))
    .run();
  await env.REPORTS.put("reports/gh/acme/private/b.json.gz", report);
  await db
    .prepare("INSERT INTO repositories (id, owner, name, status, private, facts, facts_at, size_kb, report_key, report_at, report_bytes, installation_id, connected_by) VALUES ('acme/private','acme','private','private',1,?1,?2,12,'reports/gh/acme/private/b.json.gz',?2,?3,42,'1001')")
    .bind(recorded, now, report.length)
    .run();
  const signedIn = { cookie: `cs_session=${cookieSecret}` };
  const hook = JSON.stringify({ action: "added", installation: { id: 42 }, repositories_added: Array.from({ length: 10 }, (_, i) => ({ full_name: `acme/x${i}` })) });
  const newShare = async (id: string, uploaded: boolean, expiresAt = now + 3600) => {
    await db
      .prepare("INSERT OR REPLACE INTO shares (id, bytes, created_at, expires_at, delete_hash, upload_hash, uploaded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(id, upload.length, now, expiresAt, await sha256(token), uploaded ? null : await sha256(token), uploaded ? 1 : 0)
      .run();
    if (uploaded) await env.REPORTS.put(`shares/${id}`, upload);
  };
  await newShare("share-get-00000000", true);

  // The Leaderboards' seed list, as the Builder sends it: nine languages of ten.
  const SEEDS = Array.from({ length: 90 }, (_, i) => ({ owner: "seed", name: `r${i}`, language: `L${i % 9}`, stars: 100_000 - i * 37, sizeKb: 5000 + i }));
  const seedBody = JSON.stringify({ repos: SEEDS, budget: 60 });

  const cases: Case[] = [
    { name: "GET /api/repos/:owner/:name (facts kept)", request: async () => new Request("http://site/api/repos/acme/ownership") },
    {
      name: "GET /api/repos/:owner/:name (facts asked of GitHub)",
      before: async () => void (await db.prepare("UPDATE repositories SET facts_at = 0 WHERE id = 'acme/ownership'").run()),
      request: async () => new Request("http://site/api/repos/acme/ownership"),
    },
    { name: `GET /api/reports/:owner/:name (${report.length} bytes)`, request: async () => new Request("http://site/api/reports/acme/ownership") },
    { name: "GET /api/cards/:owner/:name", request: async () => new Request("http://site/api/cards/acme/ownership") },
    { name: "GET /gh/:owner/:name (the stored page)", handler: "page", request: async () => new Request("http://site/gh/acme/ownership") },
    {
      name: "POST /api/builds (asks GitHub, starts one)",
      // The last run's Build finished, as the Builder would have it: under the Site's cap on Builds waiting.
      before: async () => void (await db.prepare("UPDATE builds SET state = 'done' WHERE state = 'queued' AND repo_id LIKE 'acme/r%'").run()),
      request: async (i) =>
        new Request("http://site/api/builds", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": `10.0.${i >> 8}.${i & 255}` },
          body: JSON.stringify({ owner: "acme", name: `r${i}` }),
        }),
    },
    {
      name: "POST /api/builds/:id/progress",
      request: async () => signed("POST", "/api/builds/build-running/progress", '{"step":"reading"}', { body: '{"step":"reading"}' }),
    },
    {
      name: `PUT /api/builds/:id/report (${upload.length} bytes)`,
      request: async () =>
        signed("PUT", "/api/builds/build-running/report", `length:${upload.length}`, {
          body: upload,
          headers: { "content-type": "application/gzip", "content-length": String(upload.length), "x-upload-token": token },
        }),
    },
    {
      name: "POST /api/builds/:id/done (stores the page)",
      before: async (i) => void (await newBuild(`build-done-${i}`, true)),
      request: async (i) => signed("POST", `/api/builds/build-done-${i}/done`, '{"ok":true,"seconds":3,"lines":true,"partial":false}', { body: '{"ok":true,"seconds":3,"lines":true,"partial":false}' }),
    },
    {
      name: "POST /api/shares",
      request: async (i) =>
        new Request("http://site/api/shares", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": `10.1.${i >> 8}.${i & 255}` },
          body: JSON.stringify({ bytes: upload.length, hours: 4, deleteHash: "0".repeat(64) }),
        }),
    },
    {
      name: `PUT /api/shares/:id (${upload.length} bytes)`,
      before: async (i) => void (await newShare(`share-put-${String(i).padStart(8, "0")}`, false)),
      request: async (i) =>
        new Request(`http://site/api/shares/share-put-${String(i).padStart(8, "0")}`, {
          method: "PUT",
          body: upload,
          headers: { "content-length": String(upload.length), "x-upload-token": token },
        }),
    },
    { name: `GET /api/shares/:id (${upload.length} bytes)`, request: async () => new Request("http://site/api/shares/share-get-00000000") },
    {
      name: "DELETE /api/shares/:id",
      before: async (i) => void (await newShare(`share-del-${String(i).padStart(8, "0")}`, true)),
      request: async (i) =>
        new Request(`http://site/api/shares/share-del-${String(i).padStart(8, "0")}`, { method: "DELETE", headers: { "x-delete-token": token } }),
    },
    { name: "GET /api/auth/github (off to GitHub)", request: async () => new Request("http://site/api/auth/github") },
    {
      name: "GET /api/auth/callback (signs in)",
      request: async () => new Request("http://site/api/auth/callback?code=c&state=s", { headers: { cookie: "cs_state=s" } }),
    },
    { name: "GET /api/me (30 repositories)", request: async () => new Request("http://site/api/me", { headers: signedIn }) },
    {
      name: "GET /api/repos/:owner/:name (private, access asked)",
      before: async () => void (await db.prepare("DELETE FROM access").run()),
      request: async () => new Request("http://site/api/repos/acme/private", { headers: signedIn }),
    },
    { name: "GET /api/reports/:owner/:name (private, access kept)", request: async () => new Request("http://site/api/reports/acme/private", { headers: signedIn }) },
    {
      name: "POST /api/builds (private: App JWT and installation token)",
      before: async () =>
        void (await db.prepare("DELETE FROM builds WHERE repo_id = 'acme/private'").run(),
        await db.prepare("UPDATE repositories SET report_at = 1 WHERE id = 'acme/private'").run()),
      request: async (i) =>
        new Request("http://site/api/builds", {
          method: "POST",
          headers: { ...signedIn, "content-type": "application/json", origin: "http://site", "cf-connecting-ip": `10.2.${i >> 8}.${i & 255}` },
          body: JSON.stringify({ owner: "acme", name: "private" }),
        }),
    },
    {
      name: "POST /api/github/webhooks (signed)",
      request: async () =>
        new Request("http://site/api/github/webhooks", {
          method: "POST",
          body: hook,
          headers: { "x-github-event": "installation_repositories", "x-hub-signature-256": `sha256=${createHmac("sha256", "hook").update(hook).digest("hex")}` },
        }),
    },
    {
      name: `POST /api/seeds (${SEEDS.length} seeds, all due)`,
      before: async () => void (await db.prepare("DELETE FROM builds WHERE repo_id LIKE 'seed/%'").run()),
      request: async () => signed("POST", "/api/seeds", seedBody, { body: seedBody }),
    },
    {
      name: `POST /api/leaderboards/write (${SEEDS.length} built)`,
      before: async (i) => {
        if (i > 0) return;
        await db.prepare("DELETE FROM builds WHERE repo_id LIKE 'seed/%'").run();
        await db
          .prepare(
            "UPDATE repositories SET report_at = ?1, bus_factor = 1 + (stars % 3), maintainers = stars % 40, commits_30d = stars % 500, people_30d = stars % 90, code_lines = 1000 + stars, untouched_5y = stars % 1000, answered = 10 + stars % 50, answer_hours = (stars % 100) / 3.0 WHERE seed = 1",
          )
          .bind(now)
          .run();
      },
      request: async () => signed("POST", "/api/leaderboards/write", "", { body: "" }),
    },
    { name: "GET /api/leaderboards", request: async () => new Request("http://site/api/leaderboards") },
    { name: "GET /api/nope", request: async () => new Request("http://site/api/nope") },
  ];
  const rows: string[] = [];
  for (const c of cases) {
    const m = await measure(env, c);
    rows.push(`| ${c.name} | ${m.status} | ${m.median.toFixed(2)} ms | ${m.p99.toFixed(2)} ms | ${m.own.toFixed(2)} ms | ${m.ownP99.toFixed(2)} ms |`);
    expect(m.median, c.name).toBeLessThan(10);
    expect(m.own, c.name).toBeLessThan(10);
  }
  // The Cron Trigger's run, with a hundred expired Shared Reports to remove.
  const cron = async (name: string, before: () => Promise<void>, work: () => Promise<void>) => {
    const times: number[] = [];
    const own: number[] = [];
    for (let run = 0; run < 30; run++) {
      await before();
      const start = process.cpuUsage();
      const inSqlite = sqlite.ms;
      await work();
      const used = process.cpuUsage(start);
      times.push((used.user + used.system) / 1000);
      own.push((used.user + used.system) / 1000 - (sqlite.ms - inSqlite));
    }
    times.sort((a, b) => a - b);
    own.sort((a, b) => a - b);
    rows.push(`| ${name} | – | ${times[15]?.toFixed(2)} ms | ${times.at(-1)?.toFixed(2)} ms (max of 30) | ${own[15]?.toFixed(2)} ms | ${own.at(-1)?.toFixed(2)} ms |`);
  };
  let run = 0;
  await cron(
    "Cron Trigger: 100 expired Shared Reports removed",
    async () => {
      run++;
      for (let i = 0; i < 100; i++) await newShare(`share-old-${run}-${String(i).padStart(4, "0")}`, true, 1);
    },
    async () => void expect(await expire(env)).toBe(100),
  );
  // The Cron Trigger's run when the boards are a day old: written again.
  await cron(
    `Cron Trigger: the boards written again (${SEEDS.length} built)`,
    async () => env.REPORTS.delete("boards/leaderboards.json"),
    async () => boardsIfOld(env),
  );
  vi.unstubAllGlobals();
  // Written beside the build's other measurements.
  writeFileSync(
    process.env.CPU_OUT ?? "../../target/site-cpu.md",
    ["| Handler | Status | CPU, median | CPU, 99th percentile | Without SQLite, median | Without SQLite, 99th |", "|---|---|---|---|---|---|", ...rows].join("\n") + "\n",
  );
});
