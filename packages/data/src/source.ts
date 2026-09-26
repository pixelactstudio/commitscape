/**
 * The Data Source (ADR-0013): the one seam every screen reads through.
 * The screens never call `fetch`; they are handed one of these.
 *
 * - {@link serverSource}: the local server `commitscape --web` runs, which
 *   answers any question and tells the page when its answers change.
 * - {@link reportSource}: a Report, every answer written ahead of time
 *   (`commitscape report`, inlined as `window.__COMMITSCAPE__`).
 * - {@link fetchReport}: a Report downloaded (and, for a Shared Report,
 *   decrypted) and then read exactly like an inlined one.
 */
import type { Meta } from "./types";

export type Params = Record<string, string | number | null | undefined>;

/** Every answer the browser interface needs, written ahead of time. */
export type Report = {
  meta: Meta;
  /** Each answer by the request that asks for it, as {@link key} writes it. */
  data: Record<string, unknown>;
  /** Each Window's card, as SVG. */
  cards: Record<string, string>;
};

export interface DataSource {
  /** A live server on this machine, or a Report written ahead of time. */
  readonly kind: "server" | "report";
  /** The state it opened with, when it is known before asking. */
  readonly meta: Meta | null;
  /** A screen's data. */
  get<T>(path: string, params?: Params): Promise<T>;
  /** The card for a Window, as SVG text. */
  card(window: string): Promise<string>;
  /**
   * Calls `onChange` whenever the state changes: the rest of history read,
   * lines counted, GitHub answered. Returns a function that stops
   * listening. A Report never changes.
   */
  listen(onChange: (meta: Meta) => void): () => void;
  /** Undoes (or redoes) the merge that made a person: a live server only. */
  changePerson?: (id: number, undo: boolean) => Promise<void>;
  /**
   * Shares the Report for so many hours (ADR-0016), as `commitscape share`
   * does: a live server only, and never with `--offline`.
   */
  share?: (hours: number) => Promise<{ link: string; expiresAt: number }>;
}

/** A request as a key: its path, then its non-empty parameters sorted. */
export function key(path: string, params: Params = {}): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${path}?${query}`;
}

/** Why a Report cannot answer: it holds only what it was written with. */
export const NOT_IN_REPORT =
  "This report was written without it: open the repository with commitscape --web to see it.";

/** The local server, asked on this page's own origin. */
export function serverSource(meta: Meta | null, fetcher: typeof fetch = fetch): DataSource {
  const ask = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetcher(path, { credentials: "same-origin", ...init });
    if (!response.ok) throw new Error(await response.text());
    return response;
  };
  return {
    kind: "server",
    meta,
    get: async <T>(path: string, params: Params = {}) => (await (await ask(key(path, params))).json()) as T,
    card: async (window) => (await ask(key("/api/card.svg", { window }))).text(),
    listen(onChange) {
      const events = new EventSource("/api/events");
      events.onmessage = (e) => onChange(JSON.parse(e.data) as Meta);
      return () => events.close();
    },
    async changePerson(id, undo) {
      await ask(key(`/api/person/${undo ? "undo" : "redo"}`, { id }), { method: "POST" });
    },
    async share(hours) {
      return (await (await ask(key("/api/share", { hours }), { method: "POST" })).json()) as { link: string; expiresAt: number };
    },
  };
}

/** A Report: every answer is looked up, and anything else was left out. */
export function reportSource(report: Report): DataSource {
  return {
    kind: "report",
    meta: report.meta,
    async get<T>(path: string, params: Params = {}) {
      const found = report.data[key(path, params)];
      if (found === undefined) throw new Error(NOT_IN_REPORT);
      return found as T;
    },
    async card(window) {
      const svg = report.cards[window];
      if (svg === undefined) throw new Error(NOT_IN_REPORT);
      return svg;
    },
    listen: () => () => {},
  };
}

/** Whether bytes start as gzip does. */
function gzipped(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Undoes gzip, in the browser's own decompressor. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a Report's bytes: JSON, gzipped or not. */
export async function readReport(bytes: Uint8Array): Promise<Report> {
  const plain = gzipped(bytes) ? await gunzip(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(plain)) as Report;
}

export type FetchOptions = {
  fetcher?: typeof fetch;
  /** Turns what was downloaded into the Report's bytes: a Shared Report's key. */
  decrypt?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Downloads a Report, decrypts it when it is a Shared Report, and reads it
 * as an inlined one.
 */
export async function fetchReport(url: string, options: FetchOptions = {}): Promise<DataSource> {
  const response = await (options.fetcher ?? fetch)(url);
  if (!response.ok) throw new Error(await response.text());
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  if (options.decrypt) bytes = await options.decrypt(bytes);
  return reportSource(await readReport(bytes));
}
