import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { busy, queueBuild, reapBuilds, RESEND_AFTER, RETRY_AFTER } from "./builds";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { LONGEST_JOB_SECONDS, type BuildJob, type Queue } from "./queue";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

test("a running Build stays busy until the longest a job may run, and one that ended with only part of its Report waits before another", () => {
  const at = 1_000_000;
  expect(busy({ state: "running", reason: null, requestedAt: at - 7200, startedAt: at - 7200, finishedAt: null }, at)).toBe(true);
  expect(busy({ state: "running", reason: null, requestedAt: 0, startedAt: at - LONGEST_JOB_SECONDS - 1, finishedAt: null }, at)).toBe(false);
  expect(busy({ state: "done", reason: "timed_out", requestedAt: 0, finishedAt: at - 60 }, at)).toBe(true);
  expect(busy({ state: "done", reason: "timed_out", requestedAt: 0, finishedAt: at - RETRY_AFTER - 1 }, at)).toBe(false);
  expect(busy({ state: "done", reason: null, requestedAt: 0, finishedAt: at - 60 }, at)).toBe(false);
});

test("a queued Build is sent with its repository as the key that keeps its Builds one at a time", async () => {
  const db = await database();
  await db.insert(schema.repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const sent: BuildJob[] = [];
  const id = await queueBuild(db, { send: async (job) => void sent.push(job) }, "acme/rocket", 10);
  expect(sent).toEqual([{ buildId: id, repoId: "acme/rocket" }]);
});

test("the reaper ends running Builds whose job is gone, sends lost queued ones again, and leaves the rest", async () => {
  const db = await database();
  const at = 10_000_000;
  await db.insert(schema.repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket" },
    { id: "acme/seed", owner: "acme", name: "seed", seed: true },
  ]);
  await db.insert(schema.builds).values([
    { id: "alive", repoId: "acme/rocket", state: "running", requestedAt: at - 60, startedAt: at - 60 },
    { id: "orphan", repoId: "acme/rocket", state: "running", requestedAt: at - 60, startedAt: at - 60 },
    { id: "ancient", repoId: "acme/rocket", state: "running", requestedAt: 1, startedAt: 1 },
    { id: "waiting", repoId: "acme/rocket", state: "queued", requestedAt: at - RESEND_AFTER - 1 },
    { id: "lost", repoId: "acme/seed", state: "queued", requestedAt: at - RESEND_AFTER - 1 },
    { id: "fresh", repoId: "acme/rocket", state: "queued", requestedAt: at - 5 },
    { id: "stale", repoId: "acme/rocket", state: "queued", requestedAt: at - LONGEST_JOB_SECONDS - 1 },
    { id: "ended", repoId: "acme/rocket", state: "done", requestedAt: at - 60 },
  ]);
  const states: Record<string, string[]> = { alive: ["active"], ancient: ["active"], orphan: ["failed"], waiting: ["created"], lost: ["completed"] };
  const sent: [BuildJob, number][] = [];
  const queue: Queue = { send: async (job, priority) => void sent.push([job, priority]) };
  expect(await reapBuilds(db, async (id) => states[id] ?? [], queue, at)).toEqual({ failed: 3, resent: 1 });
  expect(sent).toEqual([[{ buildId: "lost", repoId: "acme/seed" }, 0]]);
  const rows = Object.fromEntries((await db.select().from(schema.builds)).map((b) => [b.id, [b.state, b.reason]]));
  expect(rows).toEqual({
    alive: ["running", null],
    orphan: ["failed", "error"],
    ancient: ["failed", "error"],
    waiting: ["queued", null],
    lost: ["queued", null],
    fresh: ["queued", null],
    stale: ["failed", "paused"],
    ended: ["done", null],
  });
});
