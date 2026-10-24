import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Git } from "./exec";

const DAY = 86_400;
const START = 1_700_000_000;

export type Repo = {
  origin: string;
  clone: string;
  git: Git;
  sh: (dir: string, ...args: string[]) => string;
  commit: (files: Record<string, string | null>, message: string, who?: string, day?: number) => string;
  at: (day: number) => number;
  sync: () => void;
};

const person = (name: string) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com`, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@example.com` });

export function repo(): Repo {
  const root = mkdtempSync(join(tmpdir(), "gitdata-"));
  const origin = join(root, "origin");
  const clone = join(root, "clone");
  mkdirSync(origin);
  const sh = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "protocol.file.allow=always", ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...person("Ada") } });
  sh(origin, "init", "-q", "-b", "main");
  const commit = (files: Record<string, string | null>, message: string, who = "Ada", day = 0) => {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) sh(origin, "rm", "-q", "-f", path);
      else {
        mkdirSync(dirname(join(origin, path)), { recursive: true });
        writeFileSync(join(origin, path), content);
        sh(origin, "add", "--", path);
      }
    }
    const date = `${START + day * DAY} +0000`;
    execFileSync("git", ["-C", origin, "commit", "-q", "--allow-empty", "-m", message], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...person(who), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return sh(origin, "rev-parse", "HEAD").trim();
  };
  const git: Git = { dir: clone, env: {}, deadline: Date.now() + 60_000 };
  const sync = () => {
    if (!execFileSync("ls", [root]).toString().includes("clone")) execFileSync("git", ["clone", "-q", origin, clone], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
    else sh(clone, "fetch", "-q", "--prune", "--tags", "origin");
    sh(clone, "remote", "set-head", "origin", "-a");
    sh(clone, "reset", "-q", "--hard", "origin/HEAD");
    git.deadline = Date.now() + 60_000;
  };
  return { origin, clone, git, sh, commit, at: (day) => START + day * DAY, sync };
}
