import * as Sentry from "@sentry/tanstackstart-react";

const dsn = process.env.SENTRY_DSN;

function expected(error) {
  if (!error || typeof error !== "object") return false;
  if (error.name === "SiteError" && typeof error.status === "number" && error.status < 500) return true;
  return error.message === "aborted" && error.code === "ECONNRESET";
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (event, hint) => (expected(hint.originalException) ? null : event),
  });
}
