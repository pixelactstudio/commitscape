import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/u/$login/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["totals", "survival", "repositories", "calendar", "languages", "preview", "archetype", "achievement"], { login: params.login }) } },
});
