import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/gh/$owner/$repo/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["hall-of-fame"], { owner: params.owner, repo: params.repo }) } },
});
