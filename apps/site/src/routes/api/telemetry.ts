import { createFileRoute } from "@tanstack/react-router";
import { CLI_LIMIT, cliRunOf } from "#/server/cli-telemetry";
import { db, siteAnalytics } from "#/server/context";
import { env } from "#/server/env";
import { answer, clientAddress, says } from "#/server/http";
import { allow } from "#/server/limits";

export const Route = createFileRoute("/api/telemetry")({
  server: {
    handlers: {
      POST: ({ request }) =>
        answer(async () => {
          if (Number(request.headers.get("content-length") ?? 0) > 2048) return says(413, "Too large.");
          const run = cliRunOf(await request.json().catch(() => null));
          if (!run) return says(400, "Not a run of the command.");
          if (!(await allow(db(), CLI_LIMIT, clientAddress(request, env.CLIENT_IP_HEADER)))) return new Response(null, { status: 429 });
          const { id, ...properties } = run;
          siteAnalytics().capture("cli command run", { userId: null, headers: request.headers, distinctId: `cli:${id}` }, properties);
          return new Response(null, { status: 204 });
        }),
    },
  },
});
