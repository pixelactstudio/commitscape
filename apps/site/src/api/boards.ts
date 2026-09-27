/**
 * Leaderboards (IDEA.md). The Builder sends the seed list it read from
 * GitHub's search (`POST /api/seeds`, signed) and gets back that night's
 * Builds, within its budget: the seeds with no Report or the oldest ones.
 * Once a day the boards are written from D1 into one document in R2,
 * which `GET /api/leaderboards` serves as it is.
 */
import { and, asc, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SIGNATURE, verify, type Board, type BoardRow, type Boards, type BuildRequest } from "@commitscape/data";
import { repositories } from "../db/schema";
import { json, now, says, sha256 } from "./http";
import { busy } from "./lookup";
import { randomId } from "./random";
import { repoId } from "./reports";

const KEY = "boards/leaderboards.json";
/** Rows on each board. */
const ROWS = 25;
/** The boards are written again when they are a day old. */
const BOARDS_FOR = 24 * 3600;

type Seed = { owner: string; name: string; language: string; stars: number; sizeKb: number };

export async function seeds(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  if (!(await verify(env.BUILDER_SECRET, request.headers.get(SIGNATURE), "POST", "/api/seeds", text))) {
    return says(401, "Not signed by the Builder.");
  }
  const asked = JSON.parse(text) as { repos?: Seed[]; budget?: number };
  const list = (asked.repos ?? []).filter((r) => repoId(r.owner, r.name)).slice(0, 500);
  const budget = Math.max(0, Math.min(200, asked.budget ?? 50));
  // One call to D1 for all of them (the free plan allows 50 a request), and
  // one statement bound again for each: building each through Drizzle cost
  // more CPU than the rest of the request.
  const upsert = env.DB.prepare(
    "INSERT INTO repositories (id, owner, name, seed, language, stars, size_kb) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6) ON CONFLICT (id) DO UPDATE SET seed = 1, language = ?4, stars = ?5, size_kb = ?6",
  );
  if (list.length > 0) await env.DB.batch(list.map((r) => upsert.bind(repoId(r.owner, r.name), r.owner, r.name, r.language, r.stars, r.sizeKb)));
  // Tonight's: no Report first, then the oldest; none still building. Each
  // with its last Build, in one query: a list of ids would pass D1's 100
  // bound values a statement.
  type Due = { id: string; owner: string; name: string; sizeKb: number | null; reportAt: number | null; state: string | null; reason: string | null; requestedAt: number | null; finishedAt: number | null };
  const due = (
    await env.DB.prepare(
      `SELECT r.id, r.owner, r.name, r.size_kb AS sizeKb, r.report_at AS reportAt, b.state, b.reason, b.requested_at AS requestedAt, b.finished_at AS finishedAt
       FROM repositories r LEFT JOIN builds b ON b.id = (SELECT id FROM builds WHERE repo_id = r.id ORDER BY requested_at DESC LIMIT 1)
       WHERE r.seed = 1 AND r.private = 0 ORDER BY coalesce(r.report_at, 0) LIMIT ?1`,
    )
      .bind(budget * 2)
      .all<Due>()
  ).results;
  const lastOf = (r: Due) => (r.state && r.requestedAt ? { state: r.state, reason: r.reason, requestedAt: r.requestedAt, finishedAt: r.finishedAt } : undefined);
  const started: BuildRequest[] = [];
  const insert = env.DB.prepare("INSERT INTO builds (id, repo_id, state, requested_at, upload_hash) VALUES (?1, ?2, 'queued', ?3, ?4)");
  const inserts: D1PreparedStatement[] = [];
  for (const row of due) {
    if (started.length >= budget) break;
    if (row.reportAt && row.reportAt > now() - BOARDS_FOR) continue;
    if (busy(lastOf(row))) continue;
    const id = randomId();
    const uploadToken = randomId(32);
    inserts.push(insert.bind(id, row.id, now(), await sha256(uploadToken)));
    started.push({ id, owner: row.owner, name: row.name, sizeKb: row.sizeKb ?? 0, private: false, token: null, uploadToken, seed: true });
  }
  if (inserts.length > 0) await env.DB.batch(inserts);
  return json({ seeds: list.length, builds: started });
}

/** Writes the boards from what D1 holds: five queries, one R2 object. */
export async function writeBoards(env: Env): Promise<Boards> {
  const db = drizzle(env.DB);
  const built = and(eq(repositories.seed, true), isNotNull(repositories.reportAt));
  const row = (r: typeof repositories.$inferSelect, value: number, shown: string): BoardRow => ({
    owner: r.owner,
    name: r.name,
    language: r.language,
    stars: r.stars ?? 0,
    value,
    shown,
  });
  const total = await db.select({ n: sql<number>`count(*)` }).from(repositories).where(built).get();
  const onePerson = await db
    .select()
    .from(repositories)
    .where(and(built, eq(repositories.busFactor, 1)))
    .orderBy(desc(repositories.stars))
    .limit(ROWS)
    .all();
  // A "most" board lists only those with some.
  const maintainers = await db.select().from(repositories).where(and(built, gt(repositories.maintainers, 0))).orderBy(desc(repositories.maintainers), desc(repositories.stars)).limit(ROWS).all();
  const byCommits = await db.select().from(repositories).where(and(built, gt(repositories.commits30d, 0))).orderBy(desc(repositories.commits30d)).limit(ROWS).all();
  const byPeople = await db.select().from(repositories).where(and(built, gt(repositories.people30d, 0))).orderBy(desc(repositories.people30d), desc(repositories.commits30d)).limit(ROWS).all();
  const answers = await db
    .select()
    .from(repositories)
    .where(and(built, isNotNull(repositories.answerHours), gte(repositories.answered, 10)))
    .orderBy(asc(repositories.answerHours))
    .limit(ROWS)
    .all();
  const oldest = await db
    .select()
    .from(repositories)
    // Still running: someone committed in the last year (which is what gives a Bus Factor).
    .where(and(built, gte(repositories.codeLines, 1000), isNotNull(repositories.busFactor)))
    .orderBy(sql`cast(${repositories.untouched5y} as real) / ${repositories.codeLines} desc`)
    .limit(ROWS)
    .all();
  const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
  const share = (r: typeof repositories.$inferSelect) => ((r.untouched5y ?? 0) * 100) / Math.max(1, r.codeLines ?? 1);
  const boardList: Board[] = [
    {
      id: "one_person",
      title: "Resting on one person",
      how: "Popular projects where one person made over 80% of the last year's commits (a Bus Factor of 1), most stars first.",
      rows: onePerson.map((r) => row(r, r.stars ?? 0, count(r.stars ?? 0, "star", "stars"))),
    },
    {
      id: "maintainers",
      title: "Most maintainers",
      how: "People with 3 or more commits in the last 90 days.",
      rows: maintainers.map((r) => row(r, r.maintainers ?? 0, count(r.maintainers ?? 0, "maintainer", "maintainers"))),
    },
    {
      id: "active_commits",
      title: "Most active this month, by commits",
      how: "Commits that are not merges in the last 30 days.",
      rows: byCommits.map((r) => row(r, r.commits30d ?? 0, count(r.commits30d ?? 0, "commit", "commits"))),
    },
    {
      id: "active_people",
      title: "Most active this month, by people",
      how: "People who made a commit in the last 30 days, bots left out.",
      rows: byPeople.map((r) => row(r, r.people30d ?? 0, count(r.people30d ?? 0, "person", "people"))),
    },
    {
      id: "answers",
      title: "Fastest to answer issues",
      how: "The middle time from an issue opening to its first answer by someone else, among the last hundred issues; 10 or more answered.",
      rows: answers.map((r) => row(r, r.answerHours ?? 0, hours(r.answerHours ?? 0))),
    },
    {
      id: "oldest_code",
      title: "Oldest code still running",
      how: "The share of today's lines of code in files nobody has changed for five years, in projects with commits in the last year; 1,000 lines or more.",
      rows: oldest.map((r) => row(r, share(r), `${Math.round(share(r))}% of ${(r.codeLines ?? 0).toLocaleString("en-US")} lines`)),
    },
  ];
  const boards: Boards = { builtAt: now(), from: total?.n ?? 0, boards: boardList };
  await env.REPORTS.put(KEY, JSON.stringify(boards), { httpMetadata: { contentType: "application/json" } });
  return boards;
}

/** `POST /api/leaderboards/write`, signed by the Builder when a night's Builds are done. */
export async function writeBoardsNow(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  if (!(await verify(env.BUILDER_SECRET, request.headers.get(SIGNATURE), "POST", "/api/leaderboards/write", text))) {
    return says(401, "Not signed by the Builder.");
  }
  const boards = await writeBoards(env);
  return json({ ok: true, from: boards.from });
}

/** The Cron Trigger's part: the boards once they are a day old. */
export async function boardsIfOld(env: Env): Promise<void> {
  const head = await env.REPORTS.head(KEY);
  if (!head || head.uploaded.getTime() / 1000 < now() - BOARDS_FOR) await writeBoards(env);
}

/** `GET /api/leaderboards`: the document as it was written. */
export async function getBoards(env: Env): Promise<Response> {
  const object = await env.REPORTS.get(KEY);
  if (!object) return json({ builtAt: 0, from: 0, boards: [] } satisfies Boards);
  return new Response(object.body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
}
