import { createFileRoute } from "@tanstack/react-router";
import { answer } from "#/server/http";
import { reportCommits } from "#/server/repos";
import { deps, viewerOf } from "#/server/viewer";

export const Route = createFileRoute("/api/reports/$owner/$repo/commits")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const list = await reportCommits(deps(), viewerOf(request), params.owner, params.repo);
          return new Response(list.body as BodyInit, {
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "cache-control": list.private ? "private, no-store" : "public, max-age=300",
              vary: "cookie",
            },
          });
        }),
    },
  },
});
