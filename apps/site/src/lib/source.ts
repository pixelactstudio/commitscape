import { key, NOT_IN_REPORT, type DataSource, type Meta } from "@commitscape/data";
import { getReportCard, getReportEntry } from "#/functions/repos";

/** A stored Report read one answer at a time through server functions. */
export function siteSource(owner: string, repo: string, at: number, meta: Meta): DataSource {
  const base = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    id: `gh:${owner}/${repo}@${at}`.toLowerCase(),
    meta,
    async get<T>(path: string, params = {}) {
      if (path === "/api/commits") {
        const answer = await fetch(`/api/reports/${base}/commits?at=${at}`);
        if (!answer.ok) throw new Error(((await answer.json().catch(() => null)) as { error?: string } | null)?.error ?? NOT_IN_REPORT);
        return (await answer.json()) as T;
      }
      const found = await getReportEntry({ data: { owner, repo, key: key(path, params) } });
      if (found === null) throw new Error(NOT_IN_REPORT);
      return found as T;
    },
    card: (window) => getReportCard({ data: { owner, repo, window } }),
  };
}
