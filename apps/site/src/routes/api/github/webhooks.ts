import { createFileRoute } from "@tanstack/react-router";
import { db, reports } from "#/server/context";
import { env } from "#/server/env";
import { json, says } from "#/server/http";
import { githubSigned, onWebhook } from "#/server/webhooks";

export const Route = createFileRoute("/api/github/webhooks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (body.length > 1024 * 1024) return says(413, "Too large.");
        if (!githubSigned(env.GITHUB_WEBHOOK_SECRET, request.headers.get("x-hub-signature-256"), body)) return says(401, "Not signed by GitHub.");
        const removed = await onWebhook(db(), reports(), request.headers.get("x-github-event"), JSON.parse(body));
        return json({ ok: true, removed });
      },
    },
  },
});
