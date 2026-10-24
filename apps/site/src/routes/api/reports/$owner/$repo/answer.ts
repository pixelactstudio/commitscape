import { createFileRoute } from "@tanstack/react-router";
import { answer, SiteError } from "#/server/http";
import { sendPacked } from "#/server/packed";
import { reportAnswer } from "#/server/repos";
import { deps, viewerOf } from "#/server/viewer";

export const Route = createFileRoute("/api/reports/$owner/$repo/answer")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const url = new URL(request.url);
          const key = url.searchParams.get("key") ?? "";
          const at = url.searchParams.get("at");
          if (key.length === 0 || key.length > 2000) throw new SiteError(400, "key must be a question to the Report.");
          if (at !== null && !/^\d{1,15}$/.test(at)) throw new SiteError(400, "at must be a whole number.");
          const found = await reportAnswer(deps(), viewerOf(request), params.owner, params.repo, key, at === null ? null : Number(at), request.headers.get("if-none-match"));
          const headers = { etag: found.etag, "cache-control": found.cacheControl, vary: "cookie, accept-encoding" };
          if (!found.packed) return new Response(null, { status: 304, headers });
          return sendPacked(request, found.packed, headers);
        }),
    },
  },
});
