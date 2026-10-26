import "@tanstack/react-start/server-only";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    S3_ENDPOINT: z.url(),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_REGION: z.string().default("auto"),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    ENGINE_URL: z.url(),
    ENGINE_TOKEN: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GITHUB_API: z.url().default("https://api.github.com"),
    GITHUB_TOKEN: z.string().optional(),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_SLUG: z.string().optional(),
    GITHUB_APP_CLIENT_ID: z.string().optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_INSTALLATION_ID: z.coerce.number().int().positive().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    TOKEN_SECRET: z.string().min(32).optional(),
    CLIENT_IP_HEADER: z.string().default("x-forwarded-for"),
    MCP_TOKEN: z.string().min(32).optional(),
    PUBLIC_SENTRY_DSN: z.string().optional(),
    PUBLIC_POSTHOG_KEY: z.string().optional(),
    PUBLIC_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
    PUBLIC_LANDING_URL: z.url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
