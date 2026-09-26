// The security pass's fixes (STATE.md, Phase 31), each on the handler itself.
import { afterEach, expect, test, vi } from "vitest";
import { testD1 } from "../test/d1";
import { testR2 } from "../test/r2";
import { canSee } from "./access";
import { removeReports } from "./auth";
import { WAITING_MAX, page, startBuild, writePage } from "./builds";
import { address, now } from "./http";
import { LOOKUP_LIMIT, known, lookup } from "./lookup";
import { report } from "./reports";
import { SHARES_TOTAL, createShare } from "./shares";

const ctx = { waitUntil: () => {}, passThroughOnException() {} } as unknown as ExecutionContext;
const env = (over: Record<string, unknown> = {}) =>
  ({ DB: testD1(), REPORTS: testR2(), BUILDER_URL: "http://builder", BUILDER_SECRET: "s".repeat(40), GITHUB_API: "http://gh", GITHUB_TOKEN: "", ...over }) as unknown as Env;
/** GitHub, answering every repository as public with `id`, and counting requests. */
function gitHub(id = 1, extra: Record<string, unknown> = {}) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (url.includes("/builds")) return new Response('{"queued":1}', { status: 202 });
    if (url.endsWith("/languages")) return new Response("{}");
    if (url.includes("/contributors") || url.includes("/releases")) return new Response("[]");
    return new Response(JSON.stringify({ id, full_name: "acme/rocket", private: false, size: 5, ...extra }));
  });
  return asked;
}
afterEach(() => void vi.unstubAllGlobals());

test("an IPv6 address counts as its /64; an IPv4 one as itself", () => {
  const from = (ip: string) => address(new Request("http://site/", { headers: { "cf-connecting-ip": ip } }));
  expect(from("203.0.113.9")).toBe("203.0.113.9");
  expect(from("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
  expect(from("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
  expect(from("2001:DB8:0001:0002:0:0:0:9")).toBe("2001:db8:1:2::/64");
  expect(from("2001:db8::1")).toBe("2001:db8:0:0::/64");
});

test("Shared Reports stop being taken when the Site holds its fill", async () => {
  const e = env();
  const ask = (bytes: number) =>
    createShare(new Request("http://site/api/shares", { method: "POST", body: JSON.stringify({ bytes, hours: 4, deleteHash: "0".repeat(64) }) }), e);
  await e.DB.prepare("INSERT INTO shares (id, bytes, created_at, expires_at, delete_hash) VALUES ('held', ?1, ?2, ?3, 'x')")
    .bind(SHARES_TOTAL - 1000, now(), now() + 3600)
    .run();
  expect((await ask(2000)).status).toBe(503);
  expect((await ask(500)).status).toBe(201);
  // Expired ones do not count.
  await e.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = 'held'").run();
  expect((await ask(2000)).status).toBe(201);
});

test("a private repository's name given to another repository does not pass the access check", async () => {
  const e = env();
  const s = { id: "a".repeat(64), userId: "1", token: "ghu_x" };
  gitHub(42);
  expect(await canSee(e, s, "acme", "rocket", 42)).toBe(true);
  await e.DB.prepare("DELETE FROM access").run();
  expect(await canSee(e, s, "acme", "rocket", 7)).toBe(false);
});

test("a name now another repository's forgets the old one's Report; one made private stops serving it", async () => {
  const e = env();
  await e.REPORTS.put("reports/gh/acme/rocket/a.json.gz", new Uint8Array(10));
  await e.DB.prepare(
    "INSERT INTO repositories (id, owner, name, status, facts_at, github_id, report_key, report_at) VALUES ('acme/rocket', 'acme', 'rocket', 'ok', 1, 42, 'reports/gh/acme/rocket/a.json.gz', 1)",
  ).run();
  gitHub(99);
  const row = await known(e, "acme", "rocket");
  expect(row).toMatchObject({ githubId: 99, reportKey: null });
  expect(await e.REPORTS.get("reports/gh/acme/rocket/a.json.gz")).toBeNull();

  const f = env();
  await f.REPORTS.put("reports/gh/acme/rocket/a.json.gz", new Uint8Array(10));
  await f.DB.prepare(
    "INSERT INTO repositories (id, owner, name, status, facts_at, github_id, report_key, report_at) VALUES ('acme/rocket', 'acme', 'rocket', 'ok', 1, 42, 'reports/gh/acme/rocket/a.json.gz', 1)",
  ).run();
  gitHub(42, { private: true });
  expect((await report(new Request("http://site/api/reports/acme/rocket"), f, ctx, "acme", "rocket")).status).toBe(404);
});

test("people's Builds waiting across the Site are capped", async () => {
  const e = env();
  gitHub();
  for (let i = 0; i < WAITING_MAX; i++) {
    await e.DB.prepare("INSERT INTO repositories (id, owner, name) VALUES (?1, 'acme', ?2)").bind(`acme/w${i}`, `w${i}`).run();
    await e.DB.prepare("INSERT INTO builds (id, repo_id, state, requested_at) VALUES (?1, ?2, 'queued', ?3)").bind(`b${i}`, `acme/w${i}`, now()).run();
  }
  const ask = () =>
    startBuild(new Request("http://site/api/builds", { method: "POST", body: JSON.stringify({ owner: "acme", name: "rocket" }), headers: { "cf-connecting-ip": "203.0.113.1" } }), e);
  const refused = await ask();
  expect(refused.status).toBe(503);
  expect(((await refused.json()) as { error: string }).error).toContain("many repositories to read");
  // The night's seeds do not count.
  await e.DB.prepare("UPDATE repositories SET seed = 1 WHERE id LIKE 'acme/w%'").run();
  expect((await ask()).status).toBe(202);
});

test("an address that looks up too many repositories is told so, and GitHub is not asked", async () => {
  const e = env();
  const asked = gitHub();
  const from = { headers: { "cf-connecting-ip": "203.0.113.2" } };
  for (let i = 0; i < LOOKUP_LIMIT.max; i++) await lookup(new Request(`http://site/api/repos/acme/r${i}`, from), e, "acme", `r${i}`);
  const before = asked.length;
  const limited = await lookup(new Request("http://site/api/repos/acme/more", from), e, "acme", "more");
  expect(limited.status).toBe(429);
  expect(asked.length).toBe(before);
  // What is already known still answers.
  expect((await lookup(new Request("http://site/api/repos/acme/r1", from), e, "acme", "r1")).status).toBe(200);
});

test("a description with $ sequences stays text in the stored page", async () => {
  const shell = "<!doctype html><html><head><title>t</title></head><body><script>boot()</script></body></html>";
  const e = env({ ASSETS: { fetch: async () => new Response(shell) } });
  const facts = JSON.stringify({ description: "costs $' and $& and $`" });
  const row = { id: "acme/rocket", owner: "acme", name: "rocket", facts } as never;
  const key = await writePage(e, "http://site", row, null);
  const html = await (await e.REPORTS.get(key ?? ""))!.text();
  expect(html).toContain('content="costs $\' and $&amp; and $`"');
  expect(html.match(/<script>/g)).toHaveLength(1);
});

test("a repository page with a malformed address gets the app's shell, not an error", async () => {
  const e = env({ ASSETS: { fetch: async () => new Response("shell") } });
  const r = await page(new Request("http://site/gh/%E0/x"), e);
  expect(await r.text()).toBe("shell");
});

test("removing a large installation's Reports works past D1's hundred values", async () => {
  const e = env();
  const rows: Parameters<typeof removeReports>[1] = [];
  for (let i = 0; i < 230; i++) {
    await e.DB.prepare("INSERT INTO repositories (id, owner, name, report_key) VALUES (?1, 'acme', ?2, ?3)").bind(`acme/r${i}`, `r${i}`, `reports/r${i}`).run();
    rows.push({ id: `acme/r${i}`, reportKey: `reports/r${i}`, cardKey: null, pageKey: null } as never);
  }
  await removeReports(e, rows);
  expect(await e.DB.prepare("SELECT count(*) AS n FROM repositories").first()).toEqual({ n: 0 });
});
