import type { RunOptions, Runner } from "./run";

/** What an engine run does, as far as its memory goes. */
export type EngineRun = "build" | "columns" | "cold" | "signatures" | "surviving" | "screens" | "atlas" | "clone" | "blobless" | "fetch";

/** What is known of a repository before a run starts: its commits from its live Stored Index (0 when it has none) and its size on GitHub. */
export type Sized = { commits: number; sizeKb: number };

const UNKNOWN_MB = 256;

/** About how many MB of memory an engine run takes at its peak, a little over what was measured on two threads (2026-10-27: linux, 1.5M commits, and facebook/react, 22k): a warm build 94–170 MB on linux and 9–38 on react, the first one that writes the Index's column file 498 on linux, a cold one 248 and 158, everyone's Surviving Lines 199 and 121, the standard screens 191, the Atlas 98 and 13. A cold run knows no commit count yet, so it goes by the repository's size, as git's runs do: a whole clone (react: 82 to 92 MB for a 150 MB pack, `git index-pack` holding every object it receives), a blobless one (commits and trees only) and a fetch into a kept clone. */
export function peakMb(kind: EngineRun, repo: Sized): number {
  const thousands = repo.commits / 1000;
  const sizeMb = repo.sizeKb / 1024;
  const mb = {
    build: 48 + 0.12 * thousands,
    columns: 64 + 0.3 * thousands,
    cold: Math.max(170 + 0.03 * sizeMb, 64 + 0.15 * thousands),
    signatures: 32 + 0.04 * thousands,
    surviving: Math.max(130, 64 + 0.13 * thousands),
    screens: 48 + 0.1 * thousands,
    atlas: 48 + 0.04 * thousands,
    clone: 64 + 0.3 * sizeMb,
    blobless: 64 + 0.1 * sizeMb,
    fetch: 64 + 0.02 * sizeMb,
  }[kind];
  return Math.ceil(mb);
}

/** A runner through which runs of the engine (`heavy` commands), and any other command that says the memory it takes, start only while that memory (`memoryMb`, else 256) fits in `budgetMb` beside the runs already going, in the order they asked: a run larger than the budget waits until nothing else runs, then runs alone. Every other command runs at once. A run's time limit starts when it is let in. */
export function admitting(runner: Runner, heavy: string[], budgetMb: number): Runner {
  const commands = new Set(heavy);
  let used = 0;
  let running = 0;
  const waiting: { need: number; start: () => void }[] = [];
  const pump = () => {
    for (;;) {
      const next = waiting[0];
      if (!next || (running > 0 && used + next.need > budgetMb)) return;
      waiting.shift();
      used += next.need;
      running += 1;
      next.start();
    }
  };
  return async (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, opts?: RunOptions) => {
    if (!commands.has(cmd) && opts?.memoryMb === undefined) return runner(cmd, args, env, timeoutMs, opts);
    const need = Math.min(Math.max(1, opts?.memoryMb ?? UNKNOWN_MB), budgetMb);
    await new Promise<void>((start) => {
      waiting.push({ need, start });
      pump();
    });
    try {
      return await runner(cmd, args, env, timeoutMs, opts);
    } finally {
      used -= need;
      running -= 1;
      pump();
    }
  };
}
