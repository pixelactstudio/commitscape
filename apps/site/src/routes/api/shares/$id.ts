import { createFileRoute } from "@tanstack/react-router";
import { db, reports } from "#/server/context";
import { answer, json, says } from "#/server/http";
import { deleteShare, getShare, SHARE_MAX, uploadShare } from "#/server/shares";

const ID = /^[A-Za-z0-9_-]{16,64}$/;

export const Route = createFileRoute("/api/shares/$id")({
  server: {
    handlers: {
      GET: ({ params }) =>
        answer(async () => {
          if (!ID.test(params.id)) return says(404, "There is no Shared Report here.");
          const share = await getShare(db(), reports(), params.id);
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
          return json(await deleteShare(db(), reports(), params.id, request.headers.get("x-delete-token") ?? ""));
        }),
    },
  },
});
