import { createFileRoute } from "@tanstack/react-router";
import { Resvg } from "@resvg/resvg-js";
import { renderSite } from "@commitscape/ui/cards/render";
import { env } from "#/server/env";
import { says } from "#/server/http";

let kept: Uint8Array | null = null;

export const Route = createFileRoute("/api/cards/site/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (params.file !== "preview.png") return says(404, "No such Card.");
        kept ??= new Resvg(await renderSite("light", new URL(env.BETTER_AUTH_URL).host)).render().asPng();
        return new Response(kept as BodyInit, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
      },
    },
  },
});
