import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "./bytes";
import { AtlasEngine, COLOUR, DAY_SECONDS } from "./engine";
import { cellKey, DIRECTIONS, gosper, hexAt, hexX, hexZ, layoutOf } from "./layout";
import { atlasOf, decodeAtlas, decodeNames, encodeAtlas, encodeNames, folderPath, type AtlasRows } from "./payload";

const T0 = 1_500_000_000;
const D = DAY_SECONDS;

function rows(): AtlasRows {
  const files = [
    { file: 10, path: "README.md", alive: true, role: 3, language: "Markdown", generated: false, lockfile: false, lines: 40 },
    { file: 11, path: "src/a.ts", alive: true, role: 0, language: "TypeScript", generated: false, lockfile: false, lines: 120 },
    { file: 12, path: "src/b.ts", alive: false, role: 0, language: "TypeScript", generated: false, lockfile: false, lines: null },
    { file: 13, path: "src/deep/c.ts", alive: true, role: 0, language: "TypeScript", generated: false, lockfile: false, lines: 9 },
    { file: 14, path: "test/a.test.ts", alive: true, role: 2, language: "TypeScript", generated: false, lockfile: false, lines: 30 },
    { file: 15, path: "never/touched.ts", alive: false, role: 0, language: null, generated: false, lockfile: false, lines: null },
  ];
  const people = [
    { id: 7, name: "Ada", login: "ada", bot: false },
    { id: 8, name: "Bob", login: null, bot: false },
    { id: 9, name: "ci-bot", login: "ci[bot]", bot: true },
  ];
  const commits = [
    { time: T0, person: 7, bulk: false, firstParent: true, files: [10, 11, 12], changes: [0, 0, 0] },
    { time: T0 + 2 * D, person: 7, bulk: false, firstParent: true, files: [11], changes: [1] },
    { time: T0 + 10 * D, person: 8, bulk: false, firstParent: false, files: [11, 13], changes: [1, 0] },
    { time: T0 + 11 * D, person: 8, bulk: false, firstParent: true, files: [11], changes: [1] },
    { time: T0 + 12 * D, person: 8, bulk: false, firstParent: true, files: [12], changes: [2] },
    { time: T0 + 40 * D, person: 9, bulk: false, firstParent: true, files: [14], changes: [0] },
    { time: T0 + 41 * D, person: 7, bulk: true, firstParent: true, files: [10, 11, 13, 14], changes: [1, 1, 1, 1] },
    { time: T0 + 800 * D, person: 8, bulk: false, firstParent: true, files: [14], changes: [1] },
  ];
  return { mainline: true, newest: T0 + 800 * D, commits, files, people, releases: [["v1", T0 + 12 * D], ["v0", T0 + 1 * D]] };
}

describe("bytes", () => {
  it("reads back what it wrote", () => {
    const w = new ByteWriter();
    const values = [0, 1, 127, 128, 300, 2 ** 31, 2 ** 40 + 3, 1_792_352_614];
    for (const v of values) w.uint(v);
    for (const v of [-1, 0, 5, -300, 2 ** 33]) w.int(v);
    w.text("héllo/wörld");
    w.byte(255);
    const r = new ByteReader(w.bytes());
    expect(values.map(() => r.uint())).toEqual(values);
    expect([1, 2, 3, 4, 5].map(() => r.int())).toEqual([-1, 0, 5, -300, 2 ** 33]);
    expect(r.text()).toBe("héllo/wörld");
    expect(r.byte()).toBe(255);
    expect(r.done).toBe(true);
    expect(() => r.byte()).toThrow();
  });
});

describe("gosper", () => {
  it("walks neighbouring hexes and never comes back to one", () => {
    const n = 7 ** 5 + 13;
    const { q, r } = gosper(n);
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const key = cellKey(q[i] as number, r[i] as number);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      if (i > 0) {
        const dq = (q[i] as number) - (q[i - 1] as number);
        const dr = (r[i] as number) - (r[i - 1] as number);
        expect(DIRECTIONS.some(([a, b]) => a === dq && b === dr)).toBe(true);
      }
    }
  });

  it("finds the hex under a point", () => {
    for (const [q, r] of [[0, 0], [3, -2], [-5, 7]] as const) expect(hexAt(hexX(q, r) + 0.3, hexZ(r) - 0.2)).toEqual([q, r]);
  });
});

describe("payload", () => {
  it("survives being written and read", () => {
    const { atlas, names } = atlasOf(rows());
    const back = decodeAtlas(encodeAtlas(atlas));
    expect(back).toEqual(atlas);
    expect(decodeNames(encodeNames(names))).toEqual(names);
  });

  it("numbers files by their first change, drops files that never changed and keeps folders from paths", () => {
    const { atlas, names } = atlasOf(rows());
    expect(names.names).toEqual(["README.md", "a.ts", "b.ts", "c.ts", "a.test.ts"]);
    expect(atlas.people.names).toEqual(["Bob", "Ada", "ci-bot"]);
    expect(folderPath(atlas, atlas.files.folder[3] as number)).toBe("src/deep");
    expect(atlas.files.lines[2]).toBe(-1);
    expect(atlas.files.lines[1]).toBe(120);
    expect(atlas.releases.names).toEqual(["v0", "v1"]);
    expect(atlas.changes.kind[2]).toBe(0);
  });

  it("refuses bytes that are not an Atlas", () => {
    expect(() => decodeAtlas(new Uint8Array([1, 2, 3]))).toThrow("not an Atlas");
  });
});

describe("layout", () => {
  const { atlas } = atlasOf(rows());
  const layout = layoutOf(atlas);

  it("gives every file its own hex", () => {
    const keys = new Set<number>();
    for (let f = 0; f < layout.count; f++) keys.add(cellKey(layout.q[f] as number, layout.r[f] as number));
    expect(keys.size).toBe(layout.count);
  });

  it("keeps each folder's files together in layout order", () => {
    for (let d = 0; d < atlas.folders.parent.length; d++) {
      const lo = layout.folderFrom[d] as number;
      const hi = layout.folderTo[d] as number;
      const inside = new Set<number>();
      for (let f = 0; f < layout.count; f++) {
        let x = atlas.files.folder[f] as number;
        while (x > 0 && x !== d) x = atlas.folders.parent[x] as number;
        if (x === d) inside.add(f);
      }
      const ranked = new Set(Array.from({ length: hi - lo }, (_, i) => layout.order[lo + i] as number));
      expect(ranked).toEqual(inside);
    }
  });

  it("knows when files were born and when they were deleted", () => {
    expect(layout.born[0]).toBe(T0);
    expect(layout.died[2]).toBe(T0 + 12 * D);
    expect(layout.died[1]).toBe(Infinity);
  });

  it("separates islands by sea", () => {
    const island = new Map<number, number>();
    layout.islands.forEach((isl, k) => {
      for (let i = isl.from; i < isl.to; i++) island.set(cellKey(layout.q[layout.order[i] as number] as number, layout.r[layout.order[i] as number] as number), k);
    });
    for (const [key, k] of island) {
      const q = Math.floor(key / 65536) - 32768;
      const r = (key % 65536) - 32768;
      for (const [dq, dr] of DIRECTIONS) {
        const other = island.get(cellKey(q + dq, r + dr));
        if (other !== undefined) expect(other).toBe(k);
      }
    }
  });

  it("draws borders only between different folders", () => {
    const readme = layout.borders[0] as number;
    const a = layout.borders[1] as number;
    expect(readme).toBe(0);
    expect(a & 0xfff).toBeGreaterThanOrEqual(0);
  });
});

describe("engine", () => {
  const { atlas, names } = atlasOf(rows());
  const engine = new AtlasEngine(atlas);
  engine.names = names.names;
  const rank = (f: number) => engine.layout.rank[f] as number;

  it("counts commits so far without Bulk Commits or hidden Bots", () => {
    const f = engine.frame({ at: T0 + 50 * D });
    expect(f.height[rank(1)]).toBe(4);
    expect(f.height[rank(4)]).toBe(0);
    engine.setBots(false);
    expect(engine.frame({ at: T0 + 50 * D }).height[rank(4)]).toBe(1);
    engine.setBots(true);
  });

  it("gives each hex the colour of whoever made most of its commits in the year before, ties to the most recent", () => {
    const f = engine.frame({ at: T0 + 50 * D });
    const ada = 1;
    const bob = 0;
    expect(f.slots.slice(0, 2).sort()).toEqual([bob, ada].sort());
    expect(f.colour[rank(1)]).toBe(f.slots.indexOf(bob));
    expect(f.colour[rank(0)]).toBe(f.slots.indexOf(ada));
    expect(f.colour[rank(4)]).toBe(COLOUR.nobody);
    const later = engine.frame({ at: T0 + 790 * D });
    expect(later.colour[rank(1)]).toBe(COLOUR.nobody);
  });

  it("keeps a person's colour while they stay among the top eight", () => {
    const early = engine.slotsAt(T0 + 3 * D);
    const after = engine.slotsAt(T0 + 20 * D);
    expect(after[early.indexOf(1)]).toBe(1);
    expect(engine.slotHistory().flat().length).toBeGreaterThan(0);
  });

  it("knows when each hex was last touched, Bulk Commits included", () => {
    const f = engine.frame({ at: T0 + 50 * D });
    expect(f.touched[rank(0)]).toBeCloseTo(engine.toWeeks(T0 + 41 * D));
  });

  it("works out a range: commits in it, its own top people", () => {
    const f = engine.frame({ at: T0 + 12 * D, from: T0 + 5 * D });
    expect(f.height[rank(1)]).toBe(2);
    expect(f.height[rank(0)]).toBe(0);
    expect(f.slots[0]).toBe(0);
  });

  it("solos a person", () => {
    const f = engine.frame({ at: T0 + 50 * D, solo: 1 });
    expect(f.colour[rank(0)]).toBe(COLOUR.solo);
    expect(f.colour[rank(1)]).toBe(COLOUR.nobody);
  });

  it("answers for a file, a folder and a person", () => {
    const file = engine.file(1, T0 + 50 * D);
    expect(file.commits).toBe(4);
    expect(file.holder).toEqual({ person: 0, commits: 2 });
    expect(file.lastTouch).toBe(T0 + 41 * D);
    expect(engine.pathOf("file", 1)).toBe("src/a.ts");
    const src = engine.folder(atlas.files.folder[1] as number, T0 + 50 * D);
    expect(src.path).toBe("src");
    expect(src.alive).toBe(2);
    expect(src.busFactor).toBe(2);
    const bob = engine.person(0, T0 + 50 * D);
    expect(bob.commits).toBe(4);
    expect(bob.folders.map((f) => f.path)).toEqual(["src", "src/deep", "test"]);
  });

  it("describes a moment", () => {
    const d = engine.describe(T0 + 12 * D);
    expect(d.alive).toBe(3);
    expect(d.month).toBe(5);
    expect(d.folder).toBe(atlas.files.folder[1]);
  });

  it("finds people, folders and files", () => {
    expect(engine.search("ada")[0]?.kind).toBe("person");
    expect(engine.search("deep").map((f) => f.label)).toContain("src/deep/");
    expect(engine.search("c.ts").map((f) => f.label)).toContain("src/deep/c.ts");
  });
});
