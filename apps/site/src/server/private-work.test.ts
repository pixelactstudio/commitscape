import { describe, expect, test } from "vitest";
import type { Profile, ProfileRepo } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { choosePrivate, privateReposOf, withPrivateWork } from "./private-work";

const repo = (name: string, priv: boolean, commits: number, prsMerged = 0): ProfileRepo => ({ owner: "ada", name, private: priv, stars: 0, language: "Go", colour: null, commits, prsOpened: prsMerged, prsMerged, reviews: 1, linesAdded: 0, linesRemoved: 0, first: null, last: null });

function profile(scope: Profile["scope"], repositories: ProfileRepo[]): Profile {
  return {
    identity: { login: "ada", githubId: 1, name: "Ada", avatar: "", bio: null, company: null, location: null, website: null, twitter: null, followers: 0, createdAt: "2020-01-01T00:00:00Z", kind: "user" },
    fetchedAt: now(),
    scope,
    totals: { prsOpened: 0, prsMerged: 0, prsClosed: 0, prsOpen: 0, reviews: 0, commits: 5, issues: 0, hidden: 0, linesAdded: 0, linesRemoved: 0, hoursToMerge: null, activeDays: 0, longestStreak: 0, currentStreak: 0, contributions: 0 },
    years: [],
    months: [],
    calendar: { firstDay: 0, days: [] },
    repositories,
    partners: [],
    prs: [],
    read: { prs: 0, prsTotal: 0, requests: 0, complete: true },
    clock: null,
  };
}

async function seeded() {
  const db = await testDb();
  const own = profile("self", [repo("open", false, 5), repo("secret", true, 40, 3), repo("quiet", true, 10)]);
  await db.insert(schema.profiles).values({ login: "ada", scope: "self", identity: JSON.stringify(own.identity), identityAt: now(), data: JSON.stringify(own), fetchedAt: now() });
  return db;
}

describe("private work", () => {
  test("nothing private shows until its person chooses it", async () => {
    const db = await seeded();
    const pub = profile("public", [repo("open", false, 5)]);
    expect(await withPrivateWork(db, pub)).toBe(pub);
    expect((await privateReposOf(db, "ada")).map((r) => [r.repo, r.show])).toEqual([
      ["ada/secret", "hidden"],
      ["ada/quiet", "hidden"],
    ]);
  });

  test("numbers only are summed apart from the public totals and never named; named ones are listed with a lock", async () => {
    const db = await seeded();
    await choosePrivate(db, "Ada", "ada/quiet", "counts");
    const counted = await withPrivateWork(db, profile("public", [repo("open", false, 5)]));
    expect(counted.privateWork).toEqual({ repositories: 1, named: 0, commits: 10, prsMerged: 0, reviews: 1 });
    expect(JSON.stringify(counted)).not.toContain("quiet");
    expect(counted.totals.commits).toBe(5);
    await choosePrivate(db, "ada", "ada/secret", "named");
    const named = await withPrivateWork(db, profile("public", [repo("open", false, 5)]));
    expect(named.privateWork).toEqual({ repositories: 2, named: 1, commits: 50, prsMerged: 3, reviews: 2 });
    expect(named.repositories.map((r) => [r.name, r.private])).toEqual([
      ["open", false],
      ["secret", true],
    ]);
    await choosePrivate(db, "ada", "ada/secret", "hidden");
    await choosePrivate(db, "ada", "ada/quiet", "hidden");
    expect((await withPrivateWork(db, profile("public", []))).privateWork).toBeUndefined();
  });
});
