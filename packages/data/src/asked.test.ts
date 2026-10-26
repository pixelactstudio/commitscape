import { describe, expect, test } from "vitest";
import { askedOf, limited, topOf, withoutTop } from "./asked";
import { reportSource } from "./source";

const people = { window: "all", people: [{ id: 1 }, { id: 2 }, { id: 3 }], bots: [] };

describe("an answer cut to its first people", () => {
  test("keeps its shape and says how many it listed", () => {
    expect(limited("/api/people", 1, people)).toEqual({ ...people, people: [{ id: 1 }], count: 3 });
    expect(limited("/api/overview", 0, { commits: 4, people: people.people })).toEqual({ commits: 4, people: [], count: 3 });
    expect(limited("/api/people", null, people)).toBe(people);
    expect(limited("/api/activity", 1, people)).toBe(people);
    expect(limited("/api/people", 1, null)).toBeNull();
  });

  test("asks for a whole number of people up to the most, else for all of them", () => {
    expect([topOf({ top: 8 }), topOf({ top: "0" }), topOf({ top: "1000" })]).toEqual([8, 0, 1000]);
    expect([topOf({}), topOf({ top: "" }), topOf({ top: "lots" }), topOf({ top: -1 }), topOf({ top: 1001 }), topOf({ top: 1.5 })]).toEqual([null, null, null, null, null, null]);
    expect(withoutTop({ window: "all", top: 8 })).toEqual({ window: "all" });
  });

  test("the same from a stored Report, which holds the whole answer", async () => {
    const source = reportSource({ meta: { name: "r", windows: ["all"], window: "all", anchor: 0, history: "full", lines: "counted", avatars: false }, data: { "/api/people?window=all": people } }, "r");
    expect(await source.get("/api/people", { window: "all", top: 0 })).toMatchObject({ people: [], count: 3 });
    expect(await source.get("/api/people", { window: "all" })).toEqual(people);
  });

  test("a question keeps only the params its answer depends on", () => {
    expect(askedOf({ window: "all", person: 3, folder: "src/", top: 8, path: "" })).toEqual({ window: "all", top: 8 });
  });
});
