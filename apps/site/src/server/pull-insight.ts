import "@tanstack/react-start/server-only";
import { and, eq, sql } from "drizzle-orm";
import { pullOf, type GitPull, type PullInsight } from "@commitscape/data";
import { gitPullKey, readGitJson, schema } from "@commitscape/server";
import { withPack } from "./answers";
import { gitOf } from "./git";
import { SiteError } from "./http";
import { rowsOf } from "./pulls";
import type { Deps, Viewer } from "./repos";

const { indexCommits, pullRequests } = schema;

const MAINLINE = 8;

/** Sets a pull request against the Stored Index, through the engine service: who holds its files, the files that usually change with them, and the commits that name it. */
export async function pullInsight(deps: Deps, viewer: Viewer, owner: string, name: string, number: number): Promise<PullInsight> {
  if (!Number.isInteger(number) || number < 1) throw new SiteError(400, "That is not a pull request's number.");
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const si = row.indexId;
  const [[pull], pulled] = await Promise.all([
    deps.db.select({ author: pullRequests.author, mergeCommit: pullRequests.mergeCommit }).from(pullRequests).where(and(eq(pullRequests.repoId, row.id), eq(pullRequests.number, number))),
    readGitJson<GitPull>(deps.storage, gitPullKey(git.prefix, number)).catch(() => null),
  ]);
  if (!pull) throw new SiteError(404, "No such pull request.");
  const empty: PullInsight = { number, source: "none", touched: 0, known: 0, together: 0, holders: [], partners: [], landed: [], files: [], filesTotal: 0 };
  if (si === null) return empty;
  const found = rowsOf<{ sha: string; at: number | string; subject: string }>(
    await deps.db.execute(sql`
      select encode(sha, 'hex') as sha, at, subject from ${indexCommits}
      where si = ${si} and (subject like ${`%#${number}%`} or sha = decode(${pull.mergeCommit ?? ""}, 'hex'))
        and ((${indexCommits.flags} & ${MAINLINE}) = ${MAINLINE} or not exists (select 1 from ${indexCommits} m where m.si = ${si} and (m.flags & ${MAINLINE}) <> 0))
      order by at desc limit 40`),
  );
  const named = found.filter((c) => pullOf(c.subject) === number || c.sha === pull.mergeCommit).map((c) => ({ sha: c.sha, at: Number(c.at), subject: c.subject }));
  const own = pulled ? pulled.files.map((f) => f.path) : [];
  const made = await withPack(deps.db, si, (pack) => deps.engine.insight(pack, number, own, pull.author, named), row.reportAt);
  return made?.value ?? empty;
}
