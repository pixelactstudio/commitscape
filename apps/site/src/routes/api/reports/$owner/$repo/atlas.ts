import { createFileRoute } from "@tanstack/react-router";
import { answer, SiteError } from "#/server/http";
import { atlasBody, atlasFile } from "#/server/universe";
import { deps, viewerOf } from "#/server/viewer";

export const Route = createFileRoute("/api/reports/$owner/$repo/atlas")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const url = new URL(request.url);
          const part = url.searchParams.get("part") ?? "map";
          const v = url.searchParams.get("v");
          if (part !== "map" && part !== "names") throw new SiteError(400, "part must be map or names.");
          if (v !== null && !/^\d{1,15}$/.test(v)) throw new SiteError(400, "v must be a whole number.");
          const found = await atlasFile(deps(), viewerOf(request), params.owner, params.repo, part, v === null ? null : Number(v), request.headers.get("if-none-match"));
          const headers = { etag: found.etag, "cache-control": found.cacheControl, vary: "cookie, accept-encoding" };
          if (!found.body) return new Response(null, { status: 304, headers });
          const { body, encoding } = await atlasBody(found.body, request.headers.get("accept-encoding"));
          return new Response(body as BodyInit, { headers: { ...headers, "content-type": "application/octet-stream", ...(encoding ? { "content-encoding": encoding } : {}) } });
        }),
    },
  },
});
