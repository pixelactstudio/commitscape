import { createFileRoute } from "@tanstack/react-router";
import { db, siteAnalytics } from "#/server/context";
import { env } from "#/server/env";
import { answer, clientAddress, json } from "#/server/http";
import { createShare, type ShareAsk } from "#/server/shares";

export const Route = createFileRoute("/api/shares/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        answer(async () => {
          const asked = (await request.json().catch(() => null)) as ShareAsk | null;
          const made = await createShare(db(), clientAddress(request, env.CLIENT_IP_HEADER), asked);
          siteAnalytics().capture("share created", { userId: null, headers: request.headers }, { bytes: Number(asked?.bytes), hours: Number(asked?.hours) });
          return json(made, 201);
        }),
    },
  },
});
