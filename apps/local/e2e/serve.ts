import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The repository's root, three folders up from apps/local/e2e.
const root = resolve(import.meta.dirname, "../../..");

/** The commitscape binary under test: COMMITSCAPE_BIN, or the newest build. */
export function binary(): string {
  const found = [process.env.COMMITSCAPE_BIN, join(root, "target/release/commitscape"), join(root, "target/debug/commitscape")]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(p));
  if (!found) throw new Error("build commitscape first: cargo build --release");
  return found;
}

/** A fixture repository built by `cargo xtask fixtures`. */
export function fixture(name: string): string {
  const path = join(root, "fixtures", name);
  if (!existsSync(path)) throw new Error(`build the fixtures first: cargo xtask fixtures (${path})`);
  return path;
}

export type Served = { url: string; base: string; stop: () => void };

/** Serves a repository with `commitscape --web`, offline and without a cache. */
export async function serve(repo: string, ...args: string[]): Promise<Served> {
  const child: ChildProcess = spawn(binary(), ["--web", "--offline", "--no-cache", "--port", "0", ...args, repo], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise<string>((ok, fail) => {
    let text = "";
    child.stdout?.on("data", (d) => {
      text += d;
      const m = text.match(/(http:\/\/\S+)\n/);
      if (m?.[1]) ok(m[1]);
    });
    child.on("exit", () => fail(new Error(text)));
  });
  return { url, base: url.replace(/\/\?token=.*/, ""), stop: () => child.kill() };
}

/** Writes `commitscape report` for a repository and returns its path. */
export function report(repo: string, ...args: string[]): string {
  const out = join(mkdtempSync(join(tmpdir(), "commitscape-report-")), "report.html");
  const done = spawnSync(binary(), ["report", "--no-cache", "--offline", "--out", out, ...args, repo], { encoding: "utf8" });
  if (done.status !== 0) throw new Error(done.stderr);
  return out;
}

/** Writes `commitscape wrapped` for a folder and returns the page's path. */
export function wrappedPage(folder: string, ...args: string[]): string {
  const out = mkdtempSync(join(tmpdir(), "commitscape-wrapped-"));
  const done = spawnSync(binary(), ["wrapped", "--no-cache", "--out", out, ...args, folder], { encoding: "utf8" });
  if (done.status !== 0) throw new Error(done.stderr);
  const year = args[args.indexOf("--year") + 1];
  return join(out, `wrapped-${year}.html`);
}
