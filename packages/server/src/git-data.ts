import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { inArray } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import type { Db } from "./db/client";
import { repoBlobs, repoBranchDetails, repoBranches, repoGit, repoTags } from "./db/schema";
import type { Storage, StoredObject } from "./storage";

export const gitPrefix = (repoId: string) => `git/gh/${repoId}`;

export const GIT_FILES = ["tree", "coupling", "history", "branches", "pulls"] as const;
export type GitFile = (typeof GIT_FILES)[number];

export const gitFileKey = (prefix: string, file: GitFile) => `${prefix}/${file}.json`;
export const gitPullKey = (prefix: string, number: number) => `${prefix}/pulls/${number}.json`;
export const gitBlobKey = (prefix: string, sha: string) => `${prefix}/blobs/${sha}`;

const cache = new LRUCache<string, { value: unknown }>({ maxSize: 128 * 1024 * 1024 });

/** Stores a value as gzipped JSON and returns the bytes written. */
export async function putGitJson(storage: Storage, key: string, value: unknown): Promise<number> {
  const body = gzipSync(JSON.stringify(value));
  await storage.put(key, body, { type: "application/json", encoding: "gzip" });
  cache.delete(key);
  return body.length;
}

/** Stores a file's text, gzipped, under its blob's id. */
export async function putGitBlob(storage: Storage, key: string, text: Uint8Array): Promise<number> {
  const body = gzipSync(text);
  await storage.put(key, body, { type: "text/plain; charset=utf-8", encoding: "gzip" });
  return body.length;
}

/** A blob's id as git names it: the SHA-1 (or, in a SHA-256 repository, SHA-256) of its header and content. */
export function gitBlobId(content: Uint8Array, hash: "sha1" | "sha256" = "sha1"): string {
  return createHash(hash).update(`blob ${content.length}\0`).update(content).digest("hex");
}

/** A stored object as it was written, gzipped, for serving as it is. */
export function readGitObject(storage: Storage, key: string): Promise<StoredObject | null> {
  return storage.get(key);
}

/** One stored JSON value, or null when there is none. */
export async function readGitJson<T>(storage: Storage, key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit) return hit.value as T;
  const object = await storage.get(key);
  if (!object) return null;
  const text = (object.encoding === "gzip" ? gunzipSync(object.body) : Buffer.from(object.body)).toString("utf8");
  const value = JSON.parse(text) as T;
  cache.set(key, { value }, { size: Math.max(1, text.length) });
  return value;
}

/** Deletes the git data of repositories, wherever their rows say it is kept. */
export async function removeGit(db: Db, storage: Storage, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.select({ prefix: repoGit.prefix }).from(repoGit).where(inArray(repoGit.repoId, ids));
  for (const prefix of new Set([...rows.map((r) => r.prefix), ...ids.map(gitPrefix)])) await storage.deletePrefix(`${prefix}/`);
  await db.delete(repoBlobs).where(inArray(repoBlobs.repoId, ids));
  await db.delete(repoBranchDetails).where(inArray(repoBranchDetails.repoId, ids));
  await db.delete(repoBranches).where(inArray(repoBranches.repoId, ids));
  await db.delete(repoTags).where(inArray(repoTags.repoId, ids));
}
