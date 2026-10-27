import "@tanstack/react-start/server-only";
import * as Sentry from "@sentry/tanstackstart-react";
import type { CodeLog, CodeStory, CommitQuery, FolderLast, Params, PathHistory, PullInsight } from "@commitscape/data";
import type { AtlasRows } from "@commitscape/data/universe";
import { SiteError } from "./http";
import { EngineError, engineFailed, engineTimed, type EngineOutcome } from "./telemetry";

export const ENGINE_TIMEOUT = 10_000;

export const ENGINE_DOWN = "The Site could not work this out just now. Try again in a moment.";

export type Blob = { lines: number; binary: boolean };

export type TreeOf = { builtAt: number; head: string; branch: string; raw?: string | null; fileBytes?: number };

export type Named = { sha: string; at: number; subject: string };

export type UnderPage = { shas: string[]; total: number; next: string | null };

export type Story = Omit<CodeStory, "head" | "raw">;

/** The engine service has no pack under the key asked: its Build has not published one, or a newer publish deleted it. */
export class NoPack extends Error {
  constructor(pack: string) {
    super(`no such pack: ${pack}`);
    this.name = "NoPack";
  }
}

/** Sends one request to the engine service and gives its JSON text back, or null when it has no answer to that question. */
export type Post = (endpoint: string, body: Record<string, unknown>) => Promise<string | null>;

/** The engine service's answers from a pack, each exactly as the Site worked it out before (contracts §5); the large files as JSON text, to pack without parsing. */
export type EngineService = {
  answerText(pack: string, path: string, params: Params): Promise<string | null>;
  answer<T>(pack: string, path: string, params: Params): Promise<T | null>;
  treeText(pack: string, blobs: Record<string, Blob>, of: TreeOf): Promise<string>;
  couplingText(pack: string): Promise<string>;
  pathHistory(pack: string, path: string): Promise<PathHistory>;
  folderLast(pack: string, path: string): Promise<FolderLast>;
  story(pack: string, path: string): Promise<Story>;
  codeLog(pack: string, path: string, page: number): Promise<CodeLog>;
  under(pack: string, path: string, query: CommitQuery, cursor: string | undefined, said: string[] | null): Promise<UnderPage>;
  search(pack: string, query: CommitQuery, cursor: string | undefined): Promise<UnderPage>;
  insight(pack: string, number: number, paths: string[], author: string | null, named: Named[]): Promise<PullInsight>;
  universeRows(pack: string): Promise<AtlasRows>;
  warm(pack: string, keys: string[]): Promise<number>;
};

const parsed = <T>(text: string | null): T => {
  if (text === null) throw new SiteError(404, "No such answer.");
  return JSON.parse(text) as T;
};

/** The engine service's typed calls over one way of sending a request. */
export function engineOver(post: Post): EngineService {
  const json = async <T>(endpoint: string, body: Record<string, unknown>) => parsed<T>(await post(endpoint, body));
  const text = async (endpoint: string, body: Record<string, unknown>) => {
    const found = await post(endpoint, body);
    if (found === null) throw new SiteError(404, "No such answer.");
    return found;
  };
  return {
    answerText: (pack, path, params) => post("/v1/answer", { pack, path, params }),
    answer: async <T>(pack: string, path: string, params: Params) => {
      const found = await post("/v1/answer", { pack, path, params });
      return found === null ? null : (JSON.parse(found) as T);
    },
    treeText: (pack, blobs, of) => text("/v1/git/tree", { pack, blobs, of }),
    couplingText: (pack) => text("/v1/git/coupling", { pack }),
    pathHistory: (pack, path) => json("/v1/git/path-history", { pack, path }),
    folderLast: (pack, path) => json("/v1/git/folder-last", { pack, path }),
    story: (pack, path) => json("/v1/code/story", { pack, path }),
    codeLog: (pack, path, page) => json("/v1/code/log", { pack, path, page }),
    under: (pack, path, query, cursor, said) => json("/v1/commits/under", { pack, path, query, ...(cursor === undefined ? {} : { cursor }), said }),
    search: (pack, query, cursor) => json("/v1/commits/search", { pack, query, ...(cursor === undefined ? {} : { cursor }) }),
    insight: (pack, number, paths, author, named) => json("/v1/pulls/insight", { pack, number, paths, author, named }),
    universeRows: (pack) => json("/v1/universe/rows", { pack }),
    warm: async (pack, keys) => (await json<{ made: number }>("/v1/warm", { pack, keys })).made,
  };
}

const errorOf = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error;
    return typeof error === "string" ? error : text;
  } catch {
    return text;
  }
};

/** Sends requests to the engine service at `base` with its token, the request's trace and a short timeout; its failures become the Site's errors, a missing pack `NoPack`. Each request's time goes to Sentry as `engine.latency` by endpoint and outcome; failures and timeouts are reported with their endpoint and pack. */
export function httpPost(base: string, token: string, options: { fetcher?: typeof fetch; timeout?: number } = {}): Post {
  const fetcher = options.fetcher ?? fetch;
  const timeout = options.timeout ?? ENGINE_TIMEOUT;
  const root = base.replace(/\/+$/, "");
  return async (endpoint, body) => {
    const trace = Sentry.getTraceData();
    const pack = typeof body.pack === "string" ? body.pack : null;
    const started = performance.now();
    const ended = (outcome: EngineOutcome) => {
      const ms = performance.now() - started;
      engineTimed(endpoint, outcome, ms);
      return ms;
    };
    const down = (outcome: EngineOutcome, status: number | null, detail: string): never => {
      engineFailed(new EngineError(endpoint, pack, outcome, status, detail), ended(outcome));
      throw new SiteError(503, ENGINE_DOWN);
    };
    let response: Response;
    try {
      response = await fetcher(`${root}${endpoint}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(trace["sentry-trace"] ? { "sentry-trace": trace["sentry-trace"] } : {}), ...(trace.baggage ? { baggage: trace.baggage } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      const error = e as Error;
      return down(error.name === "TimeoutError" ? "timeout" : "unreachable", null, error.name === "TimeoutError" ? `no answer within ${timeout} ms` : error.message);
    }
    if (response.ok) {
      const text = await response.text();
      ended("ok");
      return text;
    }
    const error = await errorOf(response);
    if (response.status === 404 && error === "no such answer") {
      ended("no_answer");
      return null;
    }
    if (response.status === 404 && error === "no such pack") {
      ended("no_pack");
      throw new NoPack(String(body.pack));
    }
    if (response.status === 400) {
      ended("refused");
      throw new SiteError(400, error || "That is not a question the engine answers.");
    }
    return down("failed", response.status, error);
  };
}

/** The engine service at `base`, asked with `token`. */
export function engineService(base: string, token: string, options: { fetcher?: typeof fetch; timeout?: number } = {}): EngineService {
  return engineOver(httpPost(base, token, options));
}
