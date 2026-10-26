import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { getViewer } from "./functions/account";
import { getSharedWork } from "./functions/work";
import { auth } from "./server/auth";
import { db, engine, reports, siteTokenOf } from "./server/context";
import { env } from "./server/env";
import { gate } from "./server/gate";
import { nameRequest } from "./server/telemetry";
import { warmSite } from "./server/warm";

const openFns = new Set([getViewer.url, getSharedWork.url]);
const fnBase = process.env.TSS_SERVER_FN_BASE ?? "/_serverFn/";

const signedIn = (request: Request) =>
  auth.api
    .getSession({ headers: request.headers })
    .then((s) => s !== null)
    .catch(() => false);

export default createServerEntry(
  wrapFetchWithSentry({
    async fetch(request: Request) {
      nameRequest(request, fnBase);
      await siteTokenOf().ready();
      warmSite(env.DATABASE_URL, () => ({ db: db(), storage: reports(), engine: engine() }));
      const stopped = await gate(request, { fnBase, openFns, landing: env.PUBLIC_LANDING_URL, signedIn: () => signedIn(request) });
      return stopped ?? handler.fetch(request);
    },
  }),
);
