import { and, desc, eq, ne } from "drizzle-orm";
import type { GitBranches, GitPullIndex } from "@commitscape/data";
import { branchPeople, gitBlobKey, headChurn, gitFileKey, gitPrefix, now, putGitJson, readBlobs, readGitJson, schema, withPeople, writeBlobs, writeBranches, type BranchPerson, type Db, type Storage } from "@commitscape/server";
import type { GitSettings } from "../config";
import { readBranchDetails, readBranches } from "./branches";
import { text, type Git } from "./exec";
import { readFiles } from "./files";
import { readPulls, type Wanted } from "./pulls";

const { pullRequests, repoGit } = schema;

export type GitStep = { name: "branches" | "files" | "pulls"; ok: boolean; seconds: number; bytes: number; detail?: string };

export type GitContext = {
  db: Db;
  storage: Storage;
  cfg: GitSettings;
  repoId: string;
  buildId: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  private?: boolean;
};

const SHARES = { branches: 0.2, files: 0.8 };

async function wantedPulls(db: Db, repoId: string, limit: number): Promise<Wanted> {
  const open = await db.select({ n: pullRequests.number, base: pullRequests.baseRef }).from(pullRequests).where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "OPEN")));
  const recent = await db
    .select({ n: pullRequests.number, base: pullRequests.baseRef })
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repoId), ne(pullRequests.state, "OPEN")))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(limit * 2);
  const bases = new Map([...open, ...recent].flatMap((r) => (r.base ? [[r.n, r.base] as [number, string]] : [])));
  return { open: open.map((r) => r.n), recent: recent.map((r) => r.n), bases };
}

/** Writes what git alone can tell about a repository beside its Report, with no GitHub API request; a step that fails or runs out of time leaves what the earlier Build stored. */
export async function buildGitData(ctx: GitContext): Promise<{ steps: GitStep[]; seconds: number }> {
  const { db, storage, cfg } = ctx;
  const started = Date.now();
  const end = started + cfg.seconds * 1000;
  const [previous] = await db.select().from(repoGit).where(eq(repoGit.repoId, ctx.repoId));
  const prefix = previous?.prefix ?? gitPrefix(ctx.repoId);
  const builtAt = now();
  const steps: GitStep[] = [];
  const g = (share: number): Git => ({ dir: ctx.dir, env: ctx.env, deadline: Math.min(end, Date.now() + (end - Date.now()) * share) });
  const before = (JSON.parse(previous?.steps ?? "[]") as GitStep[]).reduce<Record<string, number>>((m, s) => ({ ...m, [s.name]: s.bytes }), {});
  const stepped = async <T>(name: GitStep["name"], run: (kept: (n: number) => void) => Promise<T>): Promise<T | null> => {
    const t = Date.now();
    let bytes = before[name] ?? 0;
    try {
      const done = await run((n) => {
        bytes = n;
      });
      steps.push({ name, ok: true, seconds: Math.round((Date.now() - t) / 100) / 10, bytes });
      return done;
    } catch (e) {
      steps.push({ name, ok: false, seconds: Math.round((Date.now() - t) / 100) / 10, bytes, detail: (e as Error).message.slice(0, 200) });
      ctx.log(`git data ${ctx.repoId} ${name}: ${(e as Error).message}`);
      return null;
    }
  };
  const set: Partial<typeof repoGit.$inferInsert> = {};

  const branches = await stepped("branches", async (kept) => {
    const within = g(SHARES.branches);
    const read = await readBranches(within, { branches: cfg.branches, tags: cfg.tags, commits: cfg.branchCommits }, builtAt);
    const people = await branchPeople(db, ctx.repoId).catch(() => new Map<string, BranchPerson>());
    const found = { ...read, branches: withPeople(read.branches, people) };
    const details = await readBranchDetails(within, found, cfg.branchDetails).catch(() => new Map());
    await writeBranches(db, ctx.repoId, found, details);
    await storage.deletePrefix(`${prefix}/branches/`);
    await storage.delete([gitFileKey(prefix, "branches")]);
    kept(0);
    set.branches = found.branches.length;
    set.tags = found.tags.length;
    set.branch = found.default;
    set.branchesTotal = found.total;
    set.tagsTotal = found.tagsTotal;
    set.inferred = found.inferred;
    return found;
  });

  const head = branches?.head ?? (await text(g(1), ["rev-parse", "HEAD"]).then((t) => t.trim()).catch(() => ""));
  const branch = branches?.default ?? previous?.branch ?? "HEAD";

  await stepped("files", async (kept) => {
    if (!head) throw new Error("no HEAD");
    const known = await readBlobs(db, ctx.repoId);
    const warm = ctx.private ? cfg.warmFiles : 0;
    const value = warm > 0 ? await headChurn(db, ctx.repoId).catch(() => new Map<string, number>()) : new Map<string, number>();
    const done = await readFiles(g(SHARES.files), { storage, prefix, known, limits: { fileBytes: cfg.fileBytes, repoBytes: cfg.repoBytes, warm }, head, value });
    await writeBlobs(db, ctx.repoId, done.blobs);
    const gone = [...done.dropped, ...done.orphans];
    if (gone.length > 0) await storage.delete(gone.map((sha) => gitBlobKey(prefix, sha)));
    await storage.delete(["tree", "coupling", "history"].map((f) => gitFileKey(prefix, f as "tree")));
    kept(done.bytes);
    set.files = done.files;
    set.stored = done.stored;
    set.complete = done.complete;
    if (done.failed > 0 || !done.complete || gone.length > 0) ctx.log(`git data ${ctx.repoId} files: ${done.stored} of ${done.eligible} kept ahead, ${done.uploaded} uploaded, ${done.failed} failed, ${gone.length} no longer at HEAD deleted`);
  });
  await stepped("pulls", async (kept) => {
    if (!head) throw new Error("no HEAD");
    const old = await readGitJson<GitPullIndex>(storage, gitFileKey(prefix, "pulls")).catch(() => null);
    const done = await readPulls(g(1), {
      storage,
      prefix,
      previous: old,
      wanted: await wantedPulls(db, ctx.repoId, cfg.pullsOthers),
      limits: { open: cfg.pullsOpen, others: cfg.pullsOthers, patchBytes: cfg.patchBytes, fileBytes: cfg.pullFileBytes, commits: cfg.pullCommits, files: cfg.pullFiles, totalBytes: cfg.pullsBytes },
      tip: head,
      branch,
      builtAt,
    });
    kept(done.bytes + (await putGitJson(storage, gitFileKey(prefix, "pulls"), done.index)));
    if (done.deleted.length > 0) await storage.delete(done.deleted.map((n) => `${prefix}/pulls/${n}.json`));
    set.pulls = done.stored;
  });

  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const bytes = steps.reduce((n, s) => n + s.bytes, 0);
  const row = {
    repoId: ctx.repoId,
    prefix,
    buildId: ctx.buildId,
    builtAt,
    head: head || previous?.head || "",
    branch,
    branches: previous?.branches ?? 0,
    tags: previous?.tags ?? 0,
    files: previous?.files ?? 0,
    stored: previous?.stored ?? 0,
    pulls: previous?.pulls ?? 0,
    logged: previous?.logged ?? 0,
    complete: previous?.complete ?? false,
    ...set,
    bytes,
    seconds,
    steps: JSON.stringify(steps),
  };
  if (steps.some((s) => s.ok)) {
    await db.insert(repoGit).values(row).onConflictDoUpdate({ target: repoGit.repoId, set: row });
  }
  ctx.log(`git data ${ctx.repoId}: ${steps.map((s) => `${s.name} ${s.ok ? "" : "failed "}${s.seconds} s`).join(", ")}, ${bytes} bytes`);
  return { steps, seconds };
}

export type { GitBranches };
