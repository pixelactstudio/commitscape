import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { ensureClone, failure, gitEnv } from "./clone";
import type { Config } from "./config";
import { prune } from "./disk";
import { build, BUILD_ATTEMPTS, cloneLimitOf, run, timeLimitOf, type BuildTarget, type Deps, type Made, type Phase, type Ran } from "./run";

const cfg = (work: string, over: Partial<Config> = {}): Config => ({
  bin: "commitscape",
  work,
  concurrency: 1,
  maxMb: undefined,
  timeLimit: 60,
  cloneLimit: 120,
  largeMb: 1500,
  largeConcurrency: 1,
  logins: 300,
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

const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ok: Ran = { code: 0, stderr: "", timedOut: false };
const signatures = [{ email: "ada@example.com", name: "Ada", commits: 3, sha: "a".repeat(40) }];

type Call = { cmd: string; args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number };

function fake(answer: (call: Call) => Ran | Promise<Ran> = () => ok) {
  const calls: Call[] = [];
  const said: string[] = [];
  const published: [Phase, string][] = [];
  const seen: Record<string, string>[] = [];
  const deps: Deps = {
    run: async (cmd, args, env, timeoutMs) => {
      const call = { cmd, args, env, timeoutMs };
      calls.push(call);
      const ran = await answer(call);
      if (ran.code !== 0) return ran;
      if (cmd === "git" && args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
      if (args[0] === "signatures") await writeFile(flag(args, "--out") ?? "", JSON.stringify(signatures));
      if (args[0] === "report") {
        const accounts = flag(args, "--accounts");
        if (accounts) seen.push(JSON.parse(await readFile(accounts, "utf8")) as Record<string, string>);
        await writeFile(flag(args, "--out") ?? "", gzipSync(JSON.stringify({ stats: null, lines: !args.includes("--no-lines") })));
        await writeFile(flag(args, "--commits-out") ?? "", gzipSync("[]"));
      }
      return ran;
    },
    progress: async (step) => void said.push(step),
    accounts: async (list) => Object.fromEntries(list.map((s) => [s.email, "ada"])),
    publish: async (phase: Phase, made: Made) => {
      published.push([phase, made.commits ? "commits" : "none"]);
      return true;
    },
  };
  return { deps, calls, said, published, seen };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const commands = (calls: Call[]) => calls.map((c) => (c.cmd === "git" ? `git ${c.args[0]}${c.args.includes("--filter=blob:none") ? " blobless" : ""}` : c.args[0]));

test("git's failures in the Site's words", () => {
  expect(failure("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")).toBe("not_found");
  expect(failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("private");
  expect(failure("disk full")).toBe("error");
});

test("a first Build clones quickly without old contents and in full at once, publishes the quick Report without lines first, then the full one", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(async (c) => {
    if (c.cmd === "git" && !c.args.includes("--filter=blob:none")) await pause(300);
    return ok;
  });
  const outcome = await build(req(), cfg(work), f.deps);
  expect(outcome).toMatchObject({ published: "full", resumable: false });
  expect(outcome.failure).toBeUndefined();
  const clones = f.calls.filter((c) => c.cmd === "git");
  expect(clones.map((c) => c.args.at(-2))).toEqual(["https://github.com/acme/rocket.git", "https://github.com/acme/rocket.git"]);
  expect(commands(f.calls).slice(0, 2).sort()).toEqual(["git clone", "git clone blobless"]);
  const quick = join(work, "jobs", "build-0001", "quick");
  const full = join(work, "repos", "acme", "rocket", "full");
  const sig = f.calls.find((c) => c.args[0] === "signatures");
  expect(sig?.args.at(-1)).toBe(quick);
  const reports = f.calls.filter((c) => c.args[0] === "report").sort((a, b) => Number(b.args.includes("--no-lines")) - Number(a.args.includes("--no-lines")));
  expect(reports[0]?.args).toEqual(expect.arrayContaining(["--no-lines", "--no-emails", "--offline", "--window", "all", "--accounts", "--commits-out"]));
  expect(reports[0]?.args.at(-1)).toBe(quick);
  expect(reports[1]?.args).not.toContain("--no-lines");
  expect(reports[1]?.args.at(-1)).toBe(full);
  expect(flag(reports[1]?.args ?? [], "--cache-dir")).toBe(join(work, "repos", "acme", "rocket", "cache"));
  expect(f.seen).toEqual([{ "ada@example.com": "ada" }, { "ada@example.com": "ada" }]);
  expect(f.published).toEqual([
    ["quick", "commits"],
    ["full", "commits"],
  ]);
  expect(f.said[0]).toBe("cloning");
  expect(existsSync(join(full, ".git"))).toBe(true);
  expect(await readdir(join(work, "jobs"))).toEqual([]);
  expect((await readdir(work)).sort()).toEqual(["jobs", "repos"]);
});

test("a quick Report made after the full one is never published", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(async (c) => {
    if (c.args.includes("--no-lines")) await pause(300);
    return ok;
  });
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full" });
  expect(f.published.map((p) => p[0])).toEqual(["full"]);
});

test("a kept clone is brought up to date and read twice, quick then full, with no second clone", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const full = join(work, "repos", "acme", "rocket", "full");
  await mkdir(join(full, ".git"), { recursive: true });
  const f = fake();
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full" });
  expect(commands(f.calls)).toEqual(["git rev-parse", "git fetch", "git reset", "signatures", "report", "report"]);
  const fetch = f.calls[1];
  expect(fetch?.env.GIT_DIR).toBe(join(full, ".git"));
  expect(fetch?.env.GIT_WORK_TREE).toBe(full);
  expect(fetch?.args).toEqual(["fetch", "--quiet", "--prune", "--tags", "origin"]);
  expect(f.calls.filter((c) => c.args[0] === "report").map((c) => c.args.at(-1))).toEqual([full, full]);
});

test("a full Report past its time leaves the quick one published, to be gone on from in the next attempt", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake((c) => (c.args[0] === "report" && !c.args.includes("--no-lines") ? { code: null, stderr: "", timedOut: true } : ok));
  const outcome = await build(req(), cfg(work, { timeLimit: 5, cloneLimit: 50 }), f.deps);
  expect(outcome).toMatchObject({ published: "quick", failure: { reason: "timed_out", detail: "5 s" }, resumable: true });
  const clone = f.calls.find((c) => c.cmd === "git");
  const report = f.calls.find((c) => c.args[0] === "report");
  expect(clone?.timeoutMs).toBeLessThanOrEqual(50_000);
  expect(clone?.timeoutMs).toBeGreaterThan(40_000);
  expect(report?.timeoutMs).toBe(5000);

  const last = fake((c) => (c.args[0] === "report" && !c.args.includes("--no-lines") ? { code: null, stderr: "", timedOut: true } : ok));
  expect(await build(req({ attempt: BUILD_ATTEMPTS }), cfg(work, { timeLimit: 5 }), last.deps)).toMatchObject({ published: null, failure: { reason: "timed_out", detail: "40 s" }, resumable: false });
  expect(commands(last.calls)).not.toContain("git clone blobless");
  expect([1, 2, 3, 4, 9].map((a) => timeLimitOf(cfg(work, { timeLimit: 900 }), a))).toEqual([900, 1800, 3600, 7200, 7200]);
  expect([1, 2].map((a) => cloneLimitOf(cfg(work, { cloneLimit: 1800 }), a))).toEqual([1800, 3600]);
});

test("a missing repository says not found, and one whose quick clone fails is still read in full", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const missing = fake((c) => (c.cmd === "git" ? { code: 128, stderr: "remote: Repository not found.", timedOut: false } : ok));
  expect(await build(req(), cfg(work), missing.deps)).toMatchObject({ published: null, failure: { reason: "not_found" } });
  expect(commands(missing.calls).filter((c) => !c.startsWith("git"))).toEqual([]);

  const flaky = fake((c) => (c.args.includes("--filter=blob:none") ? { code: 128, stderr: "fatal: early EOF", timedOut: false } : ok));
  expect(await build(req({ id: "build-0002" }), cfg(work), flaky.deps)).toMatchObject({ published: "full" });
  expect(flaky.published.map((p) => p[0])).toEqual(["full"]);
  expect(flaky.calls.find((c) => c.args[0] === "signatures")?.args.at(-1)).toBe(join(work, "repos", "acme", "rocket", "full"));
});

test("without signatures the Reports are made without accounts", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake((c) => (c.args[0] === "signatures" ? { code: 2, stderr: "unknown command", timedOut: false } : ok));
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full" });
  expect(f.calls.filter((c) => c.args[0] === "report").every((c) => !c.args.includes("--accounts"))).toBe(true);
});

test("emails exist only while the Build runs: the signatures and accounts files go with its scratch folder", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const left: string[][] = [];
  const f = fake(async (c) => {
    if (c.args[0] === "report") left.push(await readdir(join(work, "jobs", "build-0001")));
    return ok;
  });
  await build(req(), cfg(work), f.deps);
  expect(left[0]).toContain("accounts.json");
  expect(left[0]).not.toContain("signatures.json");
  expect(existsSync(join(work, "jobs", "build-0001"))).toBe(false);
});

test("a Connected Repository is cloned with its token in git's environment only, and its folder is deleted unless a next attempt goes on from it", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake();
  await build(req({ private: true, token: "ghs_abc" }), cfg(work), f.deps);
  const clone = f.calls.find((c) => c.cmd === "git");
  expect(clone?.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
  expect(Buffer.from((clone?.env.GIT_CONFIG_VALUE_0 ?? "").replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:ghs_abc");
  expect(f.calls.every((c) => !c.args.join(" ").includes("ghs_abc"))).toBe(true);
  expect(f.calls.find((c) => c.args[0] === "report" && !c.args.includes("--no-lines"))?.args.at(-1)).toBe(join(work, "private", "build-0001", "full"));
  expect(await readdir(join(work, "private"))).toEqual([]);

  const slow = fake((c) => (c.args[0] === "report" && !c.args.includes("--no-lines") ? { code: null, stderr: "", timedOut: true } : ok));
  await build(req({ private: true, token: "ghs_abc" }), cfg(work), slow.deps);
  expect(await readdir(join(work, "private"))).toEqual(["build-0001"]);
  await build(req({ private: true, token: "ghs_abc", attempt: BUILD_ATTEMPTS }), cfg(work), slow.deps);
  expect(await readdir(join(work, "private"))).toEqual([]);
});

test("a size limit refuses only when set, and a name that could be read as a flag never reaches a command", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake();
  expect(await build(req({ sizeKb: 4000 * 1024 }), cfg(work, { maxMb: 3000 }), f.deps)).toMatchObject({ published: null, failure: { reason: "too_big", detail: "4000 MB" } });
  expect(await build(req({ owner: "-o" }), cfg(work), f.deps)).toMatchObject({ failure: { reason: "not_found" } });
  expect(await build(req({ name: ".." }), cfg(work), f.deps)).toMatchObject({ failure: { reason: "not_found" } });
  expect(f.calls).toEqual([]);
});

test("a clone is made whole beside its folder and moved in, brought up to date after, and a failed one leaves nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "clone-"));
  const origin = join(root, "origin");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: origin, env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x" } });
  await mkdir(origin);
  git("init", "--quiet", "-b", "main");
  await writeFile(join(origin, "a.txt"), "one");
  git("add", ".");
  git("commit", "--quiet", "-m", "one");
  const dir = join(root, "repos", "acme", "rocket", "full");
  const how = { url: `file://${origin}`, dir, blobless: false, env: gitEnv(null), timeoutMs: 30_000 };
  expect(await ensureClone(run, how)).toMatchObject({ ok: true, fresh: true });
  expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("one");
  await writeFile(join(origin, "a.txt"), "two");
  git("commit", "--quiet", "-am", "two");
  expect(await ensureClone(run, how)).toMatchObject({ ok: true, fresh: false });
  expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two");
  const gone = join(root, "repos", "acme", "gone", "full");
  expect(await ensureClone(run, { ...how, url: `file://${root}/nothing`, dir: gone })).toMatchObject({ ok: false });
  expect(await readdir(join(root, "repos", "acme"))).toEqual(["gone", "rocket"]);
  expect(await readdir(join(root, "repos", "acme", "gone"))).toEqual([]);
});

test("commands see none of the Builder's secrets", async () => {
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

test("the least recently used repository folders go first when the disk budget is passed", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  for (const [name, at] of [["old", 1000], ["mid", 2000], ["new", 3000]] as const) {
    const dir = join(work, "repos", "acme", name);
    await mkdir(join(dir, "full"), { recursive: true });
    await writeFile(join(dir, "full", "pack"), Buffer.alloc(1000));
    await utimes(dir, at, at);
  }
  expect(await prune(work, 2500)).toEqual([join(work, "repos", "acme", "old")]);
  expect(await prune(work, 5000)).toEqual([]);
  expect(await prune(work, 1500, [join(work, "repos", "acme", "mid")])).toEqual([join(work, "repos", "acme", "new")]);
});

test("a command past its time is stopped with everything it started", async () => {
  const started = Date.now();
  const ran = await run("sh", ["-c", "sleep 30 & sleep 30"], {}, 300);
  expect(ran.timedOut).toBe(true);
  expect(Date.now() - started).toBeLessThan(5000);
});

test("the seed list is the most starred per language, each once", async () => {
  const { seedList } = await import("./seeds");
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(decodeURIComponent(url));
    const both = [
      { id: 1, full_name: "a/one", stargazers_count: 900, size: 10 },
      { full_name: "b/two", stargazers_count: 500, size: 20 },
    ];
    return new Response(JSON.stringify({ items: url.includes("Rust") ? both : both.slice(0, 1) }));
  }) as unknown as typeof fetch;
  const list = await seedList({ languages: ["Rust", "Go"], perLanguage: 2, budget: 5, api: "http://gh", token: undefined }, fetcher);
  expect(list).toEqual([
    { owner: "a", name: "one", language: "Rust", stars: 900, sizeKb: 10, githubId: 1 },
    { owner: "b", name: "two", language: "Rust", stars: 500, sizeKb: 20 },
  ]);
  expect(asked[0]).toContain('q=language:"Rust" archived:false fork:false&sort=stars&order=desc&per_page=2');
});
