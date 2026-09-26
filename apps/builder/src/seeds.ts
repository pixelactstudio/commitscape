/**
 * The Leaderboards' seed list (IDEA.md): the most starred repositories in
 * each language, from GitHub's search, sent to the Site, which answers
 * with that night's Builds within the budget. The Builder runs them like
 * any Build, then asks the Site to write the boards.
 */
import { SIGNATURE, sign, type BuildRequest } from "@commitscape/data";
import type { Config } from "./config";
import { twice } from "./site";

export type SeedConfig = {
  /** Languages, as GitHub names them. */
  languages: string[];
  /** Repositories per language. */
  perLanguage: number;
  /** Builds a night. */
  budget: number;
  /** GitHub's API, and a token for its search limits (optional). */
  api: string;
  token: string | undefined;
  /** Whether to wait out GitHub's search limit (tests do not). */
  wait?: boolean;
};

export function seedConfig(): SeedConfig {
  return {
    languages: (process.env.SEED_LANGUAGES ?? "JavaScript,TypeScript,Python,Go,Rust,Java,C,C++,Ruby")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    perLanguage: Number(process.env.SEED_PER_LANGUAGE ?? 10),
    budget: Number(process.env.SEED_BUDGET ?? 50),
    api: (process.env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, ""),
    token: process.env.GITHUB_TOKEN || undefined,
    wait: true,
  };
}

export type Seed = { owner: string; name: string; language: string; stars: number; sizeKb: number };

/** The most starred, not archived, not forks, per language. */
export async function seedList(s: SeedConfig, fetcher: typeof fetch = fetch): Promise<Seed[]> {
  const out: Seed[] = [];
  for (const language of s.languages) {
    const q = encodeURIComponent(`language:"${language}" archived:false fork:false`);
    const ask = () =>
      fetcher(`${s.api}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${s.perLanguage}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "commitscape-builder", ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) },
      });
    // GitHub's search allows 10 requests a minute without a token, 30 with
    // one, and refuses bursts too: keep under it, and past it wait for the
    // time it says, up to three times.
    if (out.length > 0 && s.wait) await pause(s.token ? 2500 : 7000);
    let answer = await ask();
    for (let tries = 0; tries < 3 && (answer.status === 403 || answer.status === 429); tries++) {
      const after = Number(answer.headers.get("retry-after") ?? 0) * 1000;
      const reset = Number(answer.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now();
      await pause(s.wait ? Math.min(90_000, Math.max(5000, after, reset + 1000)) : 0);
      answer = await ask();
    }
    if (!answer.ok) throw new Error(`GitHub's search answered ${answer.status} for ${language}`);
    const items = ((await answer.json()) as { items?: { full_name: string; stargazers_count: number; size: number }[] }).items ?? [];
    for (const i of items) {
      const [owner = "", name = ""] = i.full_name.split("/");
      if (!out.some((o) => o.owner === owner && o.name === name)) out.push({ owner, name, language, stars: i.stargazers_count, sizeKb: i.size });
    }
  }
  return out;
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sends the list to the Site; its answer is the night's Builds. */
export async function askForSeeds(cfg: Config, s: SeedConfig, list: Seed[], fetcher: typeof fetch = fetch): Promise<BuildRequest[]> {
  const body = JSON.stringify({ repos: list, budget: s.budget });
  // Tried again once on a dropped connection or a 5xx: Builds the first try
  // queued are busy on the second, never started twice.
  const answer = await twice(async () =>
    fetcher(`${cfg.site}/api/seeds`, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE]: await sign(cfg.secret, "POST", "/api/seeds", body) },
      body,
    }),
  );
  if (!answer.ok) throw new Error(`the Site answered /api/seeds with ${answer.status}: ${await answer.text()}`);
  return ((await answer.json()) as { builds: BuildRequest[] }).builds;
}

/** Asks the Site to write the boards now. */
export async function writeBoards(cfg: Config, fetcher: typeof fetch = fetch): Promise<void> {
  const answer = await twice(async () =>
    fetcher(`${cfg.site}/api/leaderboards/write`, {
      method: "POST",
      headers: { [SIGNATURE]: await sign(cfg.secret, "POST", "/api/leaderboards/write", "") },
    }),
  );
  if (!answer.ok) throw new Error(`the Site did not write the boards: ${answer.status}`);
}
