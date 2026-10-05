import { eq, inArray, or } from "drizzle-orm";
import type { Db } from "./db/client";
import { builds, pullRequests, pullReviews, repoNames, repoPeople, repositories, surviving } from "./db/schema";
import { repoId } from "./names";
import type { Storage } from "./storage";
import { now } from "./time";

export type RepoRow = typeof repositories.$inferSelect;

/** Deletes repositories' stored Reports and cards, and their rows. */
export async function removeReports(db: Db, storage: Storage, rows: RepoRow[]): Promise<void> {
  for (const r of rows) {
    if (r.reportKey) await storage.deletePrefix(`${r.reportKey}/`);
    await storage.deletePrefix(`cards/gh/${r.id}/`);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    if (ids.length > 0) await db.delete(repositories).where(inArray(repositories.id, ids));
  }
}

/** The row a name leads to: its own, or the row of the repository that was once called so. */
export async function repoNamed(db: Db, id: string): Promise<(RepoRow & { movedAt?: number }) | undefined> {
  const [row] = await db.select().from(repositories).where(eq(repositories.id, id));
  if (row) return row;
  const [moved] = await db
    .select({ repo: repositories, at: repoNames.at })
    .from(repoNames)
    .innerJoin(repositories, eq(repositories.id, repoNames.repoId))
    .where(eq(repoNames.id, id));
  return moved ? { ...moved.repo, movedAt: moved.at } : undefined;
}

export type Settle = {
  githubId: number;
  owner: string;
  name: string;
  asked?: string;
  set?: Partial<Omit<RepoRow, "id" | "owner" | "name" | "githubId">>;
};

const FACTS = ["status", "isPrivate", "facts", "factsAt", "sizeKb"] as const;
const PULLS = ["pullsAt", "pullsReadAt"] as const;

const newest = <T>(rows: T[], at: (r: T) => number | null) => rows.filter((r) => at(r) !== null).sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0))[0];
const pick = <T extends object, K extends keyof T>(row: T | undefined, keys: readonly K[]) => (row ? Object.fromEntries(keys.map((k) => [k, row[k]])) : {}) as Partial<Pick<T, K>>;

/** Keeps one row for a GitHub repository, under its current name: rows of it under earlier names hand over their newest Report, Builds, people and pull requests and stay only as names that lead to it, and a row at either name that held another repository is cleared. */
export async function settleRepository(db: Db, storage: Storage | null, s: Settle): Promise<RepoRow> {
  const id = repoId(s.owner, s.name);
  if (!id) throw new Error(`not a repository's name: ${s.owner}/${s.name}`);
  const asked = s.asked ?? id;
  const gone: string[] = [];
  const row = await db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(repositories)
      .where(or(eq(repositories.githubId, s.githubId), inArray(repositories.id, [id, asked])));
    const others = found.filter((r) => r.githubId !== null && r.githubId !== s.githubId);
    const members = found.filter((r) => !others.includes(r));
    for (const r of others) {
      if (r.reportKey) gone.push(`${r.reportKey}/`);
      gone.push(`cards/gh/${r.id}/`);
    }
    if (others.length > 0) await tx.delete(repositories).where(inArray(repositories.id, others.map((r) => r.id)));

    const holder = newest(members, (r) => (r.reportKey ? (r.reportAt ?? 0) : null));
    const puller = newest(members, (r) => r.pullsReadAt);
    const informed = newest(members, (r) => r.factsAt);
    const current = members.find((r) => r.id === id);
    const base = holder ?? current ?? members[0];
    const { id: _, ...kept } = base ?? ({} as Partial<RepoRow>);
    const values = {
      ...kept,
      ...pick(informed, FACTS),
      ...pick(puller ?? current, PULLS),
      seed: members.some((r) => r.seed),
      installationId: base?.installationId ?? members.find((r) => r.installationId)?.installationId ?? null,
      connectedBy: base?.connectedBy ?? members.find((r) => r.connectedBy)?.connectedBy ?? null,
      viewedAt: newest(members, (r) => r.viewedAt)?.viewedAt ?? null,
      owner: s.owner,
      name: s.name,
      githubId: s.githubId,
      ...s.set,
    };
    const [saved] = current
      ? await tx.update(repositories).set(values).where(eq(repositories.id, id)).returning()
      : await tx
          .insert(repositories)
          .values({ ...values, id })
          .returning();
    const earlier = members.map((r) => r.id).filter((r) => r !== id);
    const move = async (from: RepoRow | undefined, tables: (typeof repoPeople | typeof surviving | typeof pullRequests | typeof pullReviews)[]) => {
      const dropped = members.map((r) => r.id).filter((r) => r !== from?.id);
      for (const t of tables) {
        if (dropped.length > 0) await tx.delete(t).where(inArray(t.repoId, dropped));
        if (from && from.id !== id) await tx.update(t).set({ repoId: id }).where(eq(t.repoId, from.id));
      }
    };
    if (earlier.length > 0) {
      await move(holder ?? current, [repoPeople, surviving]);
      await move(puller ?? current, [pullRequests, pullReviews]);
      await tx.update(builds).set({ repoId: id }).where(inArray(builds.repoId, earlier));
      await tx.update(repoNames).set({ repoId: id }).where(inArray(repoNames.repoId, earlier));
      await tx.delete(repositories).where(inArray(repositories.id, earlier));
    }
    for (const r of members) if (r.reportKey && r.reportKey !== holder?.reportKey) gone.push(`${r.reportKey}/`);
    for (const r of earlier) gone.push(`cards/gh/${r}/`);
    const names = [...new Set([...earlier, ...(asked !== id ? [asked] : [])])];
    for (const n of names) {
      await tx
        .insert(repoNames)
        .values({ id: n, repoId: id, at: now() })
        .onConflictDoUpdate({ target: repoNames.id, set: { repoId: id, at: now() } });
    }
    await tx.delete(repoNames).where(eq(repoNames.id, id));
    if (!saved) throw new Error(`repository ${id} not saved`);
    return saved;
  });
  if (storage) for (const prefix of gone) await storage.deletePrefix(prefix).catch(() => {});
  return row;
}
