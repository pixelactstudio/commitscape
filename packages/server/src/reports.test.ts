import { describe, expect, it } from "vitest";
import { isStoredScreen, readEntry, storeEntries } from "./reports";
import { memoryStorage } from "./storage";

describe("screens stored with a Report", () => {
  it("are the stats and the four screens of the stored Windows, whatever top asks for", () => {
    expect(isStoredScreen("/api/stats", {})).toBe(true);
    expect(isStoredScreen("/api/overview", { window: "all", top: "8" })).toBe(true);
    expect(isStoredScreen("/api/people", { window: "1y" })).toBe(true);
    expect(isStoredScreen("/api/map", { window: "90d" })).toBe(true);
    expect(isStoredScreen("/api/activity", { window: "30d" })).toBe(false);
    expect(isStoredScreen("/api/map", { window: "all", path: "src" })).toBe(false);
    expect(isStoredScreen("/api/overview", { from: "0", to: "86399" })).toBe(false);
    expect(isStoredScreen("/api/person", { window: "all", id: "1" })).toBe(false);
    expect(isStoredScreen("/api/stats", { window: "all" })).toBe(false);
  });

  it("read back one by one under the Report's prefix", async () => {
    const storage = memoryStorage();
    const written = await storeEntries(storage, "reports/gh/1/b", { "/api/overview?window=all": { commits: 3 }, "/api/stats?": { bus_factor: 1 } });
    expect(written).toBe(2);
    expect(await readEntry(storage, "reports/gh/1/b", "/api/overview?window=all")).toEqual({ commits: 3 });
    expect(await readEntry(storage, "reports/gh/1/b", "/api/stats?")).toEqual({ bus_factor: 1 });
    expect(await readEntry(storage, "reports/gh/1/b", "/api/people?window=all")).toBeNull();
  });

  it("are read from the bucket once and kept as their bytes, so what a reader does with one never shows in the next", async () => {
    const storage = memoryStorage();
    await storeEntries(storage, "reports/gh/2/b", { "/api/overview?window=all": { commits: 3, people: [{ id: 1 }] } });
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
});
