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
