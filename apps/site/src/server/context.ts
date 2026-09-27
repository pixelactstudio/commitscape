import "@tanstack/react-start/server-only";
import { bossQueue, createDb, s3Storage, startQueue, type Db, type GitHubApp, type Queue, type Storage } from "@commitscape/server";
import { env } from "./env";

let database: Db | undefined;
let storage: Storage | undefined;
let queue: Promise<Queue> | undefined;

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

export function builds(): Promise<Queue> {
  queue ??= startQueue(env.DATABASE_URL, { worker: false }).then(bossQueue);
  queue.catch(() => {
    queue = undefined;
  });
  return queue;
}

export function githubApp(): GitHubApp | null {
  return env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY ? { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, api: env.GITHUB_API } : null;
}
