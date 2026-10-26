import { createFileRoute } from "@tanstack/react-router";
import { env } from "#/server/env";
import { ingest } from "#/server/ingest";

const forward = ({ request }: { request: Request }) => (env.PUBLIC_POSTHOG_KEY ? ingest(request, { apiHost: env.PUBLIC_POSTHOG_HOST, countryHeader: env.COUNTRY_HEADER, addressHeader: env.CLIENT_IP_HEADER }) : new Response(null, { status: 404 }));

export const Route = createFileRoute("/ingest/$")({
  server: { handlers: { GET: forward, HEAD: forward, POST: forward, OPTIONS: forward } },
});
