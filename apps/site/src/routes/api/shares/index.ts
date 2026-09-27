import { createFileRoute } from "@tanstack/react-router";
import { db } from "#/server/context";
import { env } from "#/server/env";
import { answer, clientAddress, json } from "#/server/http";
import { createShare, type ShareAsk } from "#/server/shares";

export const Route = createFileRoute("/api/shares/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        answer(async () => {
          const asked = (await request.json().catch(() => null)) as ShareAsk | null;
          return json(await createShare(db(), clientAddress(request, env.CLIENT_IP_HEADER), asked), 201);
        }),
    },
  },
});
