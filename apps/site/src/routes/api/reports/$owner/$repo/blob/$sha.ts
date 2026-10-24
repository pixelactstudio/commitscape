import { createFileRoute } from "@tanstack/react-router";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { readThroughBlob } from "#/server/blobs";
import { answer } from "#/server/http";
import { deps, viewerOf } from "#/server/viewer";

const gunzipAsync = promisify(gunzip);

export const Route = createFileRoute("/api/reports/$owner/$repo/blob/$sha")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const found = await readThroughBlob(deps(), viewerOf(request), params.owner, params.repo, params.sha, request.headers.get("if-none-match"));
          const headers = { etag: found.etag, "cache-control": found.cacheControl, vary: "cookie, accept-encoding", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
          if (!found.object) return new Response(null, { status: 304, headers });
          const gzip = found.object.encoding === "gzip";
          const accepts = (request.headers.get("accept-encoding") ?? "").includes("gzip");
          const body = gzip && !accepts ? await gunzipAsync(found.object.body) : found.object.body;
          return new Response(body as BodyInit, { headers: { ...headers, "content-type": "text/plain; charset=utf-8", ...(gzip && accepts ? { "content-encoding": "gzip" } : {}) } });
        }),
    },
  },
});
