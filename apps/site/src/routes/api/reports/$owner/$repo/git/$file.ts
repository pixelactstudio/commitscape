import { createFileRoute } from "@tanstack/react-router";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { gitFile } from "#/server/git";
import { answer, SiteError } from "#/server/http";
import { sendPacked } from "#/server/packed";
import { deps, viewerOf } from "#/server/viewer";

const gunzipAsync = promisify(gunzip);

export const Route = createFileRoute("/api/reports/$owner/$repo/git/$file")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const url = new URL(request.url);
          const v = url.searchParams.get("v");
          if (v !== null && !/^\d{1,15}$/.test(v)) throw new SiteError(400, "v must be a whole number.");
          const found = await gitFile(deps(), viewerOf(request), params.owner, params.repo, params.file, v === null ? null : Number(v), request.headers.get("if-none-match"));
          const headers = { etag: found.etag, "cache-control": found.cacheControl, vary: "cookie, accept-encoding" };
          if (found.packed) return sendPacked(request, found.packed, headers);
          if (!found.object) return new Response(null, { status: 304, headers });
          const gzip = found.object.encoding === "gzip";
          const accepts = (request.headers.get("accept-encoding") ?? "").includes("gzip");
          const body = gzip && !accepts ? await gunzipAsync(found.object.body) : found.object.body;
          return new Response(body as BodyInit, { headers: { ...headers, "content-type": "application/json", ...(gzip && accepts ? { "content-encoding": "gzip" } : {}) } });
        }),
    },
  },
});
