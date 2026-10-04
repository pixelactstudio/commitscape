import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Config } from "./config";
import { cacheKey, prune } from "./disk";
import { build, BUILD_ATTEMPTS, failure, timeLimitOf, type BuildTarget, type Deps, type Ran } from "./run";

const cfg = (work: string, over: Partial<Config> = {}): Config => ({
  bin: "commitscape",
  work,
  concurrency: 1,
  maxMb: undefined,
  timeLimit: 60,
  diskGb: 20,
  gitBase: undefined,
  ...over,
});
const req = (over: Partial<BuildTarget> = {}): BuildTarget => ({
  id: "build-0001",
  owner: "acme",
  name: "rocket",
  sizeKb: 10 * 1024,
  private: false,
  token: null,
  seed: false,
  ...over,
});

const outOf = (args: string[]) => (args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined);

function fake(answer: (args: string[]) => Ran | Promise<Ran>) {
  const calls: string[][] = [];
  const said: string[] = [];
  const deps: Deps = {
    run: async (_cmd, args) => {
      calls.push(args);
      const out = outOf(args);
      if (out) await writeFile(out, "report");
      return answer(args);
    },
    progress: async (step) => void said.push(step),
  };
  return { deps, calls, said };
}
const ok: Ran = { code: 0, stderr: "", timedOut: false };

test("git's and commitscape's failures in the Site's words", () => {
  expect(failure("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")).toBe("not_found");
  expect(failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("private");
  expect(failure("disk full")).toBe("error");
});

test("every repository, however big, is cloned whole with its lines counted; a size limit refuses only when set", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const small = fake(() => ok);
  const done = await build(req(), cfg(work), small.deps);
  expect(done).toMatchObject({ ok: true });
  expect(done.ok && new TextDecoder().decode(done.report)).toBe("report");
  expect(small.calls[0]).toEqual(expect.arrayContaining(["report", "--no-emails", "--", "acme/rocket"]));
  expect(small.said).toEqual(["reading", "uploading"]);

  const huge = fake(() => ok);
  expect(await build(req({ sizeKb: 40_000 * 1024 }), cfg(work), huge.deps)).toMatchObject({ ok: true });
  expect(huge.calls[0]).not.toContain("--partial");
  expect(huge.calls[0]).not.toContain("--no-lines");

  const limited = fake(() => ok);
  expect(await build(req({ sizeKb: 4000 * 1024 }), cfg(work, { maxMb: 3000 }), limited.deps)).toEqual({ ok: false, reason: "too_big", detail: "4000 MB" });
  expect(limited.calls).toEqual([]);
});

test("a Build that runs too long stops as timed out, each attempt given twice the time of the one before; a missing one says not found", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const limits: number[] = [];
  const slow = fake(() => ({ code: null, stderr: "", timedOut: true }));
  const real = slow.deps.run;
  slow.deps.run = async (cmd, args, env, t) => {
    limits.push(t);
    return real(cmd, args, env, t);
  };
  expect(await build(req(), cfg(work, { timeLimit: 5 }), slow.deps)).toEqual({ ok: false, reason: "timed_out", detail: "5 s" });
  expect(await build(req({ attempt: 3 }), cfg(work, { timeLimit: 5 }), slow.deps)).toEqual({ ok: false, reason: "timed_out", detail: "20 s" });
  expect(limits[0]).toBeLessThanOrEqual(5000);
  expect(limits[1]).toBeGreaterThan(15_000);
  expect([1, 2, 3, 4, 9].map((a) => timeLimitOf(cfg(work, { timeLimit: 900 }), a))).toEqual([900, 1800, 3600, 7200, 7200]);
  expect(BUILD_ATTEMPTS).toBe(4);
  const missing = fake(() => ({ code: 128, stderr: "remote: Repository not found.", timedOut: false }));
  expect(await build(req(), cfg(work), missing.deps)).toMatchObject({ ok: false, reason: "not_found" });
});

test("a Connected Repository's clone and index are kept only while a timed-out Build will go on from them", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const slow = fake(() => ({ code: null, stderr: "", timedOut: true }));
  const real = slow.deps.run;
  slow.deps.run = async (cmd, args, env, t) => {
    await mkdir(join(args[args.indexOf("--cache-dir") + 1] ?? "", "clones"), { recursive: true });
    return real(cmd, args, env, t);
  };
  await build(req({ private: true, attempt: 1 }), cfg(work), slow.deps);
  expect(await readdir(join(work, "private"))).toEqual(["build-0001"]);
  await build(req({ private: true, attempt: BUILD_ATTEMPTS }), cfg(work), slow.deps);
  expect(await readdir(join(work, "private"))).toEqual([]);
});

test("a Connected Repository's clone and index are deleted after its Build", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(() => ok);
  const real = f.deps.run;
  f.deps.run = async (cmd, args, env, t) => {
    const cache = args[args.indexOf("--cache-dir") + 1] ?? "";
    await mkdir(join(cache, "clones", "acme", "rocket"), { recursive: true });
    await mkdir(join(cache, "0123456789abcdef"), { recursive: true });
    return real(cmd, args, env, t);
  };
  await build(req({ private: true }), cfg(work), f.deps);
  expect(f.calls[0]).toEqual(expect.arrayContaining(["--cache-dir", join(work, "private", "build-0001")]));
  expect(await readdir(join(work, "private"))).toEqual([]);
  await build(req(), cfg(work), f.deps);
  expect((await readdir(work)).sort()).toEqual(["0123456789abcdef", "clones", "out", "private"]);
});

test("commands see none of the Builder's secrets", async () => {
  const { run } = await import("./run");
  process.env.DATABASE_URL = "postgres://u:a-secret@db/x";
  process.env.S3_SECRET_ACCESS_KEY = "s3-secret";
  process.env.GITHUB_APP_PRIVATE_KEY = "app-secret";
  process.env.GITHUB_TOKEN = "ghp_secret";
  process.env.COMMITSCAPE_SETTING = "kept";
  try {
    const ran = await run("sh", ["-c", "env"], { GIT_TERMINAL_PROMPT: "0" }, 5000);
    expect(ran.stdout).toContain("GIT_TERMINAL_PROMPT=0");
    expect(ran.stdout).toContain("PATH=");
    expect(ran.stdout).toContain("COMMITSCAPE_SETTING=kept");
    expect(ran.stdout).not.toContain("a-secret");
    expect(ran.stdout).not.toContain("s3-secret");
    expect(ran.stdout).not.toContain("app-secret");
    expect(ran.stdout).not.toContain("ghp_secret");
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
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
  const index = join(work, "0123456789abcdef");
  await mkdir(index);
  await writeFile(join(index, "blocks"), Buffer.alloc(1000));
  await utimes(index, 500, 500);
  expect(await prune(work, 2500, [index])).toEqual([join(work, "clones", "acme", "mid")]);
  expect(await prune(work, 1500)).toEqual([index]);
});

test("the cache folder's name is commitscape's hash of the clone's git directory", () => {
  expect(cacheKey("/home/x/proj/.git")).toBe("7429609f670f7aff");
  expect(cacheKey("/home/x/other/.git")).not.toBe(cacheKey("/home/x/proj/.git"));
});

test("a name that could be read as a flag never reaches a command", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(() => ok);
  expect(await build(req({ owner: "-o" }), cfg(work), f.deps)).toMatchObject({ ok: false, reason: "not_found" });
  expect(await build(req({ name: ".." }), cfg(work), f.deps)).toMatchObject({ ok: false, reason: "not_found" });
  expect(f.calls).toEqual([]);
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
  expect(f.calls.map((c) => c[0])).toEqual(["report", "health"]);
  const plain = fake(() => ok);
  await build(req(), cfg(work), plain.deps);
  expect(plain.calls.map((c) => c[0])).toEqual(["report"]);
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
