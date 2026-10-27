import { expect, test } from "vitest";
import { packFormatOf } from "./formats";

const answering = (body: unknown, status = 200) => {
  let asked = 0;
  const fetcher = (async () => {
    asked += 1;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetcher, asked: () => asked };
};

test("format 3 only for an engine service that says it reads it, format 2 for an older one or one that cannot be asked", async () => {
  expect(await packFormatOf(undefined)()).toBe(3);
  const now = answering({ ok: true, pack_formats: [2, 3] });
  const format = packFormatOf("http://engine:4100", now.fetcher);
  expect([await format(), await format()]).toEqual([3, 3]);
  expect(now.asked()).toBe(1);
  expect(await packFormatOf("http://engine:4100", answering({ ok: true }).fetcher)()).toBe(2);
  expect(await packFormatOf("http://engine:4100", answering({ ok: false }, 503).fetcher)()).toBe(2);
  const down = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  expect(await packFormatOf("http://engine:4100", down)()).toBe(2);
});
