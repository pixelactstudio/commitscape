import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { besidePack, readEntry, screensKey, storeReport } from "./reports";
import { memoryStorage } from "./storage";

const meta = { name: "rocket", windows: ["all"], window: "all", anchor: 0, history: "full", lines: "counted", avatars: false };

const stored = (storage: ReturnType<typeof memoryStorage>, prefix: string, data: Record<string, unknown>) => storeReport(storage, prefix, gzipSync(JSON.stringify({ meta, data })));

describe("a stored Report's answers", () => {
  it("read back one by one under the Report's prefix", async () => {
    const storage = memoryStorage();
    await stored(storage, "reports/gh/1/b", { "/api/overview?window=all": { commits: 3 }, "/api/stats?": { bus_factor: 1 } });
    expect(await readEntry(storage, "reports/gh/1/b", "/api/overview?window=all")).toEqual({ commits: 3 });
    expect(await readEntry(storage, "reports/gh/1/b", "/api/stats?")).toEqual({ bus_factor: 1 });
    expect(await readEntry(storage, "reports/gh/1/b", "/api/people?window=all")).toBeNull();
  });

  it("are read from the bucket once and kept as their bytes, so what a reader does with one never shows in the next", async () => {
    const storage = memoryStorage();
    await stored(storage, "reports/gh/2/b", { "/api/overview?window=all": { commits: 3, people: [{ id: 1 }] } });
    let gets = 0;
    const get = storage.get.bind(storage);
    storage.get = async (key) => {
      gets += 1;
      return get(key);
    };
    const first = await readEntry<{ commits: number; people: { id: number }[] }>(storage, "reports/gh/2/b", "/api/overview?window=all");
    if (first) first.people.push({ id: 2 });
    expect(await readEntry(storage, "reports/gh/2/b", "/api/overview?window=all")).toEqual({ commits: 3, people: [{ id: 1 }] });
    expect(gets).toBe(1);
  });

  it("asked for at once by several readers are read from the bucket once", async () => {
    const storage = memoryStorage();
    await stored(storage, "reports/gh/3/b", { "/api/stats?": { commits: 9 } });
    let gets = 0;
    const get = storage.get.bind(storage);
    storage.get = async (key) => {
      gets += 1;
      await new Promise((r) => setTimeout(r, 20));
      return get(key);
    };
    const all = await Promise.all([1, 2, 3].map(() => readEntry(storage, "reports/gh/3/b", "/api/stats?")));
    expect(all).toEqual([{ commits: 9 }, { commits: 9 }, { commits: 9 }]);
    expect(gets).toBe(1);
  });
});

describe("what is kept beside a pack", () => {
  it("is its Atlas and its screens, named by the pack, and nothing of another pack's", () => {
    const pack = "packs/acme/rocket/7/a-b1-lines.pack";
    expect(screensKey(pack)).toBe(`${pack}.screens`);
    const beside = besidePack(7, pack);
    expect(beside).toContain(screensKey(pack));
    expect(beside.some((p) => p.startsWith("atlas/7/"))).toBe(true);
    expect(beside.some((p) => screensKey("packs/acme/rocket/7/a-b2-lines.pack").startsWith(p))).toBe(false);
  });
});
