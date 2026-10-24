import { describe, expect, test } from "vitest";
import { answer, askedOf, commitsUnder, DAY, filesUnder, MONTH, monthsOf, windowOf, type IndexView } from "./index";
import { reportSource } from "../source";
import type { Overview, People } from "../types";

const anchor = 100 * DAY;

function view(): IndexView {
  const times = [10 * DAY, 50 * DAY, 90 * DAY, 95 * DAY];
  const n = times.length;
  const persons = new Map([
    [0, { id: 0, name: "Ada", colour: 0, login: "ada", traits: 0, identities: 1, commits: 3 }],
    [1, { id: 1, name: "bot", colour: null, login: null, traits: 4, identities: 1, commits: 1 }],
  ]);
  const head = [{ file: 0, blob: "b0", loc: 10, bytes: 100, class: "source" as const }];
  return {
    anchor,
    options: { max_changeset_size: 50, coupling_support: 5, ownership_min_commits: 10 },
    lines: true,
    snapshot: { commits: n, merges: 0, oldest: times[0] ?? null, newest: times[n - 1] ?? null, languages: [], code_age: [], suspects: [], releases: [] },
    ids: ["a", "b", "c", "d"],
    time: Float64Array.from(times),
    offset: new Int16Array(n),
    authorDelta: new Int32Array(n),
    person: Int32Array.from([0, 0, 0, 1]),
    flags: new Uint8Array(n),
    kind: new Uint8Array(n),
    start: Uint32Array.from([0, 1, 2, 3, 4]),
    file: Int32Array.from([0, 0, 0, 0]),
    added: Int32Array.from([5, 5, 5, 5]),
    removed: Int32Array.from([1, 1, 1, 1]),
    paths: ["src/a.ts"],
    born: Float64Array.from([10 * DAY]),
    last: Float64Array.from([95 * DAY]),
    known: Uint8Array.from([1]),
    role: Uint8Array.from([0]),
    language: ["TypeScript"],
    guessedGenerated: new Uint8Array(1),
    lockfile: new Uint8Array(1),
    head,
    headOf: new Map(head.map((h) => [h.file, h])),
    persons,
    byPath: new Map([["src/a.ts", 0]]),
  };
}

describe("a Window", () => {
  test("is one of the Report's spans back from the anchor", () => {
    expect(windowOf(view(), { window: "30d" })).toEqual({ label: "30d", window: { from: 70 * DAY, to: anchor } });
    expect(windowOf(view(), {})).toEqual({ label: "all", window: { from: null, to: anchor } });
    expect(windowOf(view(), { window: "2w" })).toBeNull();
  });

  test("or any dates, which every screen answers", () => {
    expect(windowOf(view(), { from: 40 * DAY, to: 92 * DAY })).toEqual({ label: "range", window: { from: 40 * DAY, to: 92 * DAY } });
    expect(windowOf(view(), { from: 9 * DAY, to: 8 * DAY })).toBeNull();
    const o = answer(view(), "/api/overview", { from: 40 * DAY, to: 92 * DAY }) as Overview;
    expect(o).toMatchObject({ window: "range", commits: 2, active_days: 2 });
  });
});

describe("the people of a Window", () => {
  test("leave Bots apart and count Lines Changed", () => {
    const p = answer(view(), "/api/people", { window: "all" }) as People;
    expect(p.people.map((r) => [r.person.name, r.commits, r.lines_added])).toEqual([["Ada", 3, 15]]);
    expect(p.bots.map((b) => [b.person.name, b.commits])).toEqual([["bot", 1]]);
  });
});

describe("an answer cut to its first people", () => {
  test("keeps its shape and says how many it listed", () => {
    const whole = answer(view(), "/api/people", { window: "all" }) as People;
    const cut = answer(view(), "/api/people", { window: "all", top: 0 }) as People & { count: number };
    expect(cut).toEqual({ ...whole, people: [], count: 1 });
    const all = answer(view(), "/api/overview", { window: "all" }) as Overview;
    const overview = answer(view(), "/api/overview", { window: "all", top: 1 }) as Overview & { count: number };
    expect(overview.people).toEqual(all.people.slice(0, 1));
    expect(overview.count).toBe(all.people.length);
    expect(answer(view(), "/api/people", { window: "all", top: "lots" })).toEqual(whole);
  });

  test("the same from a stored Report, which holds the whole answer", async () => {
    const whole = answer(view(), "/api/people", { window: "all" });
    const source = reportSource({ meta: { name: "r", windows: ["all"], window: "all", anchor, history: "full", lines: "counted", avatars: false }, data: { "/api/people?window=all": whole } }, "r");
    expect(await source.get("/api/people", { window: "all", top: 0 })).toMatchObject({ people: [], count: 1 });
    expect(await source.get("/api/people", { window: "all" })).toEqual(whole);
  });

  test("a question keeps only the params its answer depends on", () => {
    expect(askedOf({ window: "all", person: 3, folder: "src/", top: 8, path: "" })).toEqual({ window: "all", top: 8 });
  });
});

describe("the commits under a path", () => {
  test("are those that touched its files at HEAD, newest first, counted by month", () => {
    expect(filesUnder(view(), "src/")).toEqual([0]);
    expect(filesUnder(view(), "docs/")).toEqual([]);
    expect(commitsUnder(view(), "src/a.ts")).toEqual([3, 2, 1, 0]);
    const months = monthsOf(view(), [3, 2, 1, 0], anchor);
    expect(months?.from).toBe(10 * DAY);
    expect(months?.step).toBe(MONTH);
    expect(months?.counts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(months?.counts).toHaveLength(Math.ceil((90 * DAY) / MONTH));
    expect(monthsOf(view(), [], anchor)).toBeNull();
  });
});
