import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/u/$login/$owner/$repo/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["standing"], { login: params.login, owner: params.owner, repo: params.repo }) } },
});
