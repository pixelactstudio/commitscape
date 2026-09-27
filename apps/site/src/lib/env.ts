import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const PUBLIC_GLOBAL = "__COMMITSCAPE_PUBLIC__";

declare global {
  interface Window {
    [PUBLIC_GLOBAL]?: Record<string, string | undefined>;
  }
}

/** The browser's settings, read at run time from what the server wrote into the page. */
export const publicEnv = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_SENTRY_DSN: z.string().optional(),
    PUBLIC_POSTHOG_KEY: z.string().optional(),
    PUBLIC_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  },
  runtimeEnv: typeof window === "undefined" ? {} : (window[PUBLIC_GLOBAL] ?? {}),
  isServer: false,
  emptyStringAsUndefined: true,
});
