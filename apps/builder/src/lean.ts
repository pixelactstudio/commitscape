import { git, type Git } from "./gitdata/exec";

const ZERO = /^0+$/;
const FETCHED_AT_ONCE = 20_000;
const PATHS_AT_ONCE = 500;
const MAX_OUT = 512 << 20;

const blobOf = (mode: string, oid: string) => (mode !== "160000" && mode !== "000000" && !ZERO.test(oid) ? oid : null);

async function lines(g: Git, args: string[], input?: string): Promise<string[]> {
  const ran = await git(g, args, { maxBytes: MAX_OUT, ...(input === undefined ? {} : { input }) });
  if (ran.code !== 0 || ran.capped) throw new Error(`git ${args[0]} failed${ran.timedOut ? ": out of time" : ran.capped ? ": too much output" : `: ${ran.err.trim().split("\n").at(-1) ?? ""}`}`);
  return ran.out.toString("utf8").split("\n").filter(Boolean);
}

/** Which of `oids` the clone does not hold, asked without fetching any. */
export async function missingBlobs(g: Git, oids: string[]): Promise<string[]> {
  if (oids.length === 0) return [];
  const out = await lines({ ...g, env: { ...g.env, GIT_NO_LAZY_FETCH: "1" } }, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${oids.join("\n")}\n`);
  return out.flatMap((l) => (l.endsWith(" missing") ? [l.slice(0, -" missing".length)] : []));
}

/** The file versions a Build of a blobless clone reads that it does not hold: every file at HEAD, which the head pass reads, and both sides of each file the commits since `frontier` changed, which the line pass reads, leaving out commits that change more than twice `bulkFiles` paths. Those are Bulk Commits, never counted: without renames paired, a commit of `bulkFiles` changes shows at most twice as many paths. */
export async function neededBlobs(g: Git, frontier: string[], bulkFiles: number): Promise<string[]> {
  const bulk = 2 * bulkFiles;
  const wanted = new Set<string>();
  for (const l of await lines(g, ["ls-tree", "-r", "--full-tree", "HEAD"])) {
    const [mode = "", , oid = ""] = l.split("\t")[0]?.split(" ") ?? [];
    const blob = blobOf(mode, oid);
    if (blob) wanted.add(blob);
  }
  const commits = await lines(g, ["rev-list", "--no-merges", "--all", "--stdin"], frontier.map((f) => `^${f}\n`).join(""));
  let current: string[] = [];
  const settle = () => {
    if (current.length <= bulk) for (const b of current) wanted.add(b);
    current = [];
  };
  if (commits.length > 0) {
    for (const l of await lines(g, ["diff-tree", "--stdin", "-r", "--no-renames", "--raw", "--no-abbrev"], `${commits.join("\n")}\n`)) {
      if (!l.startsWith(":")) {
        settle();
        continue;
      }
      const [oldMode = "", newMode = "", oldOid = "", newOid = ""] = l.slice(1).split("\t")[0]?.split(" ") ?? [];
      for (const b of [blobOf(oldMode, oldOid), blobOf(newMode, newOid)]) if (b) current.push(b);
    }
    settle();
  }
  return missingBlobs(g, [...wanted]);
}

/** Every version the history holds of the paths HEAD changed since `since`, which blame reads when it walks those files back, that the clone does not hold. */
export async function historyBlobs(g: Git, since: string): Promise<string[]> {
  const paths = await lines(g, ["diff", "--name-only", "--no-renames", "-z", since, "HEAD"]).then((l) => l.join("\n").split("\0").filter(Boolean));
  const wanted = new Set<string>();
  for (let i = 0; i < paths.length; i += PATHS_AT_ONCE) {
    for (const l of await lines(g, ["log", "--all", "--format=", "--raw", "--no-renames", "--no-abbrev", "--", ...paths.slice(i, i + PATHS_AT_ONCE)])) {
      if (!l.startsWith(":")) continue;
      const [oldMode = "", newMode = "", oldOid = "", newOid = ""] = l.slice(1).split("\t")[0]?.split(" ") ?? [];
      for (const b of [blobOf(oldMode, oldOid), blobOf(newMode, newOid)]) if (b) wanted.add(b);
    }
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
