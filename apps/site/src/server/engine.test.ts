import { describe, expect, test } from "vitest";
import { now, schema, type SurvivalJob } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { engineOf } from "./engine";

const { repoPeople, repositories, surviving } = schema;

async function seeded() {
  const counted: SurvivalJob[] = [];
  const deps = await testDeps({ queue: async () => ({ send: async () => {}, count: async (job) => void counted.push(job) }) });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", reportKey: "r/rocket/b1", reportAt: 100, factsAt: now() },
    { id: "acme/secret", owner: "acme", name: "secret", reportKey: "r/secret/b1", reportAt: 100, isPrivate: true, status: "private", installationId: 5, factsAt: now() },
    { id: "acme/old", owner: "acme", name: "old", reportKey: "r/old/b2", reportAt: 100, factsAt: now() },
  ]);
  const person = (repoId: string, reportKey: string, personId: number, login: string, commits: number) => ({ repoId, reportKey, personId, name: login, login, commits, linesAdded: commits * 10, linesRemoved: commits, first: 1, last: 2 });
  await deps.db.insert(repoPeople).values([
    person("acme/rocket", "r/rocket/b1", 3, "Alice", 12),
    person("acme/rocket", "r/rocket/b1", 4, "bob", 2),
    person("acme/secret", "r/secret/b1", 0, "alice", 5),
    person("acme/old", "r/old/b1", 1, "alice", 9),
  ]);
  return { deps, counted };
}

const anyone = { ...viewer(), login: async () => null };

describe("the engine's numbers on a Profile", () => {
  test("only public repositories the Site has built, at their current Report, and asks for each count once", async () => {
    const { deps, counted } = await seeded();
    const first = await engineOf(deps, anyone, "alice");
    expect(first.repos.map((r) => [r.name, r.commits, r.linesAdded, r.surviving.status])).toEqual([["rocket", 12, 120, "counting"]]);
    expect(first).toMatchObject({ surviving: null, counting: 1 });
    expect(counted).toEqual([{ repoId: "acme/rocket", reportKey: "r/rocket/b1", personIds: [3] }]);
    await engineOf(deps, anyone, "ALICE");
    expect(counted).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("secret");
  });

  test("a count, once made, is shown with its Survival; one over budget says so and is never a number", async () => {
    const { deps } = await seeded();
    await deps.db.insert(surviving).values([
      { repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 3, status: "counted", lines: 75, added: 120, askedAt: now(), countedAt: now() },
      { repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 4, status: "over_budget", askedAt: now(), countedAt: now() },
    ]);
    const alice = await engineOf(deps, anyone, "alice");
    expect(alice).toMatchObject({ surviving: 75, added: 120, counting: 0 });
    expect(alice.repos[0]?.surviving).toEqual({ status: "counted", lines: 75, added: 120 });
    const bob = await engineOf(deps, anyone, "bob");
    expect(bob).toMatchObject({ surviving: null, counting: 0 });
    expect(bob.repos[0]?.surviving).toEqual({ status: "over_budget", lines: null, added: null });
  });

  test("a count asked for half an hour ago and never answered is asked again", async () => {
    const { deps, counted } = await seeded();
    await deps.db.insert(surviving).values({ repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 3, status: "queued", askedAt: now() - 3600 });
    await engineOf(deps, anyone, "alice");
    expect(counted).toHaveLength(1);
  });
});
