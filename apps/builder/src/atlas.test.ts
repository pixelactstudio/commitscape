import { expect, test } from "vitest";
import { memoryStorage } from "@commitscape/server";
import { replaceIndex } from "./atlas";

const put = (storage: ReturnType<typeof memoryStorage>, key: string) => storage.put(key, "x", { type: "application/octet-stream" });

test("loading a new Stored Index deletes the Atlas payloads of the one it replaces and keeps every other", async () => {
  const storage = memoryStorage();
  await put(storage, "atlas/7/aaaa/map.bin.br");
  await put(storage, "atlas/7/bbbb/names.bin.br");
  await put(storage, "atlas/70/cccc/map.bin.br");
  await put(storage, "atlas/8/dddd/map.bin.br");
  const loaded = await replaceIndex(storage, { id: 7 }, async () => ({ si: 9 }));
  expect(loaded.si).toBe(9);
  expect([...storage.objects.keys()].sort()).toEqual(["atlas/70/cccc/map.bin.br", "atlas/8/dddd/map.bin.br"]);
});

test("loading into the same Stored Index, or the first one, deletes nothing", async () => {
  const storage = memoryStorage();
  await put(storage, "atlas/7/aaaa/map.bin.br");
  await replaceIndex(storage, { id: 7 }, async () => ({ si: 7 }));
  await replaceIndex(storage, null, async () => ({ si: 8 }));
  expect([...storage.objects.keys()]).toEqual(["atlas/7/aaaa/map.bin.br"]);
});

test("a failed load deletes nothing", async () => {
  const storage = memoryStorage();
  await put(storage, "atlas/7/aaaa/map.bin.br");
  await expect(replaceIndex(storage, { id: 7 }, async () => Promise.reject(new Error("COPY failed")))).rejects.toThrow("COPY failed");
  expect(storage.objects.size).toBe(1);
});
