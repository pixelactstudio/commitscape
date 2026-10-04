import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, readEntry, readIndex, schema, type Db, type SurvivalJob } from "@commitscape/server";
import type { Config } from "./config";
import { runJob, type JobContext } from "./job";
import type { Ran } from "./run";

const { builds, repositories, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const report = {
  meta: { name: "rocket", windows: ["all"], window: "all", anchor: 1, history: "complete", lines: "counted", github: "ready", github_history: "off", avatars: true },
  data: { "/api/overview?window=all": { window: "all" }, "/api/commits?": { subjects: ["first"] } },
  cards: { all: "<svg/>" },
  stats: { commits: 3, people: 2, bus_factor: 1, maintainers: 1, commits_30d: 3, people_30d: 2, code_lines: 40, untouched_5y: 0 },
};

const person = (id: number, login: string | null, commits: number) => ({ person: { id, name: `P${id}`, login }, commits, lines_added: 1, lines_removed: 0, first: 1, last: 2 });

async function context(db: Db, over: Partial<JobContext> = {}, written: object = report): Promise<JobContext & { storage: ReturnType<typeof memoryStorage> }> {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const cfg: Config = { bin: "commitscape", work, concurrency: 1, fullUpToMb: 100, maxMb: 3000, timeLimit: 60, diskGb: 20, gitBase: undefined };
  const run = async (_cmd: string, args: string[]): Promise<Ran> => {
    const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
    if (out) await writeFile(out, gzipSync(JSON.stringify(written)));
    return { code: 0, stderr: "", timedOut: false };
  };
  return { db, storage: memoryStorage(), cfg, app: null, run, github: { api: "http://github.test", token: null }, log: () => {}, ...over } as JobContext & {
    storage: ReturnType<typeof memoryStorage>;
  };
}

test("a Build stores its Report an answer at a time and replaces the one before", async () => {
  const db = await database();
  const ctx = await context(db);
  await ctx.storage.put("reports/gh/acme/rocket/old/index.json", "{}", { type: "application/json" });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "reports/gh/acme/rocket/old" });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, "acme/rocket"));
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true, busFactor: 1, codeLines: 40 });
  const [build] = await db.select().from(builds).where(eq(builds.id, "b1"));
  expect(build).toMatchObject({ state: "done", step: null, partial: false });
  expect((await readIndex(ctx.storage, "reports/gh/acme/rocket/b1"))?.keys).toEqual(["/api/overview?window=all"]);
  expect(await readEntry(ctx.storage, "reports/gh/acme/rocket/b1", "/api/overview?window=all")).toEqual({ window: "all" });
  expect(ctx.storage.objects.has("reports/gh/acme/rocket/old/index.json")).toBe(false);

  await runJob("b1", ctx);
  expect([...ctx.storage.objects.keys()].filter((k) => k.endsWith("index.json"))).toHaveLength(1);
});

test("a private repository with no installation token fails as private and reads nothing", async () => {
  const db = await database();
  let ran = 0;
  const ctx = await context(db, {
    run: async () => {
      ran++;
      return { code: 0, stderr: "", timedOut: false };
    },
  });
  await db.insert(repositories).values({ id: "acme/secret", owner: "acme", name: "secret", isPrivate: true, installationId: 7 });
  await db.insert(builds).values({ id: "b2", repoId: "acme/secret", state: "queued", requestedAt: 1 });
  await runJob("b2", ctx);
  const [build] = await db.select().from(builds).where(eq(builds.id, "b2"));
  expect(build).toMatchObject({ state: "failed", reason: "private" });
  expect(ran).toBe(0);
});

test("a seed repository's Build asks for the Surviving Lines of its people with most commits, bots and people with no login left out", async () => {
  const db = await database();
  const people = [person(1, "bot[bot]", 900), person(2, null, 800), ...Array.from({ length: 34 }, (_, i) => person(10 + i, `p${i}`, 100 - i))];
  const asked: SurvivalJob[] = [];
  const ctx = await context(db, { queueCounts: async (job) => void asked.push(job) }, { ...report, data: { ...report.data, "/api/people?window=all": { people } } });
  await db.insert(repositories).values({ id: "acme/seed", owner: "acme", name: "seed", sizeKb: 10, seed: true });
  await db.insert(builds).values({ id: "b3", repoId: "acme/seed", state: "queued", requestedAt: 1 });
  await runJob("b3", ctx);
  expect(asked.map((j) => j.personIds.length)).toEqual([10, 10, 10]);
  expect(asked.flatMap((j) => j.personIds)).toEqual(Array.from({ length: 30 }, (_, i) => 10 + i));
  expect(asked.every((j) => j.reportKey === "reports/gh/acme/seed/b3")).toBe(true);
  expect(await db.select({ status: surviving.status }).from(surviving)).toHaveLength(30);

  await db.insert(repositories).values({ id: "acme/other", owner: "acme", name: "other", sizeKb: 10 });
  await db.insert(builds).values({ id: "b4", repoId: "acme/other", state: "queued", requestedAt: 1 });
  await runJob("b4", ctx);
  expect(asked).toHaveLength(3);
});
