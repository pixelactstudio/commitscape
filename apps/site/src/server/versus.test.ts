import { describe, expect, test } from "vitest";
import type { Profile } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { saveChoices } from "./people";
import { addRival, monthOf, removeRival, rivalLogins, rivalsOf, versusOf } from "./versus";

const totals = (over: Partial<Profile["totals"]>): Profile["totals"] => ({ prsOpened: 0, prsMerged: 0, prsClosed: 0, prsOpen: 0, reviews: 0, commits: 0, issues: 0, hidden: 0, linesAdded: 0, linesRemoved: 0, hoursToMerge: null, activeDays: 0, longestStreak: 0, currentStreak: 0, contributions: 0, ...over });

function profile(login: string, t: Partial<Profile["totals"]>, months: Profile["months"] = []): Profile {
  return {
    identity: { login, githubId: login.length, name: login.toUpperCase(), avatar: "", bio: null, company: null, location: null, website: null, twitter: null, followers: 0, createdAt: "2020-01-01T00:00:00Z", kind: "user" },
    fetchedAt: now(),
    scope: "public",
    totals: totals(t),
    years: [],
    months,
    calendar: { firstDay: 0, days: [] },
    repositories: [],
    partners: [],
    prs: [],
    read: { prs: 0, prsTotal: 0, requests: 0, complete: true },
    clock: null,
  };
}

const month = new Date().toISOString().slice(0, 7);

async function seeded() {
  const db = await testDb();
  const deps = { db, github: { api: "http://github.test" } };
  for (const p of [
    profile("ada", { prsMerged: 40, reviews: 12, commits: 900, linesAdded: 10_000, activeDays: 200, longestStreak: 14, hoursToMerge: 3 }, [{ month, contributions: 61, prsMerged: 4 }]),
    profile("bo", { prsMerged: 55, reviews: 12, commits: 400, linesAdded: 8_000, activeDays: 230, longestStreak: 9, hoursToMerge: 1.5 }, [{ month, contributions: 40, prsMerged: 7 }]),
    profile("cy", { commits: 3 }),
  ]) {
    await db.insert(schema.profiles).values({ login: p.identity.login, scope: "public", identity: JSON.stringify(p.identity), identityAt: now(), data: JSON.stringify(p), fetchedAt: now() });
  }
  await db.insert(schema.user).values([
    { id: "u-ada", name: "Ada", email: "ada@example.com", login: "ada" },
    { id: "u-bo", name: "Bo", email: "bo@example.com", login: "bo" },
  ]);
  return deps;
}

describe("Versus", () => {
  test("two stored Profiles give the winners worked out by hand, and no overall winner", async () => {
    const deps = await seeded();
    const v = await versusOf(deps, "ada", "BO");
    expect(v.rows.map((r) => [r.view, r.winner])).toEqual([
      ["surviving", null],
      ["prsMerged", "b"],
      ["reviews", "tie"],
      ["commits", "a"],
      ["linesAdded", "a"],
      ["activeDays", "b"],
      ["longestStreak", "a"],
      ["hoursToMerge", "b"],
    ]);
    expect(Object.keys(v)).toEqual(["a", "b", "rows"]);
  });

  test("a hidden Profile is refused, and so is a person against themselves", async () => {
    const deps = await seeded();
    await saveChoices(deps, "u-bo", "bo", { hidden: true });
    await expect(versusOf(deps, "ada", "bo")).rejects.toThrow("@bo has chosen to stay out of comparisons");
    await expect(versusOf(deps, "bo", "ada")).rejects.toThrow("stay out");
    await expect(versusOf(deps, "ada", "ADA")).rejects.toThrow("two different people");
  });

  test("a month's numbers come from the Profile's months", () => {
    expect(monthOf(profile("x", {}, [{ month: "2026-09", contributions: 5, prsMerged: 2 }]), "2026-09")).toEqual({ prsMerged: 2, contributions: 5 });
    expect(monthOf(profile("x", {}), "2026-09")).toEqual({ prsMerged: 0, contributions: 0 });
  });
});

describe("Rivals", () => {
  test("added and removed, never oneself, five at most, and a Rival who hides says only that", async () => {
    const deps = await seeded();
    await addRival(deps.db, "u-ada", "ada", "Bo");
    await addRival(deps.db, "u-ada", "ada", "bo");
    expect(await rivalLogins(deps.db, "u-ada")).toEqual(["bo"]);
    await expect(addRival(deps.db, "u-ada", "ada", "ADA")).rejects.toThrow("your own Rival");
    for (const l of ["r1", "r2", "r3", "r4"]) await addRival(deps.db, "u-ada", "ada", l);
    await expect(addRival(deps.db, "u-ada", "ada", "r5")).rejects.toThrow("Five Rivals at most");
    for (const l of ["r1", "r2", "r3", "r4"]) await removeRival(deps.db, "u-ada", l);
    const gaps = await rivalsOf(deps, "u-ada", "ada");
    expect(gaps).toEqual([{ login: "bo", name: "BO", gaps: [{ label: "pull requests merged this month", mine: 4, theirs: 7, unit: ["pull request merged", "pull requests merged"] }, { label: "contributions this month", mine: 61, theirs: 40, unit: ["contribution", "contributions"] }] }]);
    await saveChoices(deps, "u-bo", "bo", { hidden: true });
    expect(await rivalsOf(deps, "u-ada", "ada")).toEqual([{ login: "bo", hidden: true }]);
  });
});
