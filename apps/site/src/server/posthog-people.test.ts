import { describe, expect, test } from "vitest";
import { deletePerson } from "./posthog-people";

describe("deleting a person in PostHog", () => {
  test("asks PostHog's app, not its ingestion host, to delete the person with their events and recordings", async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      asked.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    expect(await deletePerson("abc", { apiHost: "https://us.i.posthog.com", key: "phx_k", project: "42" }, fetcher)).toBe(true);
    const [first] = asked;
    expect(first?.url).toBe("https://us.posthog.com/api/projects/42/persons/bulk_delete/?delete_events=true&delete_recordings=true");
    expect(JSON.parse(String(first?.init.body))).toEqual({ distinct_ids: ["abc"], delete_events: true, delete_recordings: true });
    expect(first?.init.headers).toMatchObject({ authorization: "Bearer phx_k" });
  });

  test("does nothing without a key or project, and says so when PostHog refuses or cannot be reached", async () => {
    const never = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const refused = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    expect(await deletePerson("abc", { apiHost: "https://us.i.posthog.com", key: undefined, project: "42" }, never)).toBe(false);
    expect(await deletePerson("abc", { apiHost: "https://us.i.posthog.com", key: "k", project: "42" }, never)).toBe(false);
    expect(await deletePerson("abc", { apiHost: "https://us.i.posthog.com", key: "k", project: "42" }, refused)).toBe(false);
  });
});
