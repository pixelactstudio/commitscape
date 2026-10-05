import { expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { leaderboards } from "./boards";

test("the boards rank built seeds only, most first", async () => {
  const db = await testDb();
  const seed = (name: string, fields: Partial<typeof schema.repositories.$inferInsert>) =>
    db.insert(schema.repositories).values({ id: `acme/${name}`, owner: "acme", name, seed: true, reportAt: now(), stars: 1, ...fields });
  await seed("solo", { busFactor: 1, stars: 900, commits30d: 3 });
  await seed("busy", { busFactor: 3, commits30d: 50, people30d: 9 });
  await seed("unbuilt", { busFactor: 1, reportAt: null, stars: 5000 });
  await db.insert(schema.repositories).values({ id: "acme/visited", owner: "acme", name: "visited", reportAt: now(), busFactor: 1 });
  const boards = await leaderboards(db);
  expect(boards.from).toBe(2);
  const board = (id: string) => boards.boards.find((b) => b.id === id)?.rows.map((r) => r.name);
  expect(board("one_person")).toEqual(["solo"]);
  expect(board("active_commits")).toEqual(["busy", "solo"]);
});

test("a moved repository is ranked once, and a board never ranks repositories by a share of nothing", async () => {
  const db = await testDb();
  const seed = (id: string, fields: Partial<typeof schema.repositories.$inferInsert>) => db.insert(schema.repositories).values({ id, owner: id.split("/")[0] ?? "", name: id.split("/")[1] ?? "", seed: true, stars: 1, ...fields });
  await seed("old/app", { githubId: 4, reportAt: 10, commits30d: 9, codeLines: 5000, busFactor: 2, untouched5y: 0 });
  await seed("new/app", { githubId: 4, reportAt: 20, commits30d: 9, codeLines: 5000, busFactor: 2, untouched5y: 0 });
  await seed("aged/lib", { githubId: 5, reportAt: 20, commits30d: 1, codeLines: 2000, busFactor: 1, untouched5y: 500 });
  const boards = await leaderboards(db);
  expect(boards.from).toBe(2);
  const board = (id: string) => boards.boards.find((b) => b.id === id)?.rows.map((r) => `${r.owner}/${r.name}`);
  expect(board("active_commits")).toEqual(["new/app", "aged/lib"]);
  expect(board("oldest_code")).toEqual(["aged/lib"]);
});
