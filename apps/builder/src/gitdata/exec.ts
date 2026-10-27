import { spawn } from "node:child_process";
import { passed } from "../run";

export type Git = {
  dir: string;
  env: NodeJS.ProcessEnv;
  deadline: number;
};

export type Out = { code: number | null; out: Buffer; err: string; timedOut: boolean; capped: boolean };

export class Late extends Error {
  constructor(what: string) {
    super(`${what} ran out of time`);
    this.name = "Late";
  }
}

const ARGS = ["--no-pager", "-c", "core.quotepath=off", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "log.showSignature=false"];

const left = (g: Git, ms?: number) => Math.max(0, Math.min(g.deadline - Date.now(), ms ?? Infinity));

/** Runs git in the clone with only safe environment variables, killing it and its children at the step's deadline; `onData` takes the output as it arrives instead of it being kept. */
export function git(g: Git, args: string[], opts: { input?: string | Buffer; maxBytes?: number; timeoutMs?: number; onData?: (chunk: Buffer) => void } = {}): Promise<Out> {
  return new Promise((resolve) => {
    const limit = left(g, opts.timeoutMs);
    if (limit <= 0) return resolve({ code: null, out: Buffer.alloc(0), err: "", timedOut: true, capped: false });
    const child = spawn("git", ["-C", g.dir, ...ARGS, ...args], {
      env: { ...passed(), LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", ...g.env },
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let err = "";
    let timedOut = false;
    let capped = false;
    let settled = false;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out: Buffer.concat(chunks), err, timedOut, capped });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      finish(null);
    }, limit);
    child.stdout?.on("data", (d: Buffer) => {
      if (opts.onData) return opts.onData(d);
      size += d.length;
      if (opts.maxBytes !== undefined && size > opts.maxBytes) {
        capped = true;
        kill();
        return;
      }
      chunks.push(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on("error", (e) => {
      err += String(e);
      finish(null);
    });
    child.on("close", (code) => finish(code));
    if (opts.input !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }
  });
}

/** Git's output as text, or an error when it failed or ran out of time. */
export async function text(g: Git, args: string[], opts: { input?: string | Buffer; maxBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const ran = await git(g, args, opts);
  if (ran.timedOut) throw new Late(`git ${args[0] ?? ""}`);
  if (ran.capped) throw new Error(`git ${args[0] ?? ""} printed more than ${opts.maxBytes} bytes`);
  if (ran.code !== 0) throw new Error(`git ${args[0] ?? ""} failed: ${ran.err.trim().split("\n").at(-1) ?? ran.code}`);
  return ran.out.toString("utf8");
}

/** Runs `fn` over `items` a few at a time and returns the results in order; stops starting new ones at the deadline. */
export async function pooled<T, R>(g: Git, items: T[], size: number, fn: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length || Date.now() > g.deadline) return;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
