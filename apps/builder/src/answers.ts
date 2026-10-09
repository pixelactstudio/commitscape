import { cachedGet, type Db } from "@commitscape/server";
import type { GitHubApi } from "./github";

export const RECENT = 100;
const PAGES = 5;
const FIRST_COMMENTS = 5;
const LIST_FOR = 3600;
const SETTLED_FOR = 30 * 24 * 3600;
const OPEN_FOR = 6 * 3600;
const AT_ONCE = 8;

const AUTOMATION = new Set([
  "action@github.com",
  "allcontributors",
  "ansibot",
  "bors",
  "codecov",
  "dependabot",
  "dependabot-preview",
  "elasticsearchmachine",
  "github-actions",
  "greenkeeper",
  "imgbot",
  "mergify",
  "pre-commit-ci",
  "renovate",
  "snyk-bot",
]);

type User = { login: string; type?: string } | null;
type Issue = { number: number; created_at: string; comments: number; user: User; pull_request?: unknown };
type Comment = { created_at: string; user: User };

export type Answers = { asked: number; answered: number; typical_hours: number | null };

const isBot = (u: User) => {
  if (!u) return false;
  const login = u.login.trim().toLowerCase();
  return u.type === "Bot" || login.endsWith("[bot]") || login.endsWith("-bot") || AUTOMATION.has(login);
};

function middle(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  return n % 2 === 1 ? (sorted[(n - 1) / 2] ?? null) : ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2;
}

/** How quickly a repository's newest hundred issues got a first answer from someone other than their author and not a Bot, as `commitscape health` counted it, from GitHub's REST API through the shared cache. */
export async function issueAnswers(db: Db, gh: GitHubApi, owner: string, name: string, scope = "public"): Promise<Answers | null> {
  const api = `${gh.api.replace(/\/$/, "")}/repos/${owner}/${name}`;
  const get = <T>(url: string, ttl: number) => cachedGet<T>(db, { url, token: gh.token, scope, ttl, ...(gh.fetcher ? { fetcher: gh.fetcher } : {}) });
  const issues: Issue[] = [];
  for (let page = 1; page <= PAGES && issues.length < RECENT; page++) {
    const listed = await get<Issue[]>(`${api}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`, LIST_FOR);
    if (listed.status !== 200 || !Array.isArray(listed.body)) return null;
    issues.push(...listed.body.filter((i) => !i.pull_request));
    if (listed.body.length < 100) break;
  }
  const recent = issues.slice(0, RECENT);
  const hours: number[] = [];
  let failed = false;
  const answer = async (issue: Issue) => {
    if (issue.comments === 0) return;
    const ttl = issue.comments >= FIRST_COMMENTS ? SETTLED_FOR : OPEN_FOR;
    const got = await get<Comment[]>(`${api}/issues/${issue.number}/comments?per_page=${FIRST_COMMENTS}`, ttl);
    if (got.status !== 200 || !Array.isArray(got.body)) {
      failed = true;
      return;
    }
    const author = issue.user?.login;
    const first = got.body.slice(0, FIRST_COMMENTS).find((c) => !isBot(c.user) && (c.user?.login ?? null) !== author);
    if (first) hours.push((Date.parse(first.created_at) - Date.parse(issue.created_at)) / 3_600_000);
  };
  for (let i = 0; i < recent.length && !failed; i += AT_ONCE) await Promise.all(recent.slice(i, i + AT_ONCE).map(answer));
  if (failed) return null;
  hours.sort((a, b) => a - b);
  const typical = middle(hours);
  return { asked: recent.length, answered: hours.length, typical_hours: typical === null ? null : Math.round(typical * 10) / 10 };
}
