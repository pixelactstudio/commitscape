import * as Sentry from "@sentry/node";
import { expect, test } from "vitest";
import { distinctIdOf, engineSpans, Phases } from "./telemetry";

Sentry.init({ dsn: "https://public@o0.ingest.sentry.io/0", tracesSampleRate: 1, transport: () => ({ send: async () => ({}), flush: async () => true }) });

test("the engine's timing events become child spans with the engine's own times, nested as its spans were", async () => {
  const at = 1_760_000_000_000;
  const spans = await Sentry.startSpan({ name: "build full", op: "engine" }, async (parent) => {
    engineSpans([
      { span: "head_pass", start_ms: at + 100, end_ms: at + 300, fields: { files: 4 } },
      { span: "load", start_ms: at, end_ms: at + 400, fields: { commits: 9, freshness: "warm" } },
      { span: "line_pass", start_ms: at + 500, end_ms: at + 900, fields: { left: 0 } },
    ]);
    return { parent: Sentry.spanToJSON(parent), children: Sentry.getSpanDescendants(parent).map((s) => Sentry.spanToJSON(s)) };
  });
  type Json = { name: string; span_id: string; parent_span_id?: string; start_timestamp: number; end_timestamp?: number; attributes?: Record<string, unknown> };
  const byName = Object.fromEntries((spans.children as unknown as Json[]).map((s) => [s.name, s]));
  const parentId = (spans.parent as unknown as Json).span_id;
  expect(byName.load).toMatchObject({ parent_span_id: parentId, start_timestamp: at / 1000, end_timestamp: (at + 400) / 1000 });
  expect(byName.load?.attributes).toMatchObject({ "sentry.op": "engine.load", "engine.commits": 9, "engine.freshness": "warm" });
  expect(byName.head_pass).toMatchObject({ parent_span_id: byName.load?.span_id, start_timestamp: (at + 100) / 1000, end_timestamp: (at + 300) / 1000 });
  expect(byName.line_pass).toMatchObject({ parent_span_id: parentId });
});

test("each step of a Build is timed into its phases", async () => {
  const phases = new Phases();
  phases.kind = "warm";
  expect(await phases.time("clone full", "git.clone", async () => 7)).toBe(7);
  await expect(phases.time("build full", "engine", async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
  expect(Object.keys(phases.seconds)).toEqual(["clone full", "build full"]);
  expect(Object.values(phases.seconds).every((s) => typeof s === "number" && s >= 0)).toBe(true);
});

test("PostHog knows the person who asked for a Build only by a keyed hash, and the rest by their repository", () => {
  const secret = "k".repeat(32);
  const hashed = distinctIdOf({ userId: "user-1", repo: "acme/rocket" }, secret);
  expect(hashed).toMatch(/^[0-9a-f]{32}$/);
  expect(hashed).not.toContain("user-1");
  expect(distinctIdOf({ userId: "user-1", repo: "acme/rocket" }, undefined)).toBe("repo:acme/rocket");
  expect(distinctIdOf({ userId: null, repo: "private:0123456789abcdef" }, secret)).toBe("repo:private:0123456789abcdef");
});
