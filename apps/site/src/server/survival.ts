import "@tanstack/react-start/server-only";
import { desc, inArray } from "drizzle-orm";
import type { BuildFailure, EngineView, ProfileRepo, UnreadRepo } from "@commitscape/data";
import { busy, now, repoId, schema } from "@commitscape/server";
import { engineOf } from "./engine";
import type { Deps, Viewer } from "./repos";

const { builds, repositories } = schema;

type Candidate = Pick<ProfileRepo, "owner" | "name" | "private" | "commits">;

/** A person's Surviving Lines with every repository they committed to accounted for: those the engine counts, and the rest named as not read, being read, failed, or read without them in it. */
export async function survivalOf(deps: Deps, viewer: Viewer & { login: () => Promise<string | null> }, login: string, committed: Candidate[]): Promise<EngineView> {
  const engine = await engineOf(deps, viewer, login);
  const known = new Set(engine.repos.map((r) => `${r.owner}/${r.name}`.toLowerCase()));
  const missing = committed.filter((r) => r.commits > 0 && !known.has(`${r.owner}/${r.name}`.toLowerCase()));
  if (missing.length === 0) return { ...engine, unread: [] };
  const ids = missing.flatMap((r) => repoId(r.owner, r.name) ?? []);
  const [rows, recent] = ids.length
    ? await Promise.all([
        deps.db.select().from(repositories).where(inArray(repositories.id, ids)),
        deps.db.select().from(builds).where(inArray(builds.repoId, ids)).orderBy(desc(builds.requestedAt)),
      ])
    : [[], []];
  const at = now();
  const unread: UnreadRepo[] = missing.map((r) => {
    const id = repoId(r.owner, r.name);
    const row = rows.find((x) => x.id === id);
    const build = recent.find((b) => b.repoId === id);
    const hidden = r.private || !!row?.isPrivate || (!!row && row.status !== "ok");
    const base = { owner: r.owner, name: r.name, private: r.private, commits: r.commits, reason: null };
    if (build && (build.state === "queued" || build.state === "running") && busy(build, at)) return { ...base, state: "reading", canRead: false };
    if (row?.reportKey && !hidden) return { ...base, state: "not_in_it", canRead: false };
    if (build?.state === "failed" && !row?.reportKey) return { ...base, state: "failed", reason: (build.reason as BuildFailure | null) ?? "error", canRead: !hidden && !busy(build, at) };
    return { ...base, state: "not_read", canRead: !hidden };
  });
  return { ...engine, unread: unread.sort((a, b) => b.commits - a.commits) };
}
