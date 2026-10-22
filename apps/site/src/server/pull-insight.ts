import "@tanstack/react-start/server-only";
import { and, eq, sql } from "drizzle-orm";
import { pullOf, type GitPull, type PullFileChange, type PullHolder, type PullInsight, type PullLanded, type PullPartner } from "@commitscape/data";
import { authorOf, counts, personOf, personRef, type IndexView } from "@commitscape/data/answers";
import { gitPullKey, readGitJson, schema } from "@commitscape/server";
import { inTurn, viewOf } from "./answers";
import { maintainers } from "./code";
import { gitOf } from "./git";
import { SiteError } from "./http";
import { rowsOf } from "./pulls";
import type { Deps, Viewer } from "./repos";

const { indexCommits, pullRequests } = schema;

const HOLDERS_KEPT = 6;
const PARTNERS_KEPT = 8;
const PARTNER_TOGETHER = 3;
const PARTNER_SHARE = 0.3;
const LANDED_KEPT = 8;
const FILES_KEPT = 300;
const KEPT = 200;
const MAINLINE = 8;

type Found = Pick<PullInsight, "known" | "together" | "holders" | "partners">;

const mainlines = new WeakMap<IndexView, boolean>();

function hasMainline(v: IndexView): boolean {
  let held = mainlines.get(v);
  if (held === undefined) {
    held = v.flags.some((f) => (f & MAINLINE) !== 0);
    mainlines.set(v, held);
  }
  return held;
}

/** Finds who holds a pull request's files and which files at HEAD usually change with them. */
export function insightOf(v: IndexView, paths: readonly string[], author: string | null): Found {
  const ids = new Set<number>();
  for (const p of paths) {
    const f = v.byPath.get(p);
    if (f !== undefined) ids.add(f);
  }
  if (ids.size === 0) return { known: 0, together: 0, holders: [], partners: [] };
  const mainline = hasMainline(v);
  const per = new Int32Array(v.paths.length);
  const withThem = new Map<number, number>();
  const people = new Map<number, { commits: number; last: number }>();
  const perFile = new Map<number, Map<number, number>>();
  let together = 0;
  for (let c = 0; c < v.time.length; c++) {
    if (!counts(v, c) || (mainline && ((v.flags[c] ?? 0) & MAINLINE) === 0)) continue;
    const lo = v.start[c] ?? 0;
    const hi = v.start[c + 1] ?? 0;
    let hit = false;
    for (let i = lo; i < hi; i++) {
      const f = v.file[i] ?? -1;
      if (f >= 0) per[f] = (per[f] ?? 0) + 1;
      if (ids.has(f)) hit = true;
    }
    if (!hit) continue;
    together++;
    const who = personOf(v, c);
    if (who !== null) {
      const p = people.get(who) ?? { commits: 0, last: 0 };
      p.commits++;
      p.last = Math.max(p.last, v.time[c] ?? 0);
      people.set(who, p);
    }
    for (let i = lo; i < hi; i++) {
      const f = v.file[i] ?? -1;
      if (f < 0) continue;
      if (ids.has(f)) {
        if (who === null) continue;
        const m = perFile.get(f) ?? new Map<number, number>();
        m.set(who, (m.get(who) ?? 0) + 1);
        perFile.set(f, m);
      } else withThem.set(f, (withThem.get(f) ?? 0) + 1);
    }
  }
  const lead = maintainers(v);
  const mine = author?.toLowerCase() ?? null;
  const isAuthor = (p: number) => mine !== null && (v.persons.get(p)?.login ?? "").toLowerCase() === mine;
  const held = new Map<number, number>();
  for (const by of perFile.values()) {
    let top: [number, number] | null = null;
    for (const [p, n] of by) if (!isAuthor(p) && (top === null || n > top[1])) top = [p, n];
    if (top) held.set(top[0], (held.get(top[0]) ?? 0) + 1);
  }
  const holders: PullHolder[] = [...people]
    .filter(([p]) => !isAuthor(p))
    .map(([p, x]) => ({ person: personRef(v, p), files: held.get(p) ?? 0, commits: x.commits, last: x.last, maintainer: lead.has(p) }))
    .sort((a, b) => b.files - a.files || b.commits - a.commits || b.last - a.last || a.person.id - b.person.id)
    .slice(0, HOLDERS_KEPT);
  const partners: PullPartner[] = [...withThem]
    .flatMap(([f, n]) => {
      const total = per[f] ?? 0;
      const path = v.paths[f];
      if (!path || !v.headOf.has(f) || (v.lockfile[f] ?? 0) !== 0 || (v.guessedGenerated[f] ?? 0) !== 0 || n < PARTNER_TOGETHER || total === 0 || n / total < PARTNER_SHARE) return [];
      return [{ path, together: n, commits: total }];
    })
    .sort((a, b) => b.together / b.commits - a.together / a.commits || b.together - a.together || (a.path < b.path ? -1 : 1))
    .slice(0, PARTNERS_KEPT);
  return { known: ids.size, together, holders, partners };
}

type Named = { sha: string; at: number; subject: string };

function landedOf(v: IndexView, named: Named[]): { landed: PullLanded[]; files: string[]; changes: PullFileChange[] } {
  const wanted = new Map(named.map((n) => [n.sha, n]));
  const at = new Map<string, number>();
  for (let c = 0; c < v.ids.length && at.size < wanted.size; c++) if (wanted.has(v.ids[c] ?? "")) at.set(v.ids[c] ?? "", c);
  const landed: PullLanded[] = [];
  const files: string[] = [];
  const changes = new Map<string, PullFileChange>();
  for (const n of [...named].sort((a, b) => b.at - a.at).slice(0, LANDED_KEPT)) {
    const c = at.get(n.sha);
    let added = 0;
    let removed = 0;
    let touched = 0;
    if (c !== undefined) {
      for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
        const a = Math.max(0, v.added[i] ?? 0);
        const r = Math.max(0, v.removed[i] ?? 0);
        added += a;
        removed += r;
        touched++;
        const p = v.paths[v.file[i] ?? -1];
        if (p) {
          files.push(p);
          const held = changes.get(p);
          if (held) {
            held.added = v.lines ? (held.added ?? 0) + a : null;
            held.removed = v.lines ? (held.removed ?? 0) + r : null;
          } else changes.set(p, { path: p, added: v.lines ? a : null, removed: v.lines ? r : null, head: v.headOf.has(v.file[i] ?? -1) });
        }
      }
    }
    const who = c === undefined ? null : authorOf(v, c);
    landed.push({ sha: n.sha, at: n.at, subject: n.subject, person: who === null ? null : personRef(v, who), added: v.lines && c !== undefined ? added : null, removed: v.lines && c !== undefined ? removed : null, files: touched });
  }
  return { landed, files, changes: [...changes.values()] };
}

const kept = new Map<string, PullInsight>();

/** Sets a pull request against the Stored Index: who holds its files, the files that usually change with them, and the commits that name it. */
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
  const view = await viewOf(deps.db, si);
  if (!view) return empty;
  const key = `${view.stamp ?? si}:${number}:${pulled ? 1 : 0}:${pull.mergeCommit ?? ""}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const mainline = hasMainline(view) ? sql`and (${indexCommits.flags} & ${MAINLINE}) = ${MAINLINE}` : sql``;
  const found = rowsOf<{ sha: string; at: number | string; subject: string }>(
    await deps.db.execute(sql`
      select encode(sha, 'hex') as sha, at, subject from ${indexCommits}
      where si = ${si} and (subject like ${`%#${number}%`} or sha = decode(${pull.mergeCommit ?? ""}, 'hex')) ${mainline}
      order by at desc limit 40`),
  );
  const named = found.filter((c) => pullOf(c.subject) === number || c.sha === pull.mergeCommit).map((c) => ({ sha: c.sha, at: Number(c.at), subject: c.subject }));
  const { landed, files: landedFiles, changes } = await inTurn(() => landedOf(view, named));
  const own = pulled ? pulled.files.map((f) => f.path) : [];
  const paths = own.length > 0 ? own : [...new Set(landedFiles)];
  const source: PullInsight["source"] = own.length > 0 ? "kept" : paths.length > 0 ? "commit" : "none";
  const told = await inTurn(() => insightOf(view, paths, pull.author));
  const ranked = changes.sort((a, b) => (b.added ?? 0) + (b.removed ?? 0) - ((a.added ?? 0) + (a.removed ?? 0)) || (a.path < b.path ? -1 : 1));
  const made: PullInsight = { number, source, touched: paths.length, ...told, landed, files: ranked.slice(0, FILES_KEPT), filesTotal: ranked.length };
  kept.set(key, made);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  return made;
}
