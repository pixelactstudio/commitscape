import * as Sentry from "@sentry/tanstackstart-react";
import { clientEnv } from "./lib/env";

if (clientEnv.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: clientEnv.VITE_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
