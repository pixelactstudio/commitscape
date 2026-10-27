import { key, NOT_IN_REPORT, type CommitPage, type DataSource, type Meta } from "@commitscape/data";
import { getReportEntry } from "#/functions/repos";

async function read<T>(url: string, fallback: string): Promise<T> {
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(((await answer.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback);
  return (await answer.json()) as T;
}

/** A stored Report read one answer at a time: in process while the server draws a page, then in the browser as plain JSON from the answers API, kept for good under the Report it is of; its commits a page at a time from the commits API. */
export function siteSource(owner: string, repo: string, at: number, meta: Meta, ranges = false): DataSource {
  const base = `/api/reports/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    id: `gh:${owner}/${repo}@${at}`.toLowerCase(),
    meta,
    ranges,
    ...(ranges ? { atlas: `${base}/atlas?v=${at}` } : {}),
    async get<T>(path: string, params = {}) {
      const asked = key(path, params);
      if (typeof window === "undefined") {
        const found = await getReportEntry({ data: { owner, repo, key: asked } });
        if (found === null) throw new Error(NOT_IN_REPORT);
        return found as T;
      }
      return read<T>(`${base}/answer?${new URLSearchParams({ key: asked, at: String(at) })}`, NOT_IN_REPORT);
    },
    async commits(query, cursor) {
      const search = new URLSearchParams({ at: String(at) });
      for (const [k, v] of Object.entries({ ...query, cursor })) if (v !== undefined && v !== "") search.set(k, String(v));
      return read<CommitPage>(`${base}/commits?${search}`, NOT_IN_REPORT);
    },
  };
}
