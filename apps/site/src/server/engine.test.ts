import { describe, expect, test } from "vitest";
import { now, schema, type SurvivalJob } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import type { EngineRepo } from "@commitscape/data";
import { engineOf, LOST_AFTER, mergeRepo, wantsCount } from "./engine";

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

  test("a count over budget is asked again half an hour on, and goes on from the files it counted", async () => {
    const { deps, counted } = await seeded();
    await deps.db.insert(surviving).values({ repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 3, status: "over_budget", askedAt: now() - 60, countedAt: now() });
    expect((await engineOf(deps, anyone, "alice")).repos[0]?.surviving.status).toBe("over_budget");
    expect(counted).toHaveLength(0);
    await deps.db.update(surviving).set({ askedAt: now() - LOST_AFTER - 60 });
    expect((await engineOf(deps, anyone, "alice")).repos[0]?.surviving.status).toBe("counting");
    expect(counted).toEqual([{ repoId: "acme/rocket", reportKey: "r/rocket/b1", personIds: [3] }]);
  });

  test("a count left uncounted by a Report read without lines is asked again once the repository is read with them", async () => {
    const { deps, counted } = await seeded();
    await deps.db.update(repositories).set({ reportLines: false });
    await deps.db.insert(surviving).values({ repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 3, status: "not_counted", askedAt: now(), countedAt: now() });
    await engineOf(deps, anyone, "alice");
    expect(counted).toHaveLength(0);
    await deps.db.update(repositories).set({ reportLines: true });
    await engineOf(deps, anyone, "alice");
    expect(counted).toHaveLength(1);
  });

  test("which counts are asked for", () => {
    const at = 10_000;
    expect(wantsCount(undefined, true, at)).toBe(true);
    expect(wantsCount({ status: "counted", askedAt: 0 }, true, at)).toBe(false);
    expect(wantsCount({ status: "stale", askedAt: 0 }, true, at)).toBe(false);
    for (const status of ["queued", "failed", "over_budget"]) {
      expect(wantsCount({ status, askedAt: at - 60 }, true, at)).toBe(false);
      expect(wantsCount({ status, askedAt: at - LOST_AFTER - 1 }, true, at)).toBe(true);
    }
    expect(wantsCount({ status: "not_counted", askedAt: at }, false, at)).toBe(false);
    expect(wantsCount({ status: "not_counted", askedAt: at }, true, at)).toBe(true);
    expect(wantsCount({ status: "not_counted", askedAt: at }, null, at)).toBe(true);
  });
});

describe("mergeRepo", () => {
  const row = (over: Partial<EngineRepo>): EngineRepo => ({ owner: "acme", name: "rocket", private: false, builtAt: 1, commits: 0, linesAdded: 0, linesRemoved: 0, first: null, last: null, surviving: { status: "counted", lines: 0, added: 0 }, ...over });

  test("adds up one person's identities in a repository", () => {
    const merged = mergeRepo([
      row({ commits: 10, linesAdded: 100, linesRemoved: 5, first: 50, last: 90, surviving: { status: "counted", lines: 40, added: 100 } }),
      row({ commits: 3, linesAdded: 20, linesRemoved: 1, first: 20, last: 60, surviving: { status: "counted", lines: 7, added: 20 } }),
    ]);
    expect(merged).toMatchObject({ commits: 13, linesAdded: 120, linesRemoved: 6, first: 20, last: 90, surviving: { status: "counted", lines: 47, added: 120 } });
  });

  test("is counting while any identity is", () => {
    const merged = mergeRepo([row({ surviving: { status: "counted", lines: 4, added: 9 } }), row({ surviving: { status: "counting", lines: null, added: null } })]);
    expect(merged.surviving).toEqual({ status: "counting", lines: null, added: null });
  });
});
