import { GIT_FORMAT, type GitBranch, type GitBranchDetail, type GitBranches, type GitTag } from "@commitscape/data";
import { git, pooled, text, type Git } from "./exec";
import { parseNumstat } from "./pulls";

export type BranchLimits = { branches: number; tags: number; commits: number };

type Ref = { name: string; sha: string; at: number; author: string; login: string | null; subject: string };

const SEP = "\x1f";

const NOREPLY = /^(?:\d+\+)?([A-Za-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com$/i;

/** The account a GitHub noreply address names, else null. */
export const loginOfEmail = (email: string): string | null => NOREPLY.exec(email.trim())?.[1]?.toLowerCase() ?? null;
const AT_ONCE = 8;
const FORMAT = ["%(refname)", "%(objectname)", "%(committerdate:unix)", "%(authorname)", "%(authoremail)", "%(subject)"].join(SEP);

/** The remote's default branch: what `origin/HEAD` points at, else the checked-out branch's name. */
export async function defaultBranch(g: Git): Promise<string> {
  const ref = await text(g, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
  if (ref.trim().startsWith("origin/")) return ref.trim().slice("origin/".length);
  return (await text(g, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim() || "HEAD";
}

async function remoteRefs(g: Git): Promise<Ref[]> {
  const out = await text(g, ["for-each-ref", "--sort=-committerdate", `--format=${FORMAT}`, "refs/remotes/origin"], { maxBytes: 128 * 1024 * 1024 });
  const refs: Ref[] = [];
  for (const line of out.split("\n")) {
    const [ref = "", sha = "", at = "0", author = "", email = "", ...subject] = line.split(SEP);
    const name = ref.slice("refs/remotes/origin/".length);
    if (!sha || !name || name === "HEAD") continue;
    refs.push({ name, sha, at: Number(at) || 0, author, login: loginOfEmail(email.replace(/^<|>$/g, "")), subject: subject.join(SEP) });
  }
  return refs;
}

const VERSION = /(?:^|[-_/@.])v?\d+\.\d+/i;
const VERSIONS_MAX = 5000;

/** Whether a tag's name holds a version, as `v1.2`, `15.0.0` or `grep-0.2.3` do. */
export const isVersionTag = (name: string): boolean => VERSION.test(name);

/** The tags, newest first: every one named like a version (up to a few thousand) and the newest `limit` of the others. */
export function keptTags(all: GitTag[], limit: number): GitTag[] {
  let versions = 0;
  let others = 0;
  return all.filter((t) => (isVersionTag(t.name) ? versions++ < VERSIONS_MAX : others++ < limit));
}

async function tagsOf(g: Git, limit: number): Promise<{ tags: GitTag[]; total: number }> {
  const out = await text(g, ["for-each-ref", "--sort=-creatordate", "--format=%(refname:lstrip=2)%1f%(objectname)%1f%(*objectname)%1f%(creatordate:unix)", "refs/tags"], { maxBytes: 64 * 1024 * 1024 }).catch(() => "");
  const all: GitTag[] = [];
  for (const line of out.split("\n")) {
    const [name = "", sha = "", peeled = "", at = "0"] = line.split(SEP);
    if (name) all.push({ name, sha: peeled || sha, at: Number(at) || 0 });
  }
  return { tags: keptTags(all, limit), total: all.length };
}

async function datesOf(g: Git, shas: string[]): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  if (shas.length === 0) return dates;
  const out = await text(g, ["log", "--no-walk=unsorted", "--stdin", "--format=%H %ct"], { input: `${shas.join("\n")}\n` }).catch(() => "");
  for (const line of out.split("\n")) {
    const [sha = "", at = ""] = line.split(" ");
    if (sha && at) dates.set(sha, Number(at));
  }
  return dates;
}

type Dag = { reach: Uint32Array[] };

async function dagOf(g: Git, tips: string[], default_: string, max: number): Promise<Dag | null> {
  const out = await git(g, ["rev-list", "--parents", "--topo-order", "--stdin"], { input: `${[...new Set(tips)].join("\n")}\n^${default_}\n`, maxBytes: max * 130 });
  if (out.code !== 0 || out.timedOut || out.capped) return null;
  const lines = out.out.toString("latin1").split("\n").filter(Boolean).map((line) => line.split(" "));
  if (lines.length > max) return null;
  const at = new Map<string, number>();
  lines.forEach(([sha = ""], i) => at.set(sha, i));
  const bits = new Map<string, number>();
  for (const tip of tips) if (!bits.has(tip)) bits.set(tip, bits.size);
  const words = Math.ceil(bits.size / 32);
  const mask = new Uint32Array(lines.length * words);
  for (const [tip, bit] of bits) {
    const i = at.get(tip);
    if (i !== undefined) mask[i * words + (bit >> 5)]! |= 1 << (bit & 31);
  }
  for (let i = 0; i < lines.length; i++) {
    for (const parent of (lines[i] as string[]).slice(1)) {
      const j = at.get(parent);
      if (j !== undefined) for (let w = 0; w < words; w++) mask[j * words + w]! |= mask[i * words + w]!;
    }
  }
  const size = Math.ceil(lines.length / 32);
  const columns = Array.from({ length: bits.size }, () => new Uint32Array(size));
  for (let i = 0; i < lines.length; i++) {
    for (let w = 0; w < words; w++) {
      let m = mask[i * words + w] as number;
      while (m !== 0) {
        const low = m & -m;
        (columns[(w << 5) + (31 - Math.clz32(low))] as Uint32Array)[i >> 5]! |= 1 << (i & 31);
        m ^= low;
      }
    }
  }
  return { reach: tips.map((t) => columns[bits.get(t) as number] as Uint32Array) };
}

const popcount = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const sharedBy = (a: Uint32Array, b: Uint32Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += popcount((a[i] as number) & (b[i] as number));
  return n;
};

/** Infers, from the commit graph alone, which branch each unmerged branch came out of; the default branch for the rest. */
export function parentsOf(dag: Dag, tips: Ref[]): { parent: (string | null)[]; shared: number[] } {
  const size = dag.reach.map((r) => r.reduce((n, w) => n + popcount(w), 0));
  const parent: (string | null)[] = tips.map(() => null);
  const shared: number[] = tips.map(() => 0);
  const older = (c: Ref, b: Ref) => c.at < b.at || (c.at === b.at && c.name < b.name);
  for (let b = 0; b < tips.length; b++) {
    const self = tips[b] as Ref;
    let best = -1;
    let bestDistance = Infinity;
    let bestShared = 0;
    for (let c = 0; c < tips.length; c++) {
      if (c === b) continue;
      const other = tips[c] as Ref;
      const both = sharedBy(dag.reach[b] as Uint32Array, dag.reach[c] as Uint32Array);
      const distance = (size[b] as number) - both;
      if (both === 0 || distance === 0) continue;
      if (both !== size[c] && !older(other, self)) continue;
      const better =
        best === -1 ||
        distance < bestDistance ||
        (distance === bestDistance && (both > bestShared || (both === bestShared && !older(other, tips[best] as Ref) && other.name !== (tips[best] as Ref).name)));
      if (better) {
        best = c;
        bestDistance = distance;
        bestShared = both;
      }
    }
    if (best !== -1) {
      parent[b] = (tips[best] as Ref).name;
      shared[b] = bestShared;
    }
  }
  return { parent, shared };
}

async function takenBy(g: Git, head: string, refs: Ref[]): Promise<Set<string>> {
  const taken = new Set<string>();
  if (refs.length === 0) return taken;
  const tree = (await text(g, ["rev-parse", `${head}^{tree}`]).catch(() => "")).trim();
  if (!tree) return taken;
  await pooled(g, refs, AT_ONCE, async (r) => {
    const merged = await git(g, ["merge-tree", "--write-tree", "--no-messages", head, r.sha]).catch(() => null);
    if (merged && merged.code === 0 && merged.out.toString("latin1").split("\n")[0]?.trim() === tree) taken.add(r.sha);
  });
  return taken;
}

/** Reads every branch on the remote, newest tip first and capped, with how far each is ahead of and behind the default branch, and the tags with their dates. */
export async function readBranches(g: Git, limits: BranchLimits, builtAt: number): Promise<GitBranches> {
  const name = await defaultBranch(g);
  const refs = await remoteRefs(g);
  const root = refs.find((r) => r.name === name);
  const head = root?.sha ?? (await text(g, ["rev-parse", "HEAD"])).trim();
  const others = refs.filter((r) => r.name !== name).slice(0, Math.max(0, limits.branches - 1));
  const rows = await pooled(g, others, AT_ONCE, async (r) => {
    const [counts, base] = await Promise.all([
      text(g, ["rev-list", "--left-right", "--count", `${head}...${r.sha}`]).catch(() => ""),
      text(g, ["merge-base", head, r.sha]).catch(() => ""),
    ]);
    const [behind = "0", ahead = "0"] = counts.trim().split(/\s+/);
    return { behind: Number(behind), ahead: Number(ahead), base: base.trim() };
  });
  const dates = await datesOf(g, [...new Set(rows.flatMap((r) => (r?.base ? [r.base] : [])))]);
  const taken = await takenBy(g, head, others.filter((_, i) => (rows[i]?.ahead ?? 0) > 0));
  const open = others.map((r, i) => ({ r, i })).filter(({ r, i }) => (rows[i]?.ahead ?? 0) > 0 && !taken.has(r.sha));
  const dag = open.length > 1 ? await dagOf(g, open.map(({ r }) => r.sha), head, limits.commits).catch(() => null) : null;
  const inferred = dag ? parentsOf(dag, open.map(({ r }) => r)) : null;
  const parentOf = new Map<number, { parent: string | null; shared: number }>();
  open.forEach(({ i }, k) => parentOf.set(i, { parent: inferred?.parent[k] ?? null, shared: inferred?.shared[k] ?? 0 }));
  const branches: GitBranch[] = [];
  if (root) branches.push({ name, sha: root.sha, at: root.at, author: root.author, login: root.login, subject: root.subject, ahead: 0, behind: 0, base: root.sha, baseAt: root.at, merged: false, squashed: false, parent: null, shared: 0 });
  others.forEach((r, i) => {
    const row = rows[i];
    if (!row) return;
    const base = row.base;
    const inference = parentOf.get(i);
    branches.push({
      name: r.name,
      sha: r.sha,
      at: r.at,
      author: r.author,
      login: r.login,
      subject: r.subject,
      ahead: row.ahead,
      behind: row.behind,
      base,
      baseAt: dates.get(base) ?? 0,
      merged: row.ahead === 0 || taken.has(r.sha),
      squashed: row.ahead > 0 && taken.has(r.sha),
      parent: inference?.parent ?? name,
      shared: inference?.shared ?? 0,
    });
  });
  const { tags, total } = await tagsOf(g, limits.tags);
  return {
    v: GIT_FORMAT,
    builtAt,
    default: name,
    head,
    total: refs.length + (root ? 0 : 1),
    inferred: dag !== null || open.length <= 1,
    branches,
    tags,
    tagsTotal: total,
  };
}

const DETAIL_COMMITS = 100;
const DETAIL_FILES = 200;

const changed = (f: { added: number | null; removed: number | null }) => (f.added === null && f.removed === null ? -1 : (f.added ?? 0) + (f.removed ?? 0));

/** A branch's changed files, most lines changed first (binary files, which have no line counts, last), then by path. */
export const byLinesChanged = <T extends { path: string; added: number | null; removed: number | null }>(files: T[]): T[] =>
  [...files].sort((a, b) => changed(b) - changed(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/** Reads, for each branch with unmerged work, its commits and the files it changes against its inferred parent, most lines changed first. */
export async function readBranchDetails(g: Git, found: GitBranches, max: number): Promise<Map<number, GitBranchDetail>> {
  const tip = new Map(found.branches.map((b) => [b.name, b.sha]));
  const open = found.branches.map((b, i) => ({ b, i })).filter(({ b }) => b.name !== found.default && !b.merged).slice(0, max);
  const details = new Map<number, GitBranchDetail>();
  await pooled(g, open, AT_ONCE, async ({ b, i }) => {
    const against = b.parent ?? found.default;
    const from = tip.get(against) ?? found.head;
    const [log, stat] = await Promise.all([
      text(g, ["log", "-n", String(DETAIL_COMMITS), `--format=%H${SEP}%at${SEP}%an${SEP}%s`, `${found.head}..${b.sha}`], { maxBytes: 4 << 20 }).catch(() => ""),
      text(g, ["diff", "--numstat", "-M", "-z", `${from}...${b.sha}`], { maxBytes: 8 << 20 }).catch(() => ""),
    ]);
    const commits = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", at = "0", author = "", ...subject] = line.split(SEP);
        return { sha, at: Number(at) || 0, author, subject: subject.join(SEP) };
      });
    const files = parseNumstat(stat);
    details.set(i, {
      v: GIT_FORMAT,
      name: b.name,
      against,
      commits,
      commitsTotal: b.ahead,
      files: byLinesChanged(files)
        .slice(0, DETAIL_FILES)
        .map((f) => ({ path: f.path, added: f.added, removed: f.removed })),
      filesTotal: files.length,
      added: files.reduce((n, f) => n + (f.added ?? 0), 0),
      removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
    });
  });
  return details;
}
