import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SIGNATURE, sign, type BuildOutcome, type BuildRequest } from "@commitscape/data";
import type { Config } from "./config";
import { prune } from "./disk";
import { build, failure, type Deps, type Ran } from "./run";
import { builder } from "./server";

const secret = "s".repeat(40);
const cfg = (work: string, over: Partial<Config> = {}): Config => ({
  port: 0,
  host: "127.0.0.1",
  secret,
  site: "http://site",
  bin: "commitscape",
  work,
  concurrency: 1,
  fullUpToMb: 100,
  maxMb: 3000,
  timeLimit: 60,
  diskGb: 20,
  gitBase: undefined,
  ...over,
});
const req = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  id: "build-0001",
  owner: "acme",
  name: "rocket",
  sizeKb: 10 * 1024,
  private: false,
  token: null,
  uploadToken: "u".repeat(32),
  ...over,
});

/** A command's `--out` file, if it has one (`health` has none). */
const outOf = (args: string[]) => (args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined);

/** A Builder whose commands and Site are recorded, not real. */
function fake(answer: (args: string[]) => Ran | Promise<Ran>) {
  const calls: string[][] = [];
  const said: string[] = [];
  const deps: Deps = {
    run: async (_cmd, args) => {
      calls.push(args);
      const out = outOf(args);
      if (out) await writeFile(out, args[0] === "card" ? "<svg/>" : "report");
      return answer(args);
    },
    site: {
      progress: async (id, step) => void said.push(`${id} ${step}`),
      upload: async (id, what, bytes, type) => void said.push(`${id} ${what} ${type} ${bytes.length}`),
      done: async (id, o) => void said.push(`${id} done ${JSON.stringify(o)}`),
    },
    png: () => null,
  };
  return { deps, calls, said };
}
const ok: Ran = { code: 0, stderr: "", timedOut: false };

test("git's and commitscape's failures in the Site's words", () => {
  expect(failure("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")).toBe("not_found");
  expect(failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("private");
  expect(failure("disk full")).toBe("error");
});

test("a small repository is cloned whole, a big one partially, a huge one refused", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const small = fake(() => ok);
  expect(await build(req(), cfg(work), small.deps)).toMatchObject({ ok: true, lines: true, partial: false });
  expect(small.calls[0]).not.toContain("--partial");
  expect(small.calls[0]).toEqual(expect.arrayContaining(["report", "--data", "--no-emails", "acme/rocket"]));
  expect(small.said).toEqual(["build-0001 reading", "build-0001 uploading", "build-0001 report application/gzip 6", "build-0001 card image/svg+xml 6"]);

  const big = fake(() => ok);
  expect(await build(req({ sizeKb: 150 * 1024 }), cfg(work), big.deps)).toMatchObject({ ok: true, lines: false, partial: true });
  expect(big.calls[0]).toContain("--partial");

  const huge = fake(() => ok);
  expect(await build(req({ sizeKb: 4000 * 1024 }), cfg(work), huge.deps)).toEqual({ ok: false, reason: "too_big", detail: "4000 MB" });
  expect(huge.calls).toEqual([]);
});

test("a Build that runs too long stops as timed out; a missing one says not found", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const slow = fake(() => ({ code: null, stderr: "", timedOut: true }));
  expect(await build(req(), cfg(work, { timeLimit: 5 }), slow.deps)).toEqual({ ok: false, reason: "timed_out", detail: "5 s" });
  const missing = fake(() => ({ code: 128, stderr: "remote: Repository not found.", timedOut: false }));
  expect(await build(req(), cfg(work), missing.deps)).toMatchObject({ ok: false, reason: "not_found" });
});

test("a Connected Repository's clone and index are deleted after its Build", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(() => ok);
  const real = f.deps.run;
  // commitscape writes the clone and its index into the cache folder it is given.
  f.deps.run = async (cmd, args, env, t) => {
    const cache = args[args.indexOf("--cache-dir") + 1] ?? "";
    await mkdir(join(cache, "clones", "acme", "rocket"), { recursive: true });
    await mkdir(join(cache, "0123456789abcdef"), { recursive: true });
    return real(cmd, args, env, t);
  };
  await build(req({ private: true }), cfg(work), f.deps);
  expect(f.calls[0]).toEqual(expect.arrayContaining(["--cache-dir", join(work, "private", "build-0001")]));
  expect(await readdir(join(work, "private"))).toEqual([]);
  // A public repository's are kept for its next Build.
  await build(req(), cfg(work), f.deps);
  expect((await readdir(work)).sort()).toEqual(["0123456789abcdef", "clones", "out", "private"]);
});

test("commands see none of the Builder's secrets", async () => {
  const { run } = await import("./run");
  process.env.BUILDER_SECRET = "a-secret-a-secret-a-secret-a-secret";
  process.env.GITHUB_TOKEN = "ghp_secret";
  process.env.COMMITSCAPE_SETTING = "kept";
  try {
    const ran = await run("sh", ["-c", "env"], { GIT_TERMINAL_PROMPT: "0" }, 5000);
    expect(ran.stdout).toContain("GIT_TERMINAL_PROMPT=0");
    expect(ran.stdout).toContain("PATH=");
    expect(ran.stdout).toContain("COMMITSCAPE_SETTING=kept");
    expect(ran.stdout).not.toContain("a-secret");
    expect(ran.stdout).not.toContain("ghp_secret");
  } finally {
    delete process.env.BUILDER_SECRET;
    delete process.env.GITHUB_TOKEN;
    delete process.env.COMMITSCAPE_SETTING;
  }
});

test("the least recently built clones go first when the disk budget is passed", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  for (const [name, at] of [["old", 1000], ["mid", 2000], ["new", 3000]] as const) {
    const dir = join(work, "clones", "acme", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pack"), Buffer.alloc(1000));
    await utimes(dir, at, at);
  }
  expect(await prune(work, 2500)).toEqual([join(work, "clones", "acme", "old")]);
  expect(await prune(work, 5000)).toEqual([]);
  // commitscape's indexes count too, and go the same way.
  const index = join(work, "0123456789abcdef");
  await mkdir(index);
  await writeFile(join(index, "blocks"), Buffer.alloc(1000));
  await utimes(index, 500, 500);
  expect(await prune(work, 2500)).toEqual([index]);
});

test("only the Site can queue a Build, and Builds run one at a time", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  let running = 0;
  let most = 0;
  const done: BuildOutcome[] = [];
  const f = fake(async () => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 30));
    running--;
    return ok;
  });
  f.deps.site.done = async (_id, o) => void done.push(o);
  const { server, idle } = builder(cfg(work), f.deps, () => {});
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const post = async (body: string, signature?: string) =>
    fetch(`http://127.0.0.1:${port}/builds`, { method: "POST", body, headers: signature ? { [SIGNATURE]: signature } : {} });
  const one = JSON.stringify(req({ id: "build-0001" }));
  expect((await post(one)).status).toBe(401);
  expect((await post(one, await sign("wrong".repeat(8), "POST", "/builds", one))).status).toBe(401);
  expect((await post(one, await sign(secret, "POST", "/builds", one))).status).toBe(202);
  const two = JSON.stringify(req({ id: "build-0002" }));
  expect((await post(two, await sign(secret, "POST", "/builds", two))).status).toBe(202);
  const bad = JSON.stringify(req({ owner: "../etc" }));
  expect((await post(bad, await sign(secret, "POST", "/builds", bad))).status).toBe(400);
  const up = JSON.stringify(req({ id: "build-0003", name: ".." }));
  expect((await post(up, await sign(secret, "POST", "/builds", up))).status).toBe(400);
  // GitHub allows a name to start with a dot.
  const dotted = JSON.stringify(req({ id: "build-0004", name: ".github" }));
  expect((await post(dotted, await sign(secret, "POST", "/builds", dotted))).status).toBe(202);
  await idle();
  expect(done).toHaveLength(3);
  expect(most).toBe(1);
  server.close();
});

test("a person's Build goes ahead of the night's seeds", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return ok;
  });
  const order: string[] = [];
  f.deps.site.done = async (id) => void order.push(id);
  const b = builder(cfg(work), f.deps, () => {});
  for (const id of ["seed-0001", "seed-0002", "seed-0003"]) b.enqueue(req({ id, seed: true }));
  b.enqueue(req({ id: "person-01" }));
  b.enqueue(req({ id: "person-02" }));
  await b.idle();
  // The first seed had started; the people's come next, in their order.
  expect(order).toEqual(["seed-0001", "person-01", "person-02", "seed-0002", "seed-0003"]);
});

test("a command past its time is stopped with everything it started", async () => {
  const { run } = await import("./run");
  const started = Date.now();
  const ran = await run("sh", ["-c", "sleep 30 & sleep 30"], {}, 300);
  expect(ran.timedOut).toBe(true);
  expect(Date.now() - started).toBeLessThan(5000);
});

test("a Connected Repository is cloned with its installation token, from git's environment", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const envs: NodeJS.ProcessEnv[] = [];
  const f = fake(() => ok);
  const real = f.deps.run;
  f.deps.run = async (cmd, args, env, t) => {
    envs.push(env);
    return real(cmd, args, env, t);
  };
  await build(req({ private: true, token: "ghs_abc" }), cfg(work), f.deps);
  const header = envs[0]?.GIT_CONFIG_VALUE_0 ?? "";
  expect(envs[0]?.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
  expect(Buffer.from(header.replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:ghs_abc");
  expect(f.calls[0]?.join(" ")).not.toContain("ghs_abc");
});

test("a seed's Build carries the Report's numbers and how fast its issues are answered", async () => {
  const { gzipSync } = await import("node:zlib");
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const stats = { commits: 5, people: 2, bus_factor: 1, maintainers: 1, commits_30d: 4, people_30d: 2, code_lines: 100, untouched_5y: 10 };
  const f = fake((args) => ({ ...ok, stdout: args[0] === "health" ? JSON.stringify({ answers: { asked: 20, answered: 12, typical_hours: 3.5 } }) : "" }));
  const real = f.deps.run;
  f.deps.run = async (cmd, args, env, t) => {
    const ran = await real(cmd, args, env, t);
    const out = outOf(args);
    if (args[0] === "report" && out) await writeFile(out, gzipSync(JSON.stringify({ stats })));
    return ran;
  };
  const outcome = await build(req({ seed: true }), cfg(work), f.deps);
  expect(outcome).toMatchObject({ ok: true, stats: { ...stats, answered: 12, answer_hours: 3.5 } });
  expect(f.calls.map((c) => c[0])).toEqual(["report", "card", "health"]);
  // Not a seed: no `health`, the Report's numbers only.
  const plain = fake(() => ok);
  await build(req(), cfg(work), plain.deps);
  expect(plain.calls.map((c) => c[0])).toEqual(["report", "card"]);
});

test("the seed list is the most starred per language, each once", async () => {
  const { seedList } = await import("./seeds");
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(decodeURIComponent(url));
    const both = [
      { full_name: "a/one", stargazers_count: 900, size: 10 },
      { full_name: "b/two", stargazers_count: 500, size: 20 },
    ];
    return new Response(JSON.stringify({ items: url.includes("Rust") ? both : both.slice(0, 1) }));
  }) as unknown as typeof fetch;
  const list = await seedList({ languages: ["Rust", "Go"], perLanguage: 2, budget: 5, api: "http://gh", token: undefined }, fetcher);
  expect(list).toEqual([
    { owner: "a", name: "one", language: "Rust", stars: 900, sizeKb: 10 },
    { owner: "b", name: "two", language: "Rust", stars: 500, sizeKb: 20 },
  ]);
  expect(asked[0]).toContain('q=language:"Rust" archived:false fork:false&sort=stars&order=desc&per_page=2');
});

test("a call to the Site is tried again once when the connection drops or it answers 5xx, never on 4xx", async () => {
  const { site } = await import("./site");
  const answers: (Response | Error)[] = [new Error("connection lost"), new Response("{}")];
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    const a = answers.shift() ?? new Response("{}");
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  const s = site("http://site", secret, fetcher, 0);
  await s.upload("build-0001", "report", new Uint8Array(3), "application/gzip", "t");
  expect(calls).toBe(2);
  calls = 0;
  answers.push(new Response("busy", { status: 503 }), new Response("busy", { status: 503 }));
  await expect(s.done("build-0001", { ok: true, seconds: 1, lines: true, partial: false })).rejects.toThrow("503");
  expect(calls).toBe(2);
  calls = 0;
  answers.push(new Response("no", { status: 403 }));
  await expect(s.progress("build-0001", "reading")).rejects.toThrow("403");
  expect(calls).toBe(1);
});
