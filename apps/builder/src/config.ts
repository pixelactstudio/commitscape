/**
 * The Builder's settings, from its environment (DEPLOY.md lists them).
 * Every limit has a default that suits a small VPS.
 */
export type Config = {
  /** Where it listens for Builds. */
  port: number;
  host: string;
  /** Shared with the Site: signs every request each way. */
  secret: string;
  /** The Site's origin, for its callbacks. */
  site: string;
  /** The commitscape binary. */
  bin: string;
  /** Where clones and caches live. */
  work: string;
  /** Builds at a time. */
  concurrency: number;
  /** Up to this size (MB, as GitHub counts it) a repository is cloned whole, its lines counted; above, partially, without lines. */
  fullUpToMb: number;
  /** A repository bigger than this (MB) is refused. */
  maxMb: number;
  /** A Build is stopped after this long (seconds). */
  timeLimit: number;
  /** When clones pass this (GB), the least recently built are deleted. */
  diskGb: number;
  /** Clones come from here; tests point it at local repositories. */
  gitBase: string | undefined;
};

function number(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, not ${v}`);
  return n;
}

export function config(): Config {
  const secret = process.env.BUILDER_SECRET ?? "";
  if (secret.length < 32) throw new Error("BUILDER_SECRET must be set, 32 characters or more, the same as the Site's");
  const site = process.env.SITE_URL ?? "";
  if (!/^https?:\/\//.test(site)) throw new Error("SITE_URL must be the Site's origin, like https://example.com");
  return {
    port: number("PORT", 8788),
    host: process.env.HOST ?? "127.0.0.1",
    secret,
    site: site.replace(/\/$/, ""),
    bin: process.env.COMMITSCAPE_BIN ?? "commitscape",
    work: process.env.WORK_DIR ?? `${process.env.HOME ?? "."}/builder-work`,
    concurrency: number("CONCURRENCY", 1),
    fullUpToMb: number("FULL_CLONE_UP_TO_MB", 100),
    maxMb: number("MAX_REPOSITORY_MB", 3000),
    timeLimit: number("TIME_LIMIT_SECONDS", 900),
    diskGb: number("DISK_BUDGET_GB", 20),
    gitBase: process.env.GIT_BASE || undefined,
  };
}
