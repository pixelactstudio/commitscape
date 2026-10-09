import { createFileRoute } from "@tanstack/react-router";
import { commitAskOf, reportCommitPage } from "#/server/commits";
import { answer } from "#/server/http";
import { deps, viewerOf } from "#/server/viewer";

export const Route = createFileRoute("/api/reports/$owner/$repo/commits")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const ask = commitAskOf(new URL(request.url).searchParams);
          const found = await reportCommitPage(deps(), viewerOf(request), params.owner, params.repo, ask, request.headers.get("if-none-match"));
          const headers = { etag: found.etag, "cache-control": found.cacheControl, vary: "cookie" };
          if (!found.page) return new Response(null, { status: 304, headers });
          return new Response(JSON.stringify(found.page), { headers: { ...headers, "content-type": "application/json" } });
        }),
    },
  },
});
