import { createFileRoute } from "@tanstack/react-router";
import { db, reports, siteAnalytics } from "#/server/context";
import { answer, json, says } from "#/server/http";
import { deleteShare, getShare, SHARE_MAX, uploadShare } from "#/server/shares";

const ID = /^[A-Za-z0-9_-]{16,64}$/;

export const Route = createFileRoute("/api/shares/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          if (!ID.test(params.id)) return says(404, "There is no Shared Report here.");
          const share = await getShare(db(), reports(), params.id);
          siteAnalytics().capture("share opened", { userId: null, headers: request.headers }, { bytes: share.body.byteLength, hours_left: Math.max(0, Math.round((share.expiresAt - Date.now() / 1000) / 360) / 10) });
          return new Response(share.body as BodyInit, {
            headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store", "x-expires-at": String(share.expiresAt) },
          });
        }),
      PUT: ({ request, params }) =>
        answer(async () => {
          if (!ID.test(params.id)) return says(404, "There is no Shared Report here.");
          const length = Number(request.headers.get("content-length") ?? "-1");
          if (!Number.isSafeInteger(length) || length <= 0) return says(411, "Say how long it is.");
          if (length > SHARE_MAX) return says(413, "A Shared Report is at most 25 MB.");
          const body = new Uint8Array(await request.arrayBuffer());
          return json(await uploadShare(db(), reports(), params.id, request.headers.get("x-upload-token") ?? "", body));
        }),
      DELETE: ({ request, params }) =>
        answer(async () => {
          if (!ID.test(params.id)) return says(404, "There is no Shared Report here.");
          const deleted = await deleteShare(db(), reports(), params.id, request.headers.get("x-delete-token") ?? "");
          siteAnalytics().capture("share deleted", { userId: null, headers: request.headers });
          return json(deleted);
        }),
    },
  },
});
