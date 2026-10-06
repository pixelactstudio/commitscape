import { expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { survivalOf } from "./survival";

const { builds, repoPeople, repositories, surviving } = schema;

const anyone = { ...viewer(), login: async () => null };
const committed = (name: string, commits: number, isPrivate = false) => ({ owner: "acme", name, private: isPrivate, commits });

async function seeded() {
  const deps = await testDeps({ queue: async () => ({ send: async () => {}, count: async () => {} }) });
  await deps.db.insert(repositories).values([
    { id: "acme/counted", owner: "acme", name: "counted", reportKey: "r/counted", reportAt: 100, factsAt: now() },
    { id: "acme/waiting", owner: "acme", name: "waiting", reportKey: "r/waiting", reportAt: 100, factsAt: now() },
    { id: "acme/elsewhere", owner: "acme", name: "elsewhere", reportKey: "r/elsewhere", reportAt: 100, factsAt: now() },
    { id: "acme/reading", owner: "acme", name: "reading", factsAt: now() },
    { id: "acme/broken", owner: "acme", name: "broken", factsAt: now() },
  ]);
  await deps.db.insert(repoPeople).values([
    { repoId: "acme/counted", reportKey: "r/counted", personId: 1, name: "alice", login: "alice", commits: 40, linesAdded: 400, linesRemoved: 10, first: 1, last: 2 },
    { repoId: "acme/waiting", reportKey: "r/waiting", personId: 1, name: "alice", login: "alice", commits: 5, linesAdded: 50, linesRemoved: 1, first: 1, last: 2 },
  ]);
  await deps.db.insert(surviving).values([
    { repoId: "acme/counted", reportKey: "r/counted", personId: 1, status: "counted", lines: 300, added: 400, askedAt: now(), countedAt: now() },
    { repoId: "acme/waiting", reportKey: "r/waiting", personId: 1, status: "queued", askedAt: now() },
  ]);
  await deps.db.insert(builds).values([
    { id: "b1", repoId: "acme/reading", state: "running", requestedAt: now() - 30 },
    { id: "b2", repoId: "acme/broken", state: "failed", reason: "too_big", requestedAt: now() - 7200, finishedAt: now() - 7000 },
  ]);
  return deps;
}

test("every repository they committed to is accounted for, and the total is the sum of the counted ones alone", async () => {
  const deps = await seeded();
  const view = await survivalOf(deps, anyone, "alice", [committed("counted", 40), committed("waiting", 5), committed("elsewhere", 7), committed("reading", 3), committed("broken", 9), committed("never", 20), committed("secret", 4, true), committed("empty", 0)]);
  const counted = view.repos.filter((r) => r.surviving.status === "counted");
  expect(view.surviving).toBe(counted.reduce((n, r) => n + (r.surviving.lines ?? 0), 0));
  expect(view.surviving).toBe(300);
  expect(view.repos.map((r) => [r.name, r.surviving.status])).toEqual([
    ["counted", "counted"],
    ["waiting", "counting"],
  ]);
  expect(view.unread?.map((r) => [r.name, r.state, r.canRead, r.reason])).toEqual([
    ["never", "not_read", true, null],
    ["broken", "failed", true, "too_big"],
    ["elsewhere", "not_in_it", false, null],
    ["secret", "not_read", false, null],
    ["reading", "reading", false, null],
  ]);
});
