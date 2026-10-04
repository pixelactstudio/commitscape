import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const positive = (fallback: number) => z.coerce.number().positive().default(fallback);

/** The Builder's settings, checked, from its environment. */
export function loadEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    server: {
      DATABASE_URL: z.url(),
      S3_ENDPOINT: z.url(),
      S3_BUCKET: z.string().min(1),
      S3_ACCESS_KEY_ID: z.string().min(1),
      S3_SECRET_ACCESS_KEY: z.string().min(1),
      S3_REGION: z.string().default("auto"),
      S3_FORCE_PATH_STYLE: z.stringbool().default(false),
      MIGRATIONS_DIR: z.string().default("drizzle"),
      COMMITSCAPE_BIN: z.string().default("commitscape"),
      WORK_DIR: z.string().default(`${runtimeEnv.HOME ?? "."}/builder-work`),
      CONCURRENCY: positive(1),
      MAX_REPOSITORY_MB: z.coerce.number().positive().optional(),
      TIME_LIMIT_SECONDS: positive(900),
      DISK_BUDGET_GB: positive(20),
      SURVIVING_BUDGET_SECONDS: positive(60),
      PULLS_TIME_LIMIT_SECONDS: positive(1800),
      GIT_BASE: z.string().optional(),
      GITHUB_API: z.url().default("https://api.github.com"),
      GITHUB_TOKEN: z.string().optional(),
      GITHUB_APP_ID: z.string().optional(),
      GITHUB_APP_PRIVATE_KEY: z.string().optional(),
      SEED_LANGUAGES: z.string().default("JavaScript,TypeScript,Python,Go,Rust,Java,C,C++,Ruby"),
      SEED_PER_LANGUAGE: positive(10),
      SEED_BUDGET: positive(50),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type Env = ReturnType<typeof loadEnv>;

export type Config = {
  bin: string;
  work: string;
  concurrency: number;
  maxMb: number | undefined;
  timeLimit: number;
  diskGb: number;
  gitBase: string | undefined;
};

export function configOf(env: Env): Config {
  return {
    bin: env.COMMITSCAPE_BIN,
    work: env.WORK_DIR,
    concurrency: env.CONCURRENCY,
    maxMb: env.MAX_REPOSITORY_MB,
    timeLimit: env.TIME_LIMIT_SECONDS,
    diskGb: env.DISK_BUDGET_GB,
    gitBase: env.GIT_BASE,
  };
}
