import { expect, test } from "vitest";
import { SIGNATURE, sign, type Boards, type BuildRequest } from "@commitscape/data";
import { testD1 } from "../test/d1";
import { testR2 } from "../test/r2";
import { getBoards, seeds, writeBoards } from "./boards";

const SECRET = "s".repeat(40);
const env = () => ({ DB: testD1(), REPORTS: testR2(), BUILDER_SECRET: SECRET }) as unknown as Env;
const seed = (name: string, stars: number) => ({ owner: "acme", name, language: "Rust", stars, sizeKb: 10 });

async function askSeeds(e: Env, repos: ReturnType<typeof seed>[], budget: number): Promise<BuildRequest[]> {
  const body = JSON.stringify({ repos, budget });
  const r = await seeds(new Request("http://site/api/seeds", { method: "POST", body, headers: { [SIGNATURE]: await sign(SECRET, "POST", "/api/seeds", body) } }), e);
  expect(r.status).toBe(200);
  return ((await r.json()) as { builds: BuildRequest[] }).builds;
}

test("seeds come only from the Builder", async () => {
  const r = await seeds(new Request("http://site/api/seeds", { method: "POST", body: '{"repos":[]}' }), env());
  expect(r.status).toBe(401);
});

test("a night's seeds stay within the budget: never built first, then the oldest, none twice", async () => {
  const e = env();
  const list = ["a", "b", "c", "d"].map((n, i) => seed(n, 100 - i));
  const first = await askSeeds(e, list, 3);
  expect(first.map((b) => b.name)).toHaveLength(3);
  expect(first.every((b) => b.seed && !b.private && b.token === null)).toBe(true);
  // The same night again: three are still queued, so only the fourth.
  expect((await askSeeds(e, list, 3)).map((b) => b.name)).toEqual(["d"]);
  // Built long ago comes before built yesterday; built today is left alone.
  const hour = 3600;
  const now = Math.floor(Date.now() / 1000);
  await e.DB.prepare("DELETE FROM builds").run();
  await e.DB.prepare("UPDATE repositories SET report_at = ?1 WHERE name = 'a'").bind(now - 100 * 24 * hour).run();
  await e.DB.prepare("UPDATE repositories SET report_at = ?1 WHERE name = 'b'").bind(now - 2 * 24 * hour).run();
  await e.DB.prepare("UPDATE repositories SET report_at = ?1 WHERE name IN ('c', 'd')").bind(now - hour).run();
  expect((await askSeeds(e, list, 5)).map((b) => b.name)).toEqual(["a", "b"]);
});

test("the boards rank repositories from their stats, each with its own rule", async () => {
  const e = env();
  await askSeeds(e, [seed("lone", 900), seed("crowd", 50), seed("young", 10), seed("dormant", 5)], 0);
  const set = (name: string, stats: string) => e.DB.prepare(`UPDATE repositories SET report_at = 1, ${stats} WHERE name = ?1`).bind(name).run();
  await set("lone", "bus_factor = 1, maintainers = 1, commits_30d = 5, people_30d = 1, code_lines = 5000, untouched_5y = 4000, answered = 3, answer_hours = 0.5");
  await set("crowd", "bus_factor = 4, maintainers = 30, commits_30d = 400, people_30d = 60, code_lines = 90000, untouched_5y = 9000, answered = 40, answer_hours = 30");
  // Too little code for the oldest-code board.
  await set("young", "bus_factor = 2, maintainers = 2, commits_30d = 50, people_30d = 3, code_lines = 200, untouched_5y = 200, answered = 12, answer_hours = 100");
  // No commits in a year: no Bus Factor, and its old code is not "still running".
  await set("dormant", "bus_factor = NULL, maintainers = 0, commits_30d = 0, people_30d = 0, code_lines = 3000, untouched_5y = 3000, answered = 0, answer_hours = NULL");
  const boards = await writeBoards(e);
  expect(boards.from).toBe(4);
  const rows = (id: string) => boards.boards.find((b) => b.id === id)?.rows.map((r) => `${r.name} ${r.shown}`);
  expect(rows("one_person")).toEqual(["lone 900 stars"]);
  expect(rows("maintainers")).toEqual(["crowd 30 maintainers", "young 2 maintainers", "lone 1 maintainer"]);
  expect(rows("active_people")).not.toContain("dormant 0 people");
  expect(rows("active_commits")?.[0]).toBe("crowd 400 commits");
  expect(rows("active_people")?.[0]).toBe("crowd 60 people");
  // Fewer than ten answered is not enough to rank.
  expect(rows("answers")).toEqual(["crowd 30 h", "young 4 days"]);
  expect(rows("oldest_code")).toEqual(["lone 80% of 5,000 lines", "crowd 10% of 90,000 lines"]);
  // Served as written.
  const served = (await (await getBoards(e)).json()) as Boards;
  expect(served).toEqual(boards);
});

test("before any boards are written, an empty document", async () => {
  expect(await (await getBoards(env())).json()).toEqual({ builtAt: 0, from: 0, boards: [] });
});
