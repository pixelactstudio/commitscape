import { describe, expect, test } from "vitest";
import { schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { saveChoices } from "./people";
import { answer, createCrew, createRace, crewOf, invite, leave, mineOf, raceOf } from "./races";

function github() {
  const asked: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string };
    const data: Record<string, unknown> = {};
    for (const m of query.matchAll(/u(\d+): user\(login: "([^"]+)"\)/g)) {
      asked.push(m[2] ?? "");
      data[`u${m[1]}`] = { login: m[2], name: null, contributionsCollection: { totalCommitContributions: 10, totalPullRequestReviewContributions: 2, contributionCalendar: { totalContributions: 15 } } };
      data[`p${m[1]}`] = { issueCount: (m[2]?.length ?? 0) };
    }
    return Response.json({ data });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

async function setup() {
  const db = await testDb();
  for (const login of ["alice", "bob", "carol", "dee"]) await db.insert(schema.user).values({ id: `u-${login}`, name: login, email: `${login}@example.com`, login });
  const gh = github();
  return { db, gh, deps: { db, github: { api: "http://github.test", token: "t", fetcher: gh.fetcher } } };
}

const me = (login: string) => ({ userId: `u-${login}`, login });
const today = new Date().toISOString().slice(0, 10);
const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

describe("Races", () => {
  test("only people who accept are in it; invitations show only to people in it; Standings are kept for 15 minutes", async () => {
    const { db, gh, deps } = await setup();
    const id = await createRace(db, me("alice"), { name: "Sprint", from: today, to: inAWeek, invite: ["Bob", "@carol", "alice"] });
    let r = await raceOf(deps, null, id);
    expect(r.members.map((m) => m.login)).toEqual(["alice"]);
    expect(r.standings?.rows.map((x) => x.login)).toEqual(["alice"]);
    expect((await raceOf(deps, me("alice"), id)).members.map((m) => `${m.login}:${m.state}`)).toEqual(["alice:accepted", "bob:invited", "carol:invited"]);
    expect((await mineOf(db, me("bob"))).invitations).toEqual([{ kind: "race", id, name: "Sprint", invitedBy: "alice" }]);
    await answer(db, me("bob"), "race", id, true);
    await answer(db, me("carol"), "race", id, false);
    await expect(answer(db, me("carol"), "race", id, true)).resolves.toBeUndefined();
    await leave(db, me("carol"), "race", id);
    await expect(answer(db, me("dee"), "race", id, true)).rejects.toThrow("No invitation of yours");
    r = await raceOf(deps, null, id);
    expect(r.standings?.rows.map((x) => [x.login, x.prsMerged])).toEqual([
      ["alice", 5],
      ["bob", 3],
    ]);
    const before = gh.asked.length;
    await raceOf(deps, null, id);
    expect(gh.asked.length).toBe(before);
    expect((await mineOf(db, me("bob"))).races.map((x) => x.name)).toEqual(["Sprint"]);
  });

  test("a Race not started has no Standings, and asks GitHub nothing", async () => {
    const { db, gh, deps } = await setup();
    const id = await createRace(db, me("alice"), { name: "Later", from: inAWeek, to: inAWeek, invite: ["bob"] });
    expect((await raceOf(deps, null, id)).standings).toBeNull();
    expect(gh.asked).toEqual([]);
  });

  test("its dates, name, people and size are checked", async () => {
    const { db } = await setup();
    await expect(createRace(db, me("alice"), { name: "x", from: today, to: today, invite: ["bob"] })).rejects.toThrow("2 to 60");
    await expect(createRace(db, me("alice"), { name: "Ok", from: inAWeek, to: today, invite: ["bob"] })).rejects.toThrow("on or after the first");
    await expect(createRace(db, me("alice"), { name: "Ok", from: "2024-01-01", to: "2026-01-01", invite: ["bob"] })).rejects.toThrow("a year at most");
    await expect(createRace(db, me("alice"), { name: "Ok", from: today, to: today, invite: [] })).rejects.toThrow("at least one person");
    await expect(createRace(db, me("alice"), { name: "Ok", from: today, to: today, invite: ["-bad"] })).rejects.toThrow("not a GitHub username");
    await expect(createRace(db, me("alice"), { name: "Ok", from: today, to: today, invite: Array.from({ length: 20 }, (_, i) => `p${i}`) })).rejects.toThrow("20 people at most");
  });
});

describe("Crews", () => {
  test("someone who leaves is out at once; a hidden person can be neither invited nor seen, nor join", async () => {
    const { db, deps } = await setup();
    const id = await createCrew(db, me("alice"), { name: "Night shift", invite: ["bob", "carol"] });
    await answer(db, me("bob"), "crew", id, true);
    await answer(db, me("carol"), "crew", id, true);
    expect((await crewOf(deps, null, id)).standings?.rows.map((r) => r.login)).toEqual(["alice", "bob", "carol"]);
    await leave(db, me("carol"), "crew", id);
    const after = await crewOf(deps, null, id);
    expect(after.members.map((m) => m.login)).toEqual(["alice", "bob"]);
    expect(after.standings?.rows.map((r) => r.login)).toEqual(["alice", "bob"]);
    await saveChoices({ db }, "u-dee", "dee", { hidden: true });
    await expect(invite(db, me("alice"), "crew", id, ["dee"])).rejects.toThrow("@dee has chosen to stay out");
    await expect(invite(db, me("carol"), "crew", id, ["dee"])).rejects.toThrow("Only people in it");
    await saveChoices({ db }, "u-bob", "bob", { hidden: true });
    expect((await crewOf(deps, null, id)).standings?.rows.map((r) => r.login)).toEqual(["alice"]);
    await saveChoices({ db }, "u-bob", "bob", { hidden: false });
    await invite(db, me("alice"), "crew", id, ["carol"]);
    await saveChoices({ db }, "u-carol", "carol", { hidden: true });
    await expect(answer(db, me("carol"), "crew", id, true)).rejects.toThrow("stay out of comparisons");
  });
});
