import { expect, test } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitting, peakMb } from "./admission";
import { ensureClone } from "./clone";
import type { Ran, RunOptions } from "./run";

function gate(budget: number, heavy = ["commitscape", "node"]) {
  const order: string[] = [];
  const open = new Map<string, () => void>();
  const slow = async (cmd: string, args: string[]): Promise<Ran> => {
    const name = args[0] ?? cmd;
    order.push(`start ${name}`);
    await new Promise<void>((r) => open.set(name, r));
    order.push(`end ${name}`);
    return { code: name === "fails" ? 1 : 0, stderr: "", timedOut: false };
  };
  const run = admitting(slow, heavy, budget);
  const ask = (cmd: string, name: string, memoryMb?: number) => run(cmd, [name], {}, 1000, memoryMb === undefined ? {} : ({ memoryMb } satisfies RunOptions));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const finish = async (name: string) => {
    open.get(name)?.();
    await tick();
  };
  return { order, ask, tick, finish };
}

test("runs of the engine start while the memory they say they take fits beside the others, in the order they asked; every other command runs at once", async () => {
  const g = gate(300);
  const runs = [g.ask("commitscape", "a", 100), g.ask("commitscape", "fails", 150), g.ask("commitscape", "c", 100), g.ask("git", "clone")];
  await g.tick();
  expect([...g.order].sort()).toEqual(["start a", "start clone", "start fails"]);
  await g.finish("fails");
  expect(g.order.at(-1)).toBe("start c");
  for (const name of ["a", "c", "clone"]) await g.finish(name);
  expect((await Promise.all(runs)).map((r) => r.code)).toEqual([0, 1, 0, 0]);
});

test("a run larger than the budget waits until nothing runs and then runs alone, and no run asked after it goes first", async () => {
  const g = gate(300);
  const runs = [g.ask("commitscape", "small", 100), g.ask("commitscape", "huge", 900), g.ask("commitscape", "after", 50)];
  await g.tick();
  expect(g.order).toEqual(["start small"]);
  await g.finish("small");
  expect(g.order.slice(-1)).toEqual(["start huge"]);
  await g.finish("huge");
  expect(g.order.slice(-2)).toEqual(["end huge", "start after"]);
  await g.finish("after");
  await Promise.all(runs);
});

test("the Atlas waits in the same line as the engine, and a run that says nothing is taken for 256 MB", async () => {
  const g = gate(400);
  const runs = [g.ask("commitscape", "build"), g.ask("node", "atlas", 200)];
  await g.tick();
  expect(g.order).toEqual(["start build"]);
  await g.finish("build");
  expect(g.order.at(-1)).toBe("start atlas");
  await g.finish("atlas");
  await Promise.all(runs);
});

test("any other command that says the memory it takes waits in the same line", async () => {
  const g = gate(300);
  const runs = [g.ask("commitscape", "build", 250), g.ask("git", "repack", 100), g.ask("git", "status")];
  await g.tick();
  expect([...g.order].sort()).toEqual(["start build", "start status"]);
  await g.finish("build");
  expect(g.order.at(-1)).toBe("start repack");
  for (const name of ["repack", "status"]) await g.finish(name);
  await Promise.all(runs);
});

test("a clone and a fetch say the memory they take, so they wait in the same line as the engine's runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gate-"));
  const asked: [string, number | undefined][] = [];
  const run = async (_cmd: string, args: string[], _env: NodeJS.ProcessEnv, _t: number, opts?: RunOptions): Promise<Ran> => {
    asked.push([args[0] ?? "", opts?.memoryMb]);
    if (args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
    return { code: 0, stderr: "", timedOut: false };
  };
  const how = { url: "file:///nowhere", dir: join(dir, "full"), blobless: false, env: {}, timeoutMs: 1000, sizeKb: 1_100_000 };
  await ensureClone(run as never, how);
  await ensureClone(run as never, how);
  await ensureClone(run as never, { ...how, dir: join(dir, "lean"), blobless: true });
  expect(asked).toEqual([
    ["clone", peakMb("clone", { commits: 0, sizeKb: 1_100_000 })],
    ["commit-graph", undefined],
    ["rev-parse", undefined],
    ["fetch", peakMb("fetch", { commits: 0, sizeKb: 1_100_000 })],
    ["reset", undefined],
    ["clone", peakMb("blobless", { commits: 0, sizeKb: 1_100_000 })],
  ]);
  expect(peakMb("clone", { commits: 0, sizeKb: 1_100_000 })).toBeGreaterThan(92);
});

test("an estimate is above every peak measured on linux and react", () => {
  const linux = { commits: 1_501_892, sizeKb: 5_800_000 };
  const react = { commits: 21_722, sizeKb: 1_100_000 };
  const measured: [Parameters<typeof peakMb>[0], typeof linux, number][] = [
    ["build", linux, 170],
    ["build", react, 38],
    ["cold", linux, 248],
    ["cold", react, 158],
    ["surviving", linux, 199],
    ["surviving", react, 121],
    ["screens", linux, 191],
    ["atlas", linux, 98],
    ["atlas", react, 13],
  ];
  for (const [kind, repo, peak] of measured) {
    const estimate = peakMb(kind, repo);
    expect(estimate, `${kind} ${repo.commits}`).toBeGreaterThanOrEqual(peak);
    expect(estimate, `${kind} ${repo.commits}`).toBeLessThan(peak * 1.6 + 100);
  }
});
