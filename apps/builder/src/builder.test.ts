import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readManifest, type LiveIndex, type Loaded } from "@commitscape/server";
import { ensureClone, failure, gitEnv } from "./clone";
import type { Config } from "./config";
import { prune } from "./disk";
import { readEvents } from "./engine";
import { flagOf, writeBuilt, type FakeBuild } from "./fake";
import { build, BUILD_ATTEMPTS, cloneLimitOf, run, timeLimitOf, type BuildTarget, type Deps, type Made, type Ran, type RunOptions } from "./run";

const cfg = (work: string, over: Partial<Config> = {}): Config => ({
  bin: "commitscape",
  threads: undefined,
  linesBudget: 120,
  nice: 10,
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
  repo: "acme/rocket",
  owner: "acme",
  name: "rocket",
  sizeKb: 10 * 1024,
  private: false,
  token: null,
  seed: false,
  ...over,
});

const ok: Ran = { code: 0, stderr: "", timedOut: false };
const signatures = [{ email: "ada@example.com", name: "Ada", commits: 3, sha: "a".repeat(40) }];

type Call = { cmd: string; args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number; opts: RunOptions };

function fake(answer: (call: Call) => Ran | Promise<Ran> = () => ok, built: FakeBuild = {}, live: LiveIndex | null = null) {
  const calls: Call[] = [];
  const said: string[] = [];
  const published: string[] = [];
  const seen: Record<string, string>[] = [];
  const loads: { full: boolean; lines: boolean }[] = [];
  const index = { live };
  const deps: Deps = {
    run: async (cmd, args, env, timeoutMs, opts = {}) => {
      const call = { cmd, args, env, timeoutMs, opts };
      calls.push(call);
      const ran = await answer(call);
      if (ran.code !== 0) return ran;
      if (cmd === "git" && args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
      if (args[0] === "signatures") await writeFile(flagOf(args, "--out") ?? "", JSON.stringify(signatures));
      if (args[0] === "build") {
        const accounts = flagOf(args, "--accounts");
        if (accounts) seen.push(JSON.parse(await readFile(accounts, "utf8")) as Record<string, string>);
        await writeBuilt(args, built);
      }
      return ran;
    },
    progress: async (step) => void said.push(step),
    accounts: async (list) => Object.fromEntries(list.map((s) => [s.email, "ada"])),
    index: {
      live: async () => index.live,
      load: async (dir): Promise<Loaded> => {
        const m = await readManifest(dir);
        loads.push({ full: m.full, lines: m.lines_mainline });
        index.live = { id: 1, lineage: m.lineage, kept: true, frontier: m.frontier, lines: m.lines_mainline, linesLeft: m.lines_left, head: m.head, pack: null };
        return { si: 1, full: m.full, commits: m.commits, total: m.total, mainline: 0, lines: 0, seconds: 0 };
      },
    },
    publish: async (made: Made) => {
      published.push(made.phase);
      return true;
    },
  };
  return { deps, calls, said, published, seen, loads, index };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const commands = (calls: Call[]) => calls.map((c) => (c.cmd === "git" ? `git ${c.args[0]}${c.args.includes("--filter=blob:none") ? " blobless" : ""}` : c.args[0]));
const builds = (calls: Call[]) => calls.filter((c) => c.args[0] === "build");

test("git's failures in the Site's words", () => {
  expect(failure("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")).toBe("not_found");
  expect(failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("private");
  expect(failure("disk full")).toBe("error");
});

test("a cold Build clones quickly without old contents and in full at once, publishes the quick Stored Index first, then fills its lines in from the full clone", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(async (c) => {
    if (c.cmd === "git" && c.args[0] === "clone" && !c.args.includes("--filter=blob:none")) await pause(300);
    return ok;
  });
  const outcome = await build(req(), cfg(work, { threads: 2 }), f.deps);
  expect(outcome).toMatchObject({ published: "full", resumable: false, kind: "cold" });
  expect(outcome.failure).toBeUndefined();
  const clones = f.calls.filter((c) => c.cmd === "git" && c.args[0] === "clone");
  expect(clones.map((c) => c.args.at(-2))).toEqual(["https://github.com/acme/rocket.git", "https://github.com/acme/rocket.git"]);
  expect(commands(f.calls).slice(0, 2).sort()).toEqual(["git clone", "git clone blobless"]);
  const graphs = f.calls.filter((c) => c.args[0] === "commit-graph");
  expect(graphs).toHaveLength(1);
  expect(graphs[0]?.args).toEqual(["commit-graph", "write", "--reachable", "--no-progress"]);
  expect(graphs[0]?.env.GIT_DIR).toBe(join(work, "repos", "acme", "rocket", ".full.cloning", ".git"));
  const quick = join(work, "jobs", "build-0001", "quick");
  const full = join(work, "repos", "acme", "rocket", "full");
  expect(f.calls.find((c) => c.args[0] === "signatures")?.args.at(-1)).toBe(quick);
  const [first, second] = builds(f.calls);
  expect(first?.args).toEqual(expect.arrayContaining(["--no-lines", "--offline", "--accounts", "--events", "--out"]));
  expect(first?.args).not.toContain("--after");
  expect(first?.args.at(-1)).toBe(quick);
  expect(second?.args).not.toContain("--no-lines");
  expect(flagOf(second?.args ?? [], "--lines-budget")).toBe("120");
  expect(flagOf(second?.args ?? [], "--lineage")).toBe("7");
  expect(second?.args.at(-1)).toBe(full);
  for (const call of f.calls.filter((c) => c.cmd !== "git")) {
    expect(flagOf(call.args, "--cache-dir")).toBe(join(work, "repos", "acme", "rocket", "cache"));
    expect(flagOf(call.args, "--cache-key")).toBe("acme/rocket");
    expect(call.opts.nice).toBe(10);
    expect(call.env.COMMITSCAPE_THREADS).toBe("2");
  }
  expect(f.calls.filter((c) => c.cmd === "git").every((c) => c.env.COMMITSCAPE_THREADS === undefined && c.opts.nice === undefined)).toBe(true);
  expect(f.seen).toEqual([{ "ada@example.com": "ada" }, { "ada@example.com": "ada" }]);
  expect(f.loads).toEqual([
    { full: true, lines: false },
    { full: false, lines: true },
  ]);
  expect(f.published).toEqual(["quick", "full"]);
  expect(outcome.made?.manifest.lines_left).toBe(0);
  expect(f.said[0]).toBe("cloning");
  expect(existsSync(join(full, ".git"))).toBe(true);
  expect(await readdir(join(work, "jobs"))).toEqual([]);
  expect((await readdir(work)).sort()).toEqual(["jobs", "repos"]);
});

test("a warm Build brings the kept clone up to date and goes straight to the full build", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const full = join(work, "repos", "acme", "rocket", "full");
  await mkdir(join(full, ".git"), { recursive: true });
  const f = fake(() => ok, {}, { id: 1, lineage: "7", kept: true, frontier: ["b".repeat(40)], lines: true, linesLeft: 0, head: "b".repeat(40), pack: "packs/acme/rocket/1/b-lines.pack" });
  const outcome = await build(req(), cfg(work), f.deps);
  expect(outcome).toMatchObject({ published: "full", kind: "warm" });
  expect(commands(f.calls)).toEqual(["git rev-parse", "git fetch", "git reset", "signatures", "build"]);
  const fetch = f.calls[1];
  expect(fetch?.env.GIT_DIR).toBe(join(full, ".git"));
  expect(fetch?.env.GIT_WORK_TREE).toBe(full);
  expect(fetch?.env.GIT_CONFIG_KEY_0).toBe("fetch.writeCommitGraph");
  expect(fetch?.args).toEqual(["fetch", "--quiet", "--prune", "--tags", "origin"]);
  expect(builds(f.calls)[0]?.args.at(-1)).toBe(full);
  expect(builds(f.calls)[0]?.args).toEqual(expect.arrayContaining(["--lines-budget", "--after", "--lineage"]));
  expect(f.published).toEqual(["full"]);
});

test("a cold Build of a repository whose Stored Index has lines skips the quick phase, and so does one whose Report has them", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(() => ok, {}, { id: 1, lineage: "7", kept: true, frontier: ["b".repeat(40)], lines: true, linesLeft: 3, head: "b".repeat(40), pack: null });
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full", kind: "cold" });
  expect(commands(f.calls)).toEqual(["git clone", "git commit-graph", "signatures", "build"]);
  expect(f.published).toEqual(["full"]);

  const reported = fake();
  await build(req({ id: "build-0002", name: "other", repo: "acme/other", hasLines: true }), cfg(work), reported.deps);
  expect(commands(reported.calls)).not.toContain("git clone blobless");
  expect(reported.published).toEqual(["full"]);
});

test("the full phase's clone is brought up to date again when it lacks a tip the quick clone saw, so the full load is never taken for rewritten history", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const newer = "c".repeat(40);
  const full = join(work, "repos", "acme", "rocket", "full");
  const asked: string[] = [];
  const f = fake(async (c) => {
    if (c.cmd === "git" && c.args[0] === "clone" && !c.args.includes("--filter=blob:none")) await pause(200);
    if (c.cmd === "git" && c.args[0] === "for-each-ref") return { ...ok, stdout: `${"a".repeat(40)}\n${newer}\n` };
    if (c.cmd === "git" && c.args[0] === "cat-file") {
      asked.push(c.opts.input ?? "");
      const fetched = f.calls.some((x) => x.args[0] === "fetch");
      return { ...ok, stdout: `${"a".repeat(40)} commit\n${newer} ${fetched ? "commit" : "missing"}\n` };
    }
    return ok;
  });
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full" });
  expect(asked).toEqual([`${"a".repeat(40)}\n${newer}\n`]);
  expect(f.calls.find((c) => c.args[0] === "for-each-ref")?.env.GIT_DIR).toBe(join(work, "jobs", "build-0001", "quick", ".git"));
  expect(f.calls.find((c) => c.args[0] === "cat-file")?.env.GIT_DIR).toBe(join(full, ".git"));
  const order = commands(f.calls);
  expect(order.indexOf("git fetch")).toBeGreaterThan(order.indexOf("git cat-file"));
  expect(f.calls.findIndex((c) => c.args[0] === "fetch")).toBeLessThan(f.calls.findIndex((c) => c.args[0] === "build" && !c.args.includes("--no-lines")));

  const level = fake(async (c) => {
    if (c.cmd === "git" && c.args[0] === "clone" && !c.args.includes("--filter=blob:none")) await pause(200);
    if (c.args[0] === "for-each-ref") return { ...ok, stdout: `${"a".repeat(40)}\n` };
    if (c.args[0] === "cat-file") return { ...ok, stdout: `${"a".repeat(40)} commit\n` };
    return ok;
  });
  await build(req({ id: "build-0002", name: "level", repo: "acme/level" }), cfg(work), level.deps);
  expect(commands(level.calls)).not.toContain("git fetch");
});

test("git data is read from the full clone beside the line pass, and its failure leaves the Build published", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  let gitStarted = false;
  let builtAfterGit = false;
  const f = fake(async (c) => {
    if (c.args[0] === "build" && !c.args.includes("--no-lines")) {
      await pause(100);
      builtAfterGit = gitStarted;
    }
    return ok;
  });
  const dirs: string[] = [];
  const outcome = await build(req(), cfg(work), {
    ...f.deps,
    git: async (dir) => {
      gitStarted = true;
      dirs.push(dir);
      await pause(50);
    },
  });
  expect(outcome).toMatchObject({ published: "full" });
  expect(dirs).toEqual([join(work, "repos", "acme", "rocket", "full")]);
  expect(builtAfterGit).toBe(true);

  const broken = fake();
  const logged: string[] = [];
  const failed = await build(req({ id: "build-0002" }), cfg(work), {
    ...broken.deps,
    log: (line) => void logged.push(line),
    git: async () => {
      throw new Error("git is gone");
    },
  });
  expect(failed).toMatchObject({ published: "full" });
  expect(logged).toContain("git data of acme/rocket: git is gone");

  const more = fake();
  let ran = false;
  await build(req({ id: "build-0003", more: true }), cfg(work), { ...more.deps, git: async () => void (ran = true) });
  expect(ran).toBe(false);
});

test("the full build's line pass stops at the lines budget and says how many commits are left", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake(() => ok, { left: 40 });
  const outcome = await build(req(), cfg(work, { linesBudget: 30 }), f.deps);
  expect(flagOf(builds(f.calls).at(-1)?.args ?? [], "--lines-budget")).toBe("30");
  expect(outcome.made).toMatchObject({ phase: "full", manifest: { lines_left: 40, lines_mainline: true, lines: false } });
});

test("a full build past its time leaves the quick one published, to be gone on from in the next attempt", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const slow = (c: Call): Ran => (c.args[0] === "build" && !c.args.includes("--no-lines") ? { code: null, stderr: "", timedOut: true } : ok);
  const f = fake(slow);
  const outcome = await build(req(), cfg(work, { timeLimit: 5, cloneLimit: 50 }), f.deps);
  expect(outcome).toMatchObject({ published: "quick", failure: { reason: "timed_out", detail: "5 s" }, resumable: true });
  const clone = f.calls.find((c) => c.cmd === "git");
  expect(clone?.timeoutMs).toBeLessThanOrEqual(50_000);
  expect(clone?.timeoutMs).toBeGreaterThan(40_000);
  expect(builds(f.calls)[0]?.timeoutMs).toBe(5000);

  const last = fake(slow);
  expect(await build(req({ attempt: BUILD_ATTEMPTS }), cfg(work, { timeLimit: 5 }), last.deps)).toMatchObject({ published: null, failure: { reason: "timed_out", detail: "40 s" }, resumable: false });
  expect(commands(last.calls)).not.toContain("git clone blobless");
  expect([1, 2, 3, 4, 9].map((a) => timeLimitOf(cfg(work, { timeLimit: 900 }), a))).toEqual([900, 1800, 3600, 7200, 7200]);
  expect([1, 2].map((a) => cloneLimitOf(cfg(work, { cloneLimit: 1800 }), a))).toEqual([1800, 3600]);
});

test("a load that fails ends the phase, and the Build says why", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake();
  f.deps.index.load = async () => {
    throw new Error("COPY failed");
  };
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: null, failure: { reason: "error", detail: "COPY failed" } });
  expect(f.published).toEqual([]);
});

test("a missing repository says not found, and one whose quick clone fails is still read in full", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const missing = fake((c) => (c.cmd === "git" ? { code: 128, stderr: "remote: Repository not found.", timedOut: false } : ok));
  expect(await build(req(), cfg(work), missing.deps)).toMatchObject({ published: null, failure: { reason: "not_found" } });
  expect(commands(missing.calls).filter((c) => !c.startsWith("git"))).toEqual([]);

  const flaky = fake((c) => (c.args.includes("--filter=blob:none") ? { code: 128, stderr: "fatal: early EOF", timedOut: false } : ok));
  expect(await build(req({ id: "build-0002" }), cfg(work), flaky.deps)).toMatchObject({ published: "full" });
  expect(flaky.published).toEqual(["full"]);
  expect(flaky.calls.find((c) => c.args[0] === "signatures")?.args.at(-1)).toBe(join(work, "repos", "acme", "rocket", "full"));
});

test("without signatures the builds run without accounts", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const f = fake((c) => (c.args[0] === "signatures" ? { code: 2, stderr: "unknown command", timedOut: false } : ok));
  expect(await build(req(), cfg(work), f.deps)).toMatchObject({ published: "full" });
  expect(builds(f.calls).every((c) => !c.args.includes("--accounts"))).toBe(true);
});

test("emails exist only while the Build runs: the signatures and accounts files go with its scratch folder", async () => {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const left: string[][] = [];
  const f = fake(async (c) => {
    if (c.args[0] === "build") left.push(await readdir(join(work, "jobs", "build-0001")));
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
  const header = Object.entries(clone?.env ?? {}).find(([, v]) => v === "http.https://github.com/.extraheader")?.[0] ?? "";
  expect(header).toMatch(/^GIT_CONFIG_KEY_\d$/);
  const value = clone?.env[header.replace("KEY", "VALUE")] ?? "";
  expect(Buffer.from(value.replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:ghs_abc");
  expect(clone?.env.GIT_CONFIG_COUNT).toBe("3");
  expect(f.calls.every((c) => !c.args.join(" ").includes("ghs_abc"))).toBe(true);
  expect(builds(f.calls).at(-1)?.args.at(-1)).toBe(join(work, "private", "build-0001", "full"));
  expect(await readdir(join(work, "private"))).toEqual([]);

  const slow = fake((c) => (c.args[0] === "build" && !c.args.includes("--no-lines") ? { code: null, stderr: "", timedOut: true } : ok));
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

test("a clone is made whole beside its folder with a commit-graph and moved in, brought up to date after, and a failed one leaves nothing", async () => {
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
  expect(existsSync(join(dir, ".git", "objects", "info", "commit-graph")) || existsSync(join(dir, ".git", "objects", "info", "commit-graphs"))).toBe(true);
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
  process.env.SENTRY_DSN = "https://sentry-secret@example.com/1";
  process.env.POSTHOG_KEY = "phc_secret";
  process.env.COMMITSCAPE_SETTING = "kept";
  try {
    const ran = await run("sh", ["-c", "env"], { GIT_TERMINAL_PROMPT: "0" }, 5000);
    expect(ran.stdout).toContain("GIT_TERMINAL_PROMPT=0");
    expect(ran.stdout).toContain("PATH=");
    expect(ran.stdout).toContain("COMMITSCAPE_SETTING=kept");
    for (const secret of ["a-secret", "s3-secret", "app-secret", "ghp_secret", "sentry-secret", "phc_secret"]) expect(ran.stdout).not.toContain(secret);
  } finally {
    for (const k of ["DATABASE_URL", "S3_SECRET_ACCESS_KEY", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN", "SENTRY_DSN", "POSTHOG_KEY", "COMMITSCAPE_SETTING"]) delete process.env[k];
  }
});

test("a command runs at the priority it is given and reads what it is handed", async () => {
  const niced = await run("sh", ["-c", "sleep 0.3; cut -d' ' -f19 /proc/$$/stat"], {}, 5000, { nice: 7 });
  expect(niced.stdout?.trim()).toBe("7");
  const fed = await run("cat", [], {}, 5000, { input: "abc\n" });
  expect(fed.stdout).toBe("abc\n");
});

test("the engine's timing events are read one line each, and a line that is not one is left out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "events-"));
  const file = join(dir, "events");
  await writeFile(file, `${JSON.stringify({ span: "load", start_ms: 1, end_ms: 5, fields: { commits: 3 } })}\nnot json\n${JSON.stringify({ span: "pack", start_ms: 6, end_ms: 7 })}\n`);
  expect(await readEvents(file)).toEqual([
    { span: "load", start_ms: 1, end_ms: 5, fields: { commits: 3 } },
    { span: "pack", start_ms: 6, end_ms: 7, fields: {} },
  ]);
  expect(await readEvents(join(dir, "none"))).toEqual([]);
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
