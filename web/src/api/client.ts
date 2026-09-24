/**
 * The server's JSON API. The server sets a cookie with its secret on the
 * first visit, so every request here is same-origin and carries it.
 *
 * A report (`commitscape report`) has no server: its answers are written
 * into the page as `window.__COMMITSCAPE__`, by the same keys `key` makes.
 */
import type { Meta } from "./types";

type Inlined = {
  meta: Meta;
  data: Record<string, unknown>;
  cards: Record<string, string>;
};

declare global {
  interface Window {
    __COMMITSCAPE__?: Inlined;
    /** The server's state when it served the page. */
    __COMMITSCAPE_META__?: Meta;
  }
}

const inlined = typeof window === "undefined" ? undefined : window.__COMMITSCAPE__;

/** The state the page was served with, before any event arrives. */
export const servedMeta: Meta | null =
  (typeof window === "undefined" ? undefined : (inlined?.meta ?? window.__COMMITSCAPE_META__)) ?? null;

/** Whether this page is a report, with no server behind it. */
export const isReport = inlined !== undefined;

export type Params = Record<string, string | number | null | undefined>;

/** A request as a key: its path, then its non-empty parameters sorted. */
export function key(path: string, params: Params = {}): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${path}?${query}`;
}

/** Why a report cannot answer: it holds only what it was written with. */
export const NOT_IN_REPORT =
  "This report was written without it: open the repository with commitscape --web to see it.";

export async function get<T>(path: string, params: Params = {}): Promise<T> {
  const k = key(path, params);
  if (inlined) {
    const found = inlined.data[k];
    if (found === undefined) throw new Error(NOT_IN_REPORT);
    return found as T;
  }
  const response = await fetch(k, { credentials: "same-origin" });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** Undoes (or redoes) the merge that made a person. */
export async function changePerson(id: number, undo: boolean): Promise<void> {
  const response = await fetch(key(`/api/person/${undo ? "undo" : "redo"}`, { id }), {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await response.text());
}

/** The card for a Window, as SVG text. */
export async function cardSvg(window: string): Promise<string> {
  if (inlined) {
    const svg = inlined.cards[window];
    if (svg === undefined) throw new Error(NOT_IN_REPORT);
    return svg;
  }
  const response = await fetch(key("/api/card.svg", { window }), { credentials: "same-origin" });
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

/**
 * Calls `onChange` with the server's state now and whenever it changes:
 * the rest of history read, lines counted, GitHub answered (the state the
 * page was served with is `servedMeta`). Returns a
 * function that stops listening.
 */
export function listen(onChange: (meta: Meta) => void): () => void {
  if (inlined) return () => {};
  const events = new EventSource("/api/events");
  events.onmessage = (e) => onChange(JSON.parse(e.data) as Meta);
  return () => events.close();
}
