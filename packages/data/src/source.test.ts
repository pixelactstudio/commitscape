import { describe, expect, test } from "vitest";
import { fetchReport, key, NOT_IN_REPORT, readReport, reportSource, type Report } from "./source";
import type { Meta } from "./types";

const meta: Meta = {
  name: "demo",
  windows: ["30d", "90d", "1y", "all"],
  window: "90d",
  anchor: 0,
  history: "complete",
  lines: "counted",
  github: "ready",
  github_history: "complete",
  can_change_people: false,
  can_share: false,
  avatars: false,
  generation: 0,
};

const report: Report = {
  meta,
  data: { "/api/overview?window=90d": { commits: 3 } },
  cards: { "90d": "<svg/>" },
};

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("key", () => {
  test("sorts the parameters and leaves out empty ones", () => {
    expect(key("/api/map", { window: "all", path: "src/a b", person: undefined, folder: "" })).toBe(
      "/api/map?path=src%2Fa%20b&window=all",
    );
  });
});

describe("a Report", () => {
  test("answers what it was written with, and says what it was not", async () => {
    const source = reportSource(report);
    expect(source.kind).toBe("report");
    expect(await source.get("/api/overview", { window: "90d" })).toEqual({ commits: 3 });
    await expect(source.get("/api/overview", { window: "1y" })).rejects.toThrow(NOT_IN_REPORT);
    expect(await source.card("90d")).toBe("<svg/>");
    expect(source.changePerson).toBeUndefined();
  });

  test("is read gzipped or not", async () => {
    const text = JSON.stringify(report);
    expect(await readReport(new TextEncoder().encode(text))).toEqual(report);
    expect(await readReport(await gzip(text))).toEqual(report);
  });

  test("is fetched, decrypted, then read like an inlined one", async () => {
    const body = await gzip(JSON.stringify(report));
    // A stand-in cipher: every byte flipped.
    const locked = body.map((b) => b ^ 0xff);
    const fetcher = (async () => new Response(locked)) as unknown as typeof fetch;
    const source = await fetchReport("/r", { fetcher, decrypt: async (b) => b.map((x) => x ^ 0xff) });
    expect(source.meta?.name).toBe("demo");
    expect(await source.get("/api/overview", { window: "90d" })).toEqual({ commits: 3 });
  });

  test("a failed download says why", async () => {
    const fetcher = (async () => new Response("gone", { status: 410 })) as unknown as typeof fetch;
    await expect(fetchReport("/r", { fetcher })).rejects.toThrow("gone");
  });
});
