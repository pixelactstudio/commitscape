import { and, desc, eq, sql } from "drizzle-orm";
import { busy, now, PRIORITY, queueBuild, REPORT_FOR, repoId, schema, settleRepository, type Db, type Queue, type Storage } from "@commitscape/server";
import type { Env } from "./config";

const { builds, repositories } = schema;

export type SeedConfig = {
  languages: string[];
  perLanguage: number;
  budget: number;
  api: string;
  token: string | undefined;
  wait?: boolean;
};

export function seedConfig(env: Env): SeedConfig {
  return {
    languages: env.SEED_LANGUAGES.split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    perLanguage: env.SEED_PER_LANGUAGE,
    budget: env.SEED_BUDGET,
    api: env.GITHUB_API.replace(/\/$/, ""),
    token: env.GITHUB_TOKEN,
    wait: true,
  };
}

export type Seed = { owner: string; name: string; language: string; stars: number; sizeKb: number; githubId?: number };

/** The most starred repositories per language, from GitHub's search. */
export async function seedList(s: SeedConfig, fetcher: typeof fetch = fetch): Promise<Seed[]> {
  const out: Seed[] = [];
  for (const language of s.languages) {
    const q = encodeURIComponent(`language:"${language}" archived:false fork:false`);
    const ask = () =>
      fetcher(`${s.api}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${s.perLanguage}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "commitscape-builder", ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) },
      });
    if (out.length > 0 && s.wait) await pause(s.token ? 2500 : 7000);
    let answer = await ask();
    for (let tries = 0; tries < 3 && (answer.status === 403 || answer.status === 429); tries++) {
      const after = Number(answer.headers.get("retry-after") ?? 0) * 1000;
      const reset = Number(answer.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now();
      await pause(s.wait ? Math.min(90_000, Math.max(5000, after, reset + 1000)) : 0);
      answer = await ask();
    }
    if (!answer.ok) throw new Error(`GitHub's search answered ${answer.status} for ${language}`);
    const items = ((await answer.json()) as { items?: { id?: number; full_name: string; stargazers_count: number; size: number }[] }).items ?? [];
    for (const i of items) {
      const [owner = "", name = ""] = i.full_name.split("/");
      if (!out.some((o) => o.owner === owner && o.name === name)) out.push({ owner, name, language, stars: i.stargazers_count, sizeKb: i.size, ...(typeof i.id === "number" ? { githubId: i.id } : {}) });
    }
  }
  return out;
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Marks the list as Leaderboard seeds under their current names, moving rows kept under older ones, and queues tonight's Builds within the budget. */
export async function queueSeeds(db: Db, queue: Queue, list: Seed[], budget: number, storage: Storage | null = null): Promise<number> {
  const valid = list.filter((r) => repoId(r.owner, r.name)).slice(0, 500);
  for (const r of valid) {
    const fields = { seed: true, language: r.language, stars: r.stars, sizeKb: r.sizeKb };
    if (r.githubId) {
      await settleRepository(db, storage, { githubId: r.githubId, owner: r.owner, name: r.name, set: fields });
      continue;
    }
    await db
      .insert(repositories)
      .values({ id: repoId(r.owner, r.name) ?? "", owner: r.owner, name: r.name, ...fields })
      .onConflictDoUpdate({ target: repositories.id, set: fields });
  }
  const due = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.seed, true), eq(repositories.isPrivate, false)))
    .orderBy(sql`coalesce(${repositories.reportAt}, 0)`)
    .limit(budget * 2);
  let queued = 0;
  for (const row of due) {
    if (queued >= budget) break;
    if (row.reportAt && row.reportAt > now() - REPORT_FOR && row.reportLines !== false) continue;
    const [last] = await db.select().from(builds).where(eq(builds.repoId, row.id)).orderBy(desc(builds.requestedAt)).limit(1);
    if (busy(last)) continue;
    await queueBuild(db, queue, row.id, PRIORITY.seed);
    queued++;
  }
  return queued;
}
