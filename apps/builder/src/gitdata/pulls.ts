import { GIT_FORMAT, type GitPull, type GitPullCommit, type GitPullFile, type GitPullIndex } from "@commitscape/data";
import { gitPullKey, putGitJson, type Storage } from "@commitscape/server";
import { git, pooled, text, type Git } from "./exec";

export type PullLimits = { open: number; others: number; patchBytes: number; fileBytes: number; commits: number; files: number; totalBytes: number };

export type Wanted = { open: number[]; recent: number[]; bases?: Map<number, string> };

const ROOMY = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/;
const FETCH_AT_ONCE = 40;
const WORK_AT_ONCE = 4;
const SEP = "\x1f";

/** The pull requests the remote has, and the commit each one's head is at: `git ls-remote` costs no GitHub API request. */
export async function remotePulls(g: Git): Promise<Map<number, string>> {
  const out = await text(g, ["ls-remote", "origin", "refs/pull/*/head"], { timeoutMs: 60_000, maxBytes: 64 * 1024 * 1024 });
  const heads = new Map<number, string>();
  for (const line of out.split("\n")) {
    const m = /^([0-9a-f]{40,64})\trefs\/pull\/(\d+)\/head$/.exec(line);
    if (m) heads.set(Number(m[2]), m[1] as string);
  }
  return heads;
}

/** Which pull requests to keep: the open ones, newest first, and the most recently updated others; the remote's newest when nothing says which are open. */
export function choose(heads: Map<number, string>, wanted: Wanted, limits: Pick<PullLimits, "open" | "others">): { open: number[]; others: number[] } {
  const there = (n: number) => heads.has(n);
  const open = [...new Set(wanted.open)].filter(there).sort((a, b) => b - a).slice(0, limits.open);
  const taken = new Set(open);
  let others = wanted.recent.filter((n) => there(n) && !taken.has(n));
  if (wanted.open.length === 0 && wanted.recent.length === 0) others = [...heads.keys()].sort((a, b) => b - a);
  return { open, others: [...new Set(others)].slice(0, limits.others) };
}

async function fetchHeads(g: Git, numbers: number[]): Promise<Set<number>> {
  const got = new Set<number>();
  for (let i = 0; i < numbers.length; i += FETCH_AT_ONCE) {
    const chunk = numbers.slice(i, i + FETCH_AT_ONCE);
    await git(g, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "origin", ...chunk.map((n) => `+refs/pull/${n}/head:refs/pr/${n}`)]);
    if (Date.now() > g.deadline) break;
  }
  const kept = await text(g, ["for-each-ref", "--format=%(refname)", "refs/pr"]).catch(() => "");
  for (const line of kept.split("\n")) {
    const n = Number(line.slice("refs/pr/".length));
    if (Number.isInteger(n) && n > 0) got.add(n);
  }
  return got;
}

async function forget(g: Git, keep: Set<number>): Promise<void> {
  const out = await text(g, ["for-each-ref", "--format=%(refname)", "refs/pr"]).catch(() => "");
  const gone = out.split("\n").filter((r) => r && !keep.has(Number(r.slice("refs/pr/".length))));
  if (gone.length > 0) await git(g, ["update-ref", "--stdin"], { input: `${gone.map((r) => `delete ${r}`).join("\n")}\n` });
}

type Base = { base: string | null; basis: GitPull["basis"] };

/** Where a pull request left the default branch: the merge-base, or for one already merged by a merge commit (whose head the default branch now holds) the merge-base at that merge. */
export async function baseOf(g: Git, head: string, tip: string): Promise<Base> {
  const mb = (await text(g, ["merge-base", tip, head]).catch(() => "")).trim();
  if (mb && mb !== head) return { base: mb, basis: "fork" };
  if (!mb) return { base: null, basis: "none" };
  const merges = (await text(g, ["log", "--ancestry-path", "--merges", "--first-parent", "--reverse", "--format=%H", "-n", "1", `${head}..${tip}`], { maxBytes: 1 << 20, timeoutMs: 20_000 }).catch(() => "")).trim();
  const merge = merges.split("\n")[0];
  if (!merge) return { base: null, basis: "none" };
  const before = (await text(g, ["rev-parse", `${merge}^1`]).catch(() => "")).trim();
  const fork = before ? (await text(g, ["merge-base", before, head]).catch(() => "")).trim() : "";
  return fork && fork !== head ? { base: fork, basis: "merge" } : { base: null, basis: "none" };
}

export type Stat = { path: string; old: string | null; added: number | null; removed: number | null; binary: boolean };

export function parseNumstat(out: string): Stat[] {
  const tokens = out.split("\0");
  const stats: Stat[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const head = tokens[i] ?? "";
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(head);
    if (!m) continue;
    const binary = m[1] === "-";
    const added = binary ? null : Number(m[1]);
    const removed = binary ? null : Number(m[2]);
    if (m[3] === "") {
      stats.push({ old: tokens[i + 1] ?? "", path: tokens[i + 2] ?? "", added, removed, binary });
      i += 2;
    } else stats.push({ old: null, path: m[3] as string, added, removed, binary });
  }
  return stats;
}

function parseStatus(out: string): Map<string, string> {
  const tokens = out.split("\0");
  const status = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const s = tokens[i] ?? "";
    if (!/^[A-Z]\d*$/.test(s)) continue;
    if (s.startsWith("R") || s.startsWith("C")) {
      status.set(tokens[i + 2] ?? "", s[0] as string);
      i += 2;
    } else {
      status.set(tokens[i + 1] ?? "", s[0] as string);
      i += 1;
    }
  }
  return status;
}

/** A unified diff cut into the part for each file, by the path it ends at. */
export function splitPatch(diff: string): Map<string, string> {
  const parts = new Map<string, string>();
  const starts: number[] = [];
  for (const m of diff.matchAll(/^diff --git /gm)) starts.push(m.index);
  starts.forEach((from, k) => {
    const part = diff.slice(from, starts[k + 1] ?? diff.length);
    const eol = part.indexOf("\n");
    const header = part.slice("diff --git ".length, eol === -1 ? undefined : eol);
    const length = (header.length - 5) / 2;
    const same = Number.isInteger(length) && header.startsWith("a/") && header.slice(2, 2 + length) === header.slice(5 + length) ? header.slice(5 + length) : null;
    const path = /^rename to (.+)$/m.exec(part)?.[1] ?? same ?? /^\+\+\+ b\/(.+)$/m.exec(part)?.[1] ?? /^--- a\/(.+)$/m.exec(part)?.[1];
    if (path) parts.set(path, part);
  });
  return parts;
}

/** One pull request's commits, changed files and a size-capped diff, from its fetched head, measured against `tip`, the head of the branch `onto` it goes into. */
export async function pullOf(g: Git, number: number, head: string, tip: string, limits: PullLimits, onto?: string): Promise<GitPull> {
  const { base, basis } = await baseOf(g, head, tip);
  const range = base ? `${base}..${head}` : head;
  const log = await text(g, ["log", "-n", String(limits.commits + 1), `--format=%H${SEP}%at${SEP}%an${SEP}%s`, ...(base ? [range] : ["-n", "1", head])], { maxBytes: 8 << 20 }).catch(() => "");
  const lines = log.split("\n").filter(Boolean).map((l): GitPullCommit => {
    const [sha = "", at = "0", author = "", ...subject] = l.split(SEP);
    return { sha, at: Number(at) || 0, author, subject: subject.join(SEP) };
  });
  const counted = base ? (await text(g, ["rev-list", "--count", range]).catch(() => String(lines.length))).trim() : "1";
  const files: GitPullFile[] = [];
  let filesTotal = 0;
  let added = 0;
  let removed = 0;
  if (base) {
    const [numstat, names, diff] = await Promise.all([
      text(g, ["diff", "--numstat", "-M", "-z", base, head], { maxBytes: 16 << 20 }).catch(() => ""),
      text(g, ["diff", "--name-status", "-M", "-z", base, head], { maxBytes: 16 << 20 }).catch(() => ""),
      git(g, ["diff", "-M", "--no-color", "--unified=3", base, head], { maxBytes: limits.patchBytes * 3 }),
    ]);
    const stats = parseNumstat(numstat);
    const status = parseStatus(names);
    const patches = splitPatch(diff.out.toString("utf8"));
    if (diff.capped || diff.timedOut || diff.code !== 0) patches.delete([...patches.keys()].at(-1) ?? "");
    let used = 0;
    filesTotal = stats.length;
    for (const s of stats) {
      added += s.added ?? 0;
      removed += s.removed ?? 0;
      if (files.length >= limits.files) continue;
      let patch: string | null = null;
      let omitted: GitPullFile["omitted"] = null;
      if (!s.binary) {
        const part = patches.get(s.path);
        if (ROOMY.test(s.path) || (part && part.length > limits.fileBytes)) omitted = "large";
        else if (part === undefined || used + part.length > limits.patchBytes) omitted = "cap";
        else {
          patch = part;
          used += part.length;
        }
      }
      files.push({ path: s.path, old: s.old, status: status.get(s.path) ?? "M", added: s.added, removed: s.removed, binary: s.binary, patch, omitted });
    }
  }
  return {
    v: GIT_FORMAT,
    number,
    head,
    base,
    basis,
    ...(onto ? { onto } : {}),
    commits: lines.slice(0, limits.commits),
    commitsTotal: Number(counted) || lines.length,
    files,
    filesTotal,
    added,
    removed,
  };
}

export type PullsDone = { index: GitPullIndex; stored: number; fetched: number; bytes: number; deleted: number[]; remote: number };

/** Keeps the commits, files and diff of the open and most recently updated pull requests, read from the clone with no GitHub API request. */
export async function readPulls(
  g: Git,
  deps: { storage: Storage; prefix: string; previous: GitPullIndex | null; wanted: Wanted; limits: PullLimits; tip: string; branch?: string; builtAt: number },
): Promise<PullsDone> {
  const { storage, prefix, previous, limits } = deps;
  const tips = new Map<string, Promise<string | null>>();
  const ontoOf = async (n: number): Promise<{ onto: string | undefined; tip: string }> => {
    const name = deps.wanted.bases?.get(n);
    if (!name || name === deps.branch) return { onto: deps.branch, tip: deps.tip };
    let found = tips.get(name);
    if (!found) {
      found = text(g, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}^{commit}`]).then((t) => t.trim() || null, () => null);
      tips.set(name, found);
    }
    const tip = await found;
    return tip ? { onto: name, tip } : { onto: deps.branch, tip: deps.tip };
  };
  const heads = await remotePulls(g);
  const { open, others } = choose(heads, deps.wanted, limits);
  const order = [...open, ...others];
  const keep = new Set(order);
  const pulls: GitPullIndex["pulls"] = {};
  const todo: number[] = [];
  const ontos = new Map<number, { onto: string | undefined; tip: string }>();
  for (const n of order) ontos.set(n, await ontoOf(n));
  for (const n of order) {
    const head = heads.get(n) as string;
    const was = previous?.pulls[String(n)];
    if (was?.head === head && was.stored && (was.onto ?? deps.branch) === ontos.get(n)?.onto) pulls[String(n)] = was;
    else todo.push(n);
  }
  await forget(g, keep);
  const have = todo.length > 0 ? await fetchHeads(g, todo) : new Set<number>();
  let bytes = 0;
  let stored = 0;
  await pooled(g, todo.filter((n) => have.has(n)), WORK_AT_ONCE, async (n) => {
    if (bytes > limits.totalBytes) return;
    const head = heads.get(n) as string;
    const { onto, tip } = ontos.get(n) ?? { onto: deps.branch, tip: deps.tip };
    const pull = await pullOf(g, n, head, tip, limits, onto).catch(() => null);
    if (!pull) return;
    const size = await putGitJson(storage, gitPullKey(prefix, n), pull);
    bytes += size;
    pulls[String(n)] = { head, stored: true, bytes: size, ...(onto ? { onto } : {}) };
    stored++;
  });
  const deleted = Object.keys(previous?.pulls ?? {}).map(Number).filter((n) => !keep.has(n) || !pulls[String(n)]);
  const kept = Object.values(pulls).reduce((n, p) => n + p.bytes, 0);
  return { index: { v: GIT_FORMAT, builtAt: deps.builtAt, pulls }, stored: Object.keys(pulls).length, fetched: stored, bytes: kept, deleted, remote: heads.size };
}
