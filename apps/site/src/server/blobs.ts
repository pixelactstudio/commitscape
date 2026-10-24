import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { FILE_BYTES_MAX, rawBase, rawPath } from "@commitscape/data";
import { gitBlobId, gitBlobKey, lentToken, readGitObject, repoToken, schema, type StoredObject } from "@commitscape/server";
import { gitOf, type GitRepo, type Served } from "./git";
import { apiOf } from "./github";
import { SiteError } from "./http";
import type { Deps, Viewer } from "./repos";

const { indexFiles, indexHeadFiles, storedIndexes } = schema;

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const YEAR = 31_536_000;
const FETCH_MS = 15_000;
const AT_ONCE = 8;
const TEXT = "text/plain; charset=utf-8";

const gzipAsync = promisify(gzip);

export type HeadBlob = { path: string; bytes: number; binary: boolean; head: string };

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await run();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const reading = new Map<string, Promise<StoredObject>>();

/** Where a blob is among the files at the HEAD of a Stored Index: its path, size and whether it is binary, and that HEAD's commit; null when no file there has it. */
export async function headBlob(deps: Pick<Deps, "db">, si: number, sha: string): Promise<HeadBlob | null> {
  const [found] = await deps.db
    .select({ path: indexFiles.path, bytes: indexHeadFiles.bytes, kind: indexHeadFiles.class, head: storedIndexes.head })
    .from(indexHeadFiles)
    .innerJoin(indexFiles, and(eq(indexFiles.si, indexHeadFiles.si), eq(indexFiles.file, indexHeadFiles.file)))
    .innerJoin(storedIndexes, eq(storedIndexes.id, indexHeadFiles.si))
    .where(and(eq(indexHeadFiles.si, si), eq(indexHeadFiles.blob, Buffer.from(sha, "hex"))))
    .limit(1);
  if (!found?.head) return null;
  return { path: found.path, bytes: found.bytes, binary: found.kind === "binary", head: found.head };
}

async function tokensFor(deps: Deps, viewer: Viewer, row: GitRepo["row"]): Promise<string[]> {
  const installed = deps.app && row.installationId ? await repoToken(deps.app, row.installationId, row.name).catch(() => null) : null;
  const own = await viewer.token().catch(() => null);
  const lent = await lentToken(deps.db, deps.tokenSecret, row.id).catch(() => null);
  return [...new Set([installed, own, lent].filter((t): t is string => !!t))];
}

async function fromGitHub(deps: Deps, viewer: Viewer, row: GitRepo["row"], found: HeadBlob, sha: string): Promise<Uint8Array> {
  const get = deps.github.fetcher ?? fetch;
  const read = async (url: string, headers: Record<string, string>) => {
    const answer = await get(url, { headers: { "user-agent": "commitscape", ...headers }, signal: AbortSignal.timeout(FETCH_MS) });
    return answer.ok ? new Uint8Array(await answer.arrayBuffer()) : answer.status;
  };
  const tried: (Uint8Array | number)[] = [];
  if (!row.isPrivate) tried.push(await read(`${rawBase(row.owner, row.name, found.head)}${rawPath(found.path)}`, {}));
  else {
    for (const token of await tokensFor(deps, viewer, row)) {
      const got = await read(`${apiOf(deps.github)}/repos/${row.owner}/${row.name}/git/blobs/${sha}`, { authorization: `Bearer ${token}`, accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28" });
      tried.push(got);
      if (typeof got !== "number") break;
    }
    if (tried.length === 0) throw new SiteError(404, "This file's text was not kept, and there is no token to read it from GitHub with.");
  }
  const body = tried.find((t): t is Uint8Array => typeof t !== "number");
  if (!body) {
    const status = tried.at(-1) as number;
    if (status === 429 || status === 403) throw new SiteError(503, "GitHub is not sending files just now. Try again in a minute.");
    throw new SiteError(404, "GitHub did not send this file's text.");
  }
  if (gitBlobId(body, sha.length === 64 ? "sha256" : "sha1") !== sha) throw new SiteError(502, "GitHub sent text that is not this file's.");
  return body;
}

/** Serves a file's text by blob id from storage, else reads it from GitHub on the server, checks it against the id and stores it. */
export async function readThroughBlob(deps: Deps, viewer: Viewer, owner: string, name: string, sha: string, seen?: string | null): Promise<Served> {
  if (!SHA.test(sha)) throw new SiteError(404, "No such file.");
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const etag = `"${sha}"`;
  const cacheControl = `${row.isPrivate ? "private" : "public"}, max-age=${YEAR}, immutable`;
  if (matches(seen, etag)) return { packed: null, object: null, etag, cacheControl };
  const key = gitBlobKey(git.prefix, sha);
  const kept = await readGitObject(deps.storage, key);
  if (kept) return { packed: null, object: kept, etag, cacheControl };
  if (row.indexId === null) throw new SiteError(404, "This file's text was not kept.");
  const found = await headBlob(deps, row.indexId, sha);
  if (!found) throw new SiteError(404, "No file at this repository's HEAD has this text.");
  if (found.binary) throw new SiteError(415, "This file is not text.");
  if (found.bytes > FILE_BYTES_MAX) throw new SiteError(413, "This file is too big to show.");
  let pending = reading.get(key);
  if (!pending) {
    const read = slot(async (): Promise<StoredObject> => ({ body: new Uint8Array(await gzipAsync(await fromGitHub(deps, viewer, row, found, sha))), type: TEXT, encoding: "gzip" }));
    pending = read;
    reading.set(key, read);
    void read
      .then((object) => deps.storage.put(key, object.body, { type: TEXT, encoding: "gzip" }))
      .catch(() => undefined)
      .finally(() => reading.delete(key));
  }
  return { packed: null, object: await pending, etag, cacheControl };
}
