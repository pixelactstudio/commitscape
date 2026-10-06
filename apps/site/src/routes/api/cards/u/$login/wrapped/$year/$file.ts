import { createFileRoute } from "@tanstack/react-router";
import { serveCard } from "#/server/serve-card";

export const Route = createFileRoute("/api/cards/u/$login/wrapped/$year/$file")({
  server: { handlers: { GET: ({ request, params }) => serveCard(request, params.file, ["wrapped", "wrapped-calendar"], { login: params.login, year: Number(params.year) }) } },
});
