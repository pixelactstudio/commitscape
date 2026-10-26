import "@tanstack/react-start/server-only";
import { bossQueue, createDb, s3Storage, siteToken, startQueue, type Db, type GitHubApp, type Queue, type SiteToken, type Storage } from "@commitscape/server";
import { PostHog } from "posthog-node";
import { analytics, stopOnExit, type Analytics } from "./analytics";
import { engineService, type EngineService } from "./engine-service";
import { env } from "./env";
import { traced } from "./queue";

let database: Db | undefined;
let storage: Storage | undefined;
let queue: Promise<Queue> | undefined;
let token: SiteToken | undefined;
let answering: EngineService | undefined;
let counting: Analytics | undefined;

export function db(): Db {
  database ??= createDb(env.DATABASE_URL).db;
  return database;
}

export function reports(): Storage {
  storage ??= s3Storage({
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return storage;
}

/** The engine service, which answers every question about a repository from its pack. */
export function engine(): EngineService {
  answering ??= engineService(env.ENGINE_URL, env.ENGINE_TOKEN);
  return answering;
}

export function builds(): Promise<Queue> {
  queue ??= startQueue(env.DATABASE_URL, { worker: false }).then((boss) => traced(bossQueue(boss)));
  queue.catch(() => {
    queue = undefined;
  });
  return queue;
}

export function githubApp(): GitHubApp | null {
  return env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY ? { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, api: env.GITHUB_API } : null;
}

export function siteTokenOf(): SiteToken {
  token ??= siteToken(githubApp(), env.GITHUB_APP_INSTALLATION_ID ?? null, env.GITHUB_TOKEN);
  return token;
}

/** GitHub as the Site itself reads it: public data under the Site's own token. */
export function siteGitHub(): { api: string; token?: string } {
  return { api: env.GITHUB_API, token: siteTokenOf().current() };
}

/** The Site's one PostHog client, made on first use when a key is set and shut down when the process stops. */
export function siteAnalytics(): Analytics {
  if (!counting) {
    const counter = env.PUBLIC_POSTHOG_KEY ? new PostHog(env.PUBLIC_POSTHOG_KEY, { host: env.PUBLIC_POSTHOG_HOST, flushAt: 20, flushInterval: 10_000 }) : null;
    counting = analytics({ counter, secret: env.TOKEN_SECRET, countryHeader: env.COUNTRY_HEADER, addressHeader: env.CLIENT_IP_HEADER });
    if (counter) stopOnExit(counting);
  }
  return counting;
}
