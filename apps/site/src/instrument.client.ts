import * as Sentry from "@sentry/tanstackstart-react";
import { publicEnv } from "./lib/env";

if (publicEnv.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: publicEnv.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
