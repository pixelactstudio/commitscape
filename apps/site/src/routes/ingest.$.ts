import { createFileRoute } from "@tanstack/react-router";
import { env } from "#/server/env";
import { ingest } from "#/server/ingest";

const forward = ({ request }: { request: Request }) => (env.PUBLIC_POSTHOG_KEY ? ingest(request, env.PUBLIC_POSTHOG_HOST) : new Response(null, { status: 404 }));

export const Route = createFileRoute("/ingest/$")({
  server: { handlers: { GET: forward, HEAD: forward, POST: forward, OPTIONS: forward } },
});
