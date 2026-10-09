import { key, NOT_IN_REPORT, type CommitPage, type DataSource, type Meta } from "@commitscape/data";
import { getReportEntry } from "#/functions/repos";

/** A stored Report read one answer at a time through server functions, and its commits a page at a time from the commits API. */
export function siteSource(owner: string, repo: string, at: number, meta: Meta): DataSource {
  const base = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    id: `gh:${owner}/${repo}@${at}`.toLowerCase(),
    meta,
    async get<T>(path: string, params = {}) {
      const found = await getReportEntry({ data: { owner, repo, key: key(path, params) } });
      if (found === null) throw new Error(NOT_IN_REPORT);
      return found as T;
    },
    async commits(query, cursor) {
      const search = new URLSearchParams({ at: String(at) });
      for (const [k, v] of Object.entries({ ...query, cursor })) if (v !== undefined && v !== "") search.set(k, String(v));
      const answer = await fetch(`/api/reports/${base}/commits?${search}`);
      if (!answer.ok) throw new Error(((await answer.json().catch(() => null)) as { error?: string } | null)?.error ?? NOT_IN_REPORT);
      return (await answer.json()) as CommitPage;
    },
  };
}
