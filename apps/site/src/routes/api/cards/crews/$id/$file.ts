import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/crews/$id/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["season"], { crew: params.id }) } },
});
