/**
 * The server's JSON API. The server sets a cookie with its secret on the
 * first visit, so every request here is same-origin and carries it.
 */
import type { Meta, Overview } from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  overview: (window: string) =>
    get<Overview>(`/api/overview?window=${encodeURIComponent(window)}`),
};

/**
 * Calls `onChange` with the server's state now and whenever it changes:
 * the rest of history read, lines counted, GitHub answered. Returns a
 * function that stops listening.
 */
export function listen(onChange: (meta: Meta) => void): () => void {
  const events = new EventSource("/api/events");
  events.onmessage = (e) => onChange(JSON.parse(e.data) as Meta);
  return () => events.close();
}
