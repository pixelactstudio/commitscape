/**
 * The Builder's front door: `POST /builds`, signed by the Site, queues a
 * Build; Builds run one at a time (or `CONCURRENCY`). `GET /health` says
 * whether it is up and how busy.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { utimes } from "node:fs/promises";
import { SIGNATURE, verify, type BuildRequest } from "@commitscape/data";
import type { Config } from "./config";
import { prune } from "./disk";
import { build, clonePath, type Deps } from "./run";

function body(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (d: Buffer) => {
      text += d.toString();
      if (text.length > limit) req.destroy(new Error("too large"));
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

function valid(r: unknown): r is BuildRequest {
  const b = r as BuildRequest;
  const name = /^[A-Za-z0-9_.-]{1,100}$/;
  return (
    typeof b === "object" &&
    b !== null &&
    typeof b.id === "string" &&
    /^[A-Za-z0-9_-]{8,64}$/.test(b.id) &&
    name.test(b.owner) &&
    name.test(b.name) &&
    !b.owner.startsWith(".") &&
    // GitHub allows a name to start with a dot (`.github`), as the Site does.
    b.name !== "." &&
    b.name !== ".." &&
    typeof b.sizeKb === "number" &&
    typeof b.private === "boolean" &&
    typeof b.uploadToken === "string"
  );
}

/** Builds waiting past this are refused, and the Site says Builds are paused: a night's seeds fit. */
export const QUEUE_MAX = 250;

export type Builder = { server: Server; idle: () => Promise<void>; enqueue: (r: BuildRequest) => void };

export function builder(cfg: Config, deps: Deps, log = console.log, onSeed?: () => void): Builder {
  const queue: BuildRequest[] = [];
  /** A person's Build waits behind other people's, never behind the night's seeds. */
  const add = (r: BuildRequest) => {
    if (queue.some((q) => q.id === r.id)) return;
    const firstSeed = r.seed ? -1 : queue.findIndex((q) => q.seed);
    if (firstSeed === -1) queue.push(r);
    else queue.splice(firstSeed, 0, r);
  };
  let running = 0;
  let waiters: (() => void)[] = [];
  const next = () => {
    while (running < cfg.concurrency && queue.length > 0) {
      const req = queue.shift() as BuildRequest;
      running++;
      const started = Date.now();
      log(`build ${req.id} ${req.owner}/${req.name}: started`);
      void build(req, cfg, deps)
        .then(async (outcome) => {
          log(`build ${req.id} ${req.owner}/${req.name}: ${outcome.ok ? "done" : outcome.reason} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
          await deps.site.done(req.id, outcome).catch((e: Error) => log(`build ${req.id}: telling the Site failed: ${e.message}`));
          const partial = req.sizeKb / 1024 > cfg.fullUpToMb;
          const kept = clonePath(cfg, req, partial);
          // Built now: the last to be pruned.
          await utimes(kept, new Date(), new Date()).catch(() => {});
          const pruned = await prune(cfg.work, cfg.diskGb * 1024 ** 3, kept);
          for (const p of pruned) log(`pruned ${p}`);
        })
        .finally(() => {
          running--;
          next();
          if (running === 0 && queue.length === 0) {
            for (const w of waiters) w();
            waiters = [];
          }
        });
    }
  };
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === "GET" && req.url === "/health") return reply(200, { ok: true, running, queued: queue.length });
      // The night's seeds, now: signed, as a Build is (the owner's timer or a test).
      if (req.method === "POST" && req.url === "/seed" && onSeed) {
        const text = await body(req);
        if (!(await verify(cfg.secret, (req.headers[SIGNATURE] as string | undefined) ?? null, "POST", "/seed", text))) {
          return reply(401, { error: "Not signed." });
        }
        onSeed();
        return reply(202, { seeding: true });
      }
      if (req.method !== "POST" || req.url !== "/builds") return reply(404, { error: "No such thing here." });
      const text = await body(req);
      if (!(await verify(cfg.secret, req.headers[SIGNATURE] as string | undefined ?? null, "POST", "/builds", text))) {
        return reply(401, { error: "Not signed by the Site." });
      }
      const parsed: unknown = JSON.parse(text);
      if (!valid(parsed)) return reply(400, { error: "Not a Build." });
      if (queue.length >= QUEUE_MAX) return reply(503, { error: "Too many Builds waiting." });
      add(parsed);
      reply(202, { queued: queue.length, running });
      next();
    } catch (e) {
      reply(400, { error: (e as Error).message });
    }
  });
  const idle = () => (running === 0 && queue.length === 0 ? Promise.resolve() : new Promise<void>((r) => waiters.push(r)));
  const enqueue = (r: BuildRequest) => {
    add(r);
    next();
  };
  return { server, idle, enqueue };
}
