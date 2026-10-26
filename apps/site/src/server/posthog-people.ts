import "@tanstack/react-start/server-only";
import { uiHostOf } from "#/lib/posthog-hosts";

export type PostHogAdmin = { apiHost: string; key: string | undefined; project: string | undefined };

/** Asks PostHog to delete the person behind a distinct id, with their events and recordings; false when no personal API key and project are set or PostHog did not accept it. */
export async function deletePerson(distinctId: string, { apiHost, key, project }: PostHogAdmin, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!key || !project) return false;
  const url = `${uiHostOf(apiHost)}/api/projects/${encodeURIComponent(project)}/persons/bulk_delete/?delete_events=true&delete_recordings=true`;
  const answered = await fetcher(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ distinct_ids: [distinctId], delete_events: true, delete_recordings: true }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return answered?.ok ?? false;
}
