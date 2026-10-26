import * as Sentry from "@sentry/tanstackstart-react";
import { expect, test } from "vitest";
import type { BuildJob, Queue } from "@commitscape/server";
import { traced } from "./queue";

Sentry.init({ dsn: "https://public@o0.ingest.sentry.io/0", tracesSampleRate: 1, transport: () => ({ send: async () => ({}), flush: async () => true }) });

test("a Build sent within a request carries that request's trace for the Builder to continue", async () => {
  const sent: [BuildJob, number][] = [];
  const queue: Queue = { send: async (job, priority) => void sent.push([job, priority]) };
  const traceId = await Sentry.startSpan({ name: "POST /api/builds", op: "http.server" }, async (span) => {
    await traced(queue).send({ buildId: "b1", repoId: "acme/rocket" }, 10);
    return span.spanContext().traceId;
  });
  const [job, priority] = sent[0] ?? [];
  expect(priority).toBe(10);
  expect(job).toMatchObject({ buildId: "b1", repoId: "acme/rocket" });
  expect(job?.trace?.sentryTrace.startsWith(`${traceId}-`)).toBe(true);
  expect(job?.trace?.baggage).toContain(`sentry-trace_id=${traceId}`);
});
