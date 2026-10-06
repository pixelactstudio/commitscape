import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/vs/$a/$b/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["versus"], { login: params.a, versus: params.b }) } },
});
