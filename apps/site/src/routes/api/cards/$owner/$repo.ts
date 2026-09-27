import { createFileRoute } from "@tanstack/react-router";
import { answer, says } from "#/server/http";
import { publicCard } from "#/server/repos";
import { deps } from "#/server/viewer";

export const Route = createFileRoute("/api/cards/$owner/$repo")({
  server: {
    handlers: {
      GET: ({ params }) =>
        answer(async () => {
          const card = await publicCard(deps(), params.owner, params.repo);
          if (!card) return says(404, "No card of this repository yet.");
          return new Response(card.body as BodyInit, { headers: { "content-type": card.type, "cache-control": "public, max-age=3600" } });
        }),
    },
  },
});
