import { createFileRoute } from "@tanstack/react-router";
import { db } from "#/server/context";
import { answer } from "#/server/http";
import { serveWork } from "#/server/serve-work";
import { sharedWork } from "#/server/work";

export const Route = createFileRoute("/api/work/s/$id/$file")({
  server: { handlers: { GET: ({ params }) => answer(async () => serveWork(await sharedWork(db(), params.id), params.file)) } },
});
