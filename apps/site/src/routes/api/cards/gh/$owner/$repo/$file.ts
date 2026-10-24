import { REPO_CARDS } from "@commitscape/ui";
import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/gh/$owner/$repo/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, REPO_CARDS, { owner: params.owner, repo: params.repo }) } },
});
