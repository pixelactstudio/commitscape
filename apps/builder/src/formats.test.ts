import { expect, test } from "vitest";
import { ENGINE_FORMATS_KEY, memoryStorage } from "@commitscape/server";
import { packFormatOf } from "./formats";

const answering = (body: unknown, status = 200) => {
  let asked = 0;
  const fetcher = (async () => {
    asked += 1;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetcher, asked: () => asked };
};

const down = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;

const marked = (formats: unknown) => {
  const storage = memoryStorage();
  void storage.put(ENGINE_FORMATS_KEY, JSON.stringify({ pack_formats: formats, version: "0.4.0" }), { type: "application/json" });
  return storage;
};

test("the format comes from PACK_FORMAT, else the engine service's health answer, else its marker in R2, else 3", async () => {
  expect(await packFormatOf({})()).toBe(3);
  expect(await packFormatOf({ storage: memoryStorage() })()).toBe(3);
  expect(await packFormatOf({ storage: { get: () => Promise.reject(new Error("R2 is down")) } })()).toBe(3);
  expect(await packFormatOf({ storage: marked([2]) })()).toBe(2);
  expect(await packFormatOf({ storage: marked([2, 3]) })()).toBe(3);
  expect(await packFormatOf({ storage: marked([3, 4]) })()).toBe(3);
  expect(await packFormatOf({ storage: marked([4]) })()).toBe(3);
  expect(await packFormatOf({ setting: 3, storage: marked([2]) })()).toBe(3);
  expect(await packFormatOf({ setting: 2, storage: marked([2, 3]) })()).toBe(2);
  expect(await packFormatOf({ setting: 2, url: "http://engine:4100", storage: marked([2, 3]) }, answering({ ok: true, pack_formats: [2, 3] }).fetcher)()).toBe(2);
});

test("an engine service the Builder can reach answers for itself, and one it cannot leaves the marker to say", async () => {
  const now = answering({ ok: true, pack_formats: [2, 3] });
  const lines: string[] = [];
  const format = packFormatOf({ url: "http://engine:4100", storage: marked([2]), log: (l) => lines.push(l) }, now.fetcher);
  expect([await format(), await format()]).toEqual([3, 3]);
  expect(now.asked()).toBe(1);
  expect(lines).toEqual(["packs: format 3, from the engine service's health answer"]);
  expect(await packFormatOf({ url: "http://engine:4100", storage: marked([2, 3]) }, answering({ ok: true }).fetcher)()).toBe(2);
  expect(await packFormatOf({ url: "http://engine:4100", storage: marked([2]) }, answering({ ok: false }, 503).fetcher)()).toBe(2);
  expect(await packFormatOf({ url: "http://engine:4100", storage: marked([2, 3]) }, down)()).toBe(3);
  expect(await packFormatOf({ url: "http://engine:4100" }, down)()).toBe(3);
});
