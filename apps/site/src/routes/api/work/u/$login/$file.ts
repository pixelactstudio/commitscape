import { createFileRoute } from "@tanstack/react-router";
import { answer } from "#/server/http";
import { serveWork } from "#/server/serve-work";
import { profileDeps, profileViewer } from "#/server/viewer";
import { workOf } from "#/server/work";

export const Route = createFileRoute("/api/work/u/$login/$file")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        answer(async () => {
          const q = new URL(request.url).searchParams;
          const work = await workOf(profileDeps(), profileViewer(request), params.login, { from: q.get("from") ?? "", to: q.get("to") ?? "", filter: q.get("filter") });
          return serveWork(work, params.file);
        }),
    },
  },
});
