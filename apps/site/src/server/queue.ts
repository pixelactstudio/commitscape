import "@tanstack/react-start/server-only";
import * as Sentry from "@sentry/tanstackstart-react";
import { BUILD_QUEUE, type Queue } from "@commitscape/server";

/** The Build queue with each job sent in a `queue.publish` span and carrying the trace of the request that queued it, which the Builder continues. */
export function traced(inner: Queue): Queue {
  return {
    ...inner,
    send: (job, priority) =>
      Sentry.startSpan({ name: BUILD_QUEUE, op: "queue.publish", attributes: { "messaging.system": "pg-boss", "messaging.destination.name": BUILD_QUEUE, "messaging.message.id": job.buildId } }, () => {
        const trace = Sentry.getTraceData();
        const sentryTrace = trace["sentry-trace"];
        return inner.send(sentryTrace ? { ...job, trace: { sentryTrace, baggage: trace.baggage ?? "" } } : job, priority);
      }),
  };
}
