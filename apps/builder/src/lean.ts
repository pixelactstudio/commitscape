import { StringDecoder } from "node:string_decoder";
import { git, type Git } from "./gitdata/exec";

const ZERO = /^0+$/;
const FETCHED_AT_ONCE = 20_000;
const PATHS_AT_ONCE = 500;

const blobOf = (mode: string, oid: string) => (mode !== "160000" && mode !== "000000" && !ZERO.test(oid) ? oid : null);

async function eachLine(g: Git, args: string[], onLine: (line: string) => void, opts: { input?: string; separator?: string } = {}): Promise<void> {
  const separator = opts.separator ?? "\n";
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const take = (text: string) => {
    const parts = (rest + text).split(separator);
    rest = parts.pop() ?? "";
    for (const part of parts) if (part) onLine(part);
  };
  const ran = await git(g, args, { ...(opts.input === undefined ? {} : { input: opts.input }), onData: (d) => take(decoder.write(d)) });
  take(decoder.end());
  if (rest) onLine(rest);
  if (ran.code !== 0 || ran.timedOut) throw new Error(`git ${args[0]} failed${ran.timedOut ? ": out of time" : `: ${ran.err.trim().split("\n").at(-1) ?? ""}`}`);
}

async function lines(g: Git, args: string[], input?: string): Promise<string[]> {
  const out: string[] = [];
  await eachLine(g, args, (l) => out.push(l), input === undefined ? {} : { input });
  return out;
}

/** Which of `oids` the clone does not hold, asked without fetching any. */
export async function missingBlobs(g: Git, oids: string[]): Promise<string[]> {
  if (oids.length === 0) return [];
  const missing: string[] = [];
  await eachLine({ ...g, env: { ...g.env, GIT_NO_LAZY_FETCH: "1" } }, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], (l) => l.endsWith(" missing") && missing.push(l.slice(0, -" missing".length)), { input: `${oids.join("\n")}\n` });
  return missing;
}

/** The file versions a Build of a blobless clone reads that it does not hold: every file at HEAD, which the head pass reads, and both sides of each file the commits since `frontier` changed, which the line pass reads, leaving out commits that change more than twice `bulkFiles` paths. Those are Bulk Commits, never counted: without renames paired, a commit of `bulkFiles` changes shows at most twice as many paths. */
export async function neededBlobs(g: Git, frontier: string[], bulkFiles: number): Promise<string[]> {
  const bulk = 2 * bulkFiles;
  const wanted = new Set<string>();
  await eachLine(g, ["ls-tree", "-r", "--full-tree", "HEAD"], (l) => {
    const [mode = "", , oid = ""] = l.split("\t")[0]?.split(" ") ?? [];
    const blob = blobOf(mode, oid);
    if (blob) wanted.add(blob);
  });
  const commits = await lines(g, ["rev-list", "--no-merges", "--all", "--stdin"], frontier.map((f) => `^${f}\n`).join(""));
  let current: string[] = [];
  const settle = () => {
    if (current.length <= bulk) for (const b of current) wanted.add(b);
    current = [];
  };
  if (commits.length > 0) {
    await eachLine(
      g,
      ["diff-tree", "--stdin", "-r", "--no-renames", "--raw", "--no-abbrev"],
      (l) => {
        if (!l.startsWith(":")) {
          settle();
          return;
        }
        const [oldMode = "", newMode = "", oldOid = "", newOid = ""] = l.slice(1).split("\t")[0]?.split(" ") ?? [];
        for (const b of [blobOf(oldMode, oldOid), blobOf(newMode, newOid)]) if (b) current.push(b);
      },
      { input: `${commits.join("\n")}\n` },
    );
    settle();
  }
  return missingBlobs(g, [...wanted]);
}

/** Every version the history holds of the paths HEAD changed since `since`, which blame reads when it walks those files back, that the clone does not hold. */
export async function historyBlobs(g: Git, since: string): Promise<string[]> {
  const paths: string[] = [];
  await eachLine(g, ["diff", "--name-only", "--no-renames", "-z", since, "HEAD"], (p) => paths.push(p), { separator: "\0" });
  const wanted = new Set<string>();
  for (let i = 0; i < paths.length; i += PATHS_AT_ONCE) {
    await eachLine(g, ["log", "--all", "--format=", "--raw", "--no-renames", "--no-abbrev", "--", ...paths.slice(i, i + PATHS_AT_ONCE)], (l) => {
      if (!l.startsWith(":")) return;
      const [oldMode = "", newMode = "", oldOid = "", newOid = ""] = l.slice(1).split("\t")[0]?.split(" ") ?? [];
      for (const b of [blobOf(oldMode, oldOid), blobOf(newMode, newOid)]) if (b) wanted.add(b);
    });
  }
  return missingBlobs(g, [...wanted]);
}

/** Fetches the given file versions from the clone's remote by their ids, many to a request, each request tried twice. */
export async function fetchBlobs(g: Git, oids: string[]): Promise<void> {
  for (let i = 0; i < oids.length; i += FETCHED_AT_ONCE) {
    const chunk = oids.slice(i, i + FETCHED_AT_ONCE);
    const fetch = () => lines(g, ["-c", "fetch.negotiationAlgorithm=noop", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--filter=blob:none", "--stdin", "origin"], `${chunk.join("\n")}\n`);
    await fetch().catch(fetch);
  }
}

/** Fetches into a blobless clone the file versions its Build reads that it lacks, and says how many. */
export async function prefetch(dir: string, env: NodeJS.ProcessEnv, frontier: string[], timeoutMs: number, bulkFiles: number): Promise<number> {
  const g = { dir, env, deadline: Date.now() + timeoutMs };
  const needed = await neededBlobs(g, frontier, bulkFiles);
  await fetchBlobs(g, needed);
  return needed.length;
}
