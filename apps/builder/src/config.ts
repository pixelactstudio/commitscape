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
      COMMITSCAPE_THREADS: z.coerce.number().int().positive().optional(),
      LINES_BUDGET_SECONDS: positive(120),
      MORE_LINES_BUDGET_SECONDS: positive(600),
      ENGINE_NICE: z.coerce.number().int().min(0).max(19).default(10),
      WORK_DIR: z.string().default(`${runtimeEnv.HOME ?? "."}/builder-work`),
      CONCURRENCY: positive(1),
      MAX_REPOSITORY_MB: z.coerce.number().positive().optional(),
      TIME_LIMIT_SECONDS: positive(900),
      CLONE_TIME_LIMIT_SECONDS: positive(1800),
      LARGE_REPOSITORY_MB: positive(1500),
      LARGE_CONCURRENCY: positive(1),
      LOGINS_ASKED: positive(300),
      DISK_BUDGET_GB: positive(20),
      CACHE_BUDGET_GB: positive(5),
      ENGINE_MEMORY_MB: positive(1200),
      BULK_COMMIT_FILES: positive(50),
      ATLAS_QUALITY: z.coerce.number().int().min(1).max(11).default(5),
      ENGINE_URL: z.url().optional(),
      PACK_FORMAT: z.enum(["2", "3"]).optional(),
      STATE_KEY: z.string().min(32).optional(),
      STATE_DISK_DAYS: positive(7),
      STATE_KEEP_DAYS: positive(180),
      SURVIVING_BUDGET_SECONDS: positive(60),
      PULLS_TIME_LIMIT_SECONDS: positive(1800),
      GIT_DATA: z.stringbool().default(true),
      GIT_TIME_LIMIT_SECONDS: positive(300),
      GIT_BRANCHES_MAX: positive(300),
      GIT_TAGS_MAX: positive(200),
      GIT_BRANCH_DETAILS: positive(120),
      GIT_FILE_MAX_KB: positive(256),
      GIT_REPO_MAX_MB: positive(48),
      GIT_WARM_FILES: positive(500),
      GIT_PULLS_OPEN_MAX: positive(150),
      GIT_PULLS_OTHER_MAX: positive(100),
      GIT_PULL_DIFF_KB: positive(200),
      GIT_PULLS_MAX_MB: positive(40),
      GIT_BASE: z.string().optional(),
      GITHUB_API: z.url().default("https://api.github.com"),
      GITHUB_TOKEN: z.string().optional(),
      GITHUB_APP_ID: z.string().optional(),
      GITHUB_APP_PRIVATE_KEY: z.string().optional(),
      TOKEN_SECRET: z.string().min(32).optional(),
      GITHUB_APP_INSTALLATION_ID: z.coerce.number().int().positive().optional(),
      SEED_LANGUAGES: z.string().default("JavaScript,TypeScript,Python,Go,Rust,Java,C,C++,Ruby"),
      SEED_PER_LANGUAGE: positive(10),
      SEED_BUDGET: positive(50),
      SENTRY_DSN: z.string().optional(),
      SENTRY_ENVIRONMENT: z.string().default("production"),
      SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
      POSTHOG_KEY: z.string().optional(),
      POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type Env = ReturnType<typeof loadEnv>;

export type GitSettings = {
  seconds: number;
  branches: number;
  tags: number;
  branchDetails: number;
  fileBytes: number;
  repoBytes: number;
  warmFiles: number;
  branchCommits: number;
  pullsOpen: number;
  pullsOthers: number;
  patchBytes: number;
  pullFileBytes: number;
  pullCommits: number;
  pullFiles: number;
  pullsBytes: number;
};

export type Config = {
  bin: string;
  engineUrl?: string | undefined;
  packFormat?: 2 | 3 | undefined;
  threads: number | undefined;
  linesBudget: number;
  nice: number;
  work: string;
  concurrency: number;
  maxMb: number | undefined;
  timeLimit: number;
  cloneLimit: number;
  largeMb: number;
  largeConcurrency: number;
  logins: number;
  diskGb: number;
  cacheGb: number;
  engineMemoryMb: number;
  bulkFiles: number;
  moreLinesBudget: number;
  gitBase: string | undefined;
  git?: GitSettings | undefined;
  atlas?: AtlasSettings | undefined;
  state?: StateSettings | undefined;
};

export type StateSettings = { secret: string; diskDays: number; keepDays: number };

export type AtlasSettings = { quality: number };

export function configOf(env: Env): Config {
  return {
    bin: env.COMMITSCAPE_BIN,
    threads: env.COMMITSCAPE_THREADS,
    linesBudget: env.LINES_BUDGET_SECONDS,
    nice: env.ENGINE_NICE,
    work: env.WORK_DIR,
    concurrency: env.CONCURRENCY,
    maxMb: env.MAX_REPOSITORY_MB,
    timeLimit: env.TIME_LIMIT_SECONDS,
    cloneLimit: env.CLONE_TIME_LIMIT_SECONDS,
    largeMb: env.LARGE_REPOSITORY_MB,
    largeConcurrency: env.LARGE_CONCURRENCY,
    logins: env.LOGINS_ASKED,
    diskGb: env.DISK_BUDGET_GB,
    cacheGb: env.CACHE_BUDGET_GB,
    engineMemoryMb: env.ENGINE_MEMORY_MB,
    bulkFiles: env.BULK_COMMIT_FILES,
    moreLinesBudget: env.MORE_LINES_BUDGET_SECONDS,
    gitBase: env.GIT_BASE,
    engineUrl: env.ENGINE_URL,
    packFormat: env.PACK_FORMAT === undefined ? undefined : env.PACK_FORMAT === "2" ? 2 : 3,
    state: env.STATE_KEY ? { secret: env.STATE_KEY, diskDays: env.STATE_DISK_DAYS, keepDays: env.STATE_KEEP_DAYS } : undefined,
    git: env.GIT_DATA
      ? {
          seconds: env.GIT_TIME_LIMIT_SECONDS,
          branches: env.GIT_BRANCHES_MAX,
          tags: env.GIT_TAGS_MAX,
          branchDetails: env.GIT_BRANCH_DETAILS,
          fileBytes: env.GIT_FILE_MAX_KB * 1024,
          repoBytes: env.GIT_REPO_MAX_MB * 1024 * 1024,
          warmFiles: env.GIT_WARM_FILES,
          branchCommits: 250_000,
          pullsOpen: env.GIT_PULLS_OPEN_MAX,
          pullsOthers: env.GIT_PULLS_OTHER_MAX,
          patchBytes: env.GIT_PULL_DIFF_KB * 1024,
          pullFileBytes: 60 * 1024,
          pullCommits: 250,
          pullFiles: 300,
          pullsBytes: env.GIT_PULLS_MAX_MB * 1024 * 1024,
        }
      : undefined,
  };
}
