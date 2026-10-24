import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { db, reports, siteTokenOf } from "./server/context";
import { env } from "./server/env";
import { warmSite } from "./server/warm";

export default createServerEntry(
  wrapFetchWithSentry({
    async fetch(request: Request) {
      await siteTokenOf().ready();
      warmSite(env.DATABASE_URL, db, reports);
      return handler.fetch(request);
    },
  }),
);
