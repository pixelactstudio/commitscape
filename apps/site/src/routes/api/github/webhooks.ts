import { createFileRoute } from "@tanstack/react-router";
import { builds, db, reports, siteAnalytics } from "#/server/context";
import { env } from "#/server/env";
import { json, says } from "#/server/http";
import { githubSigned, onWebhook, type Event } from "#/server/webhooks";

function counted(kind: string | null, event: Event): void {
  if (kind !== "installation" && kind !== "installation_repositories") return;
  const gone = event.action === "deleted" || event.action === "removed";
  const repositories = (gone ? (event.repositories_removed ?? event.repositories) : (event.repositories_added ?? event.repositories))?.length ?? 0;
  siteAnalytics().capture(gone ? "app removed" : "app installed", { userId: null }, { kind, action: event.action ?? null, repositories });
}

export const Route = createFileRoute("/api/github/webhooks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (body.length > 1024 * 1024) return says(413, "Too large.");
        if (!githubSigned(env.GITHUB_WEBHOOK_SECRET, request.headers.get("x-hub-signature-256"), body)) return says(401, "Not signed by GitHub.");
        const kind = request.headers.get("x-github-event");
        const event = JSON.parse(body) as Event;
        const handled = await onWebhook({ db: db(), storage: reports(), queue: builds }, kind, event, request.headers.get("x-github-delivery") ?? undefined);
        counted(kind, event);
        return json({ ok: true, ...handled });
      },
    },
  },
});
