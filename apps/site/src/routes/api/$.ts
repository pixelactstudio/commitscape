import { createFileRoute } from "@tanstack/react-router";
import { says } from "#/server/http";

const missing = () => says(404, "No such API.");

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: missing, POST: missing, PUT: missing, DELETE: missing, PATCH: missing } },
});
