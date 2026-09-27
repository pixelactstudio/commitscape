import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const clientEnv = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SENTRY_DSN: z.string().optional(),
    VITE_POSTHOG_KEY: z.string().optional(),
    VITE_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
