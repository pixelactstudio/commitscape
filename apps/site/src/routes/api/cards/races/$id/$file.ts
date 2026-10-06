import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/races/$id/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["race"], { race: params.id }) } },
});
