import type { Meta } from "./types";

export type Params = Record<string, string | number | null | undefined>;

export type Report = {
  meta: Meta;
  data: Record<string, unknown>;
  cards: Record<string, string>;
};

export interface DataSource {
  readonly id: string;
  readonly meta: Meta;
  get<T>(path: string, params?: Params): Promise<T>;
  card(window: string): Promise<string>;
}

export function key(path: string, params: Params = {}): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${path}?${query}`;
}

export const NOT_IN_REPORT =
  "This Report was written without it.";

/** A whole Report in memory as a Data Source. */
export function reportSource(report: Report, id: string): DataSource {
  return {
    id,
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
  };
}

function gzipped(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a Report's bytes, gzipped or not. */
export async function readReport(bytes: Uint8Array): Promise<Report> {
  const plain = gzipped(bytes) ? await gunzip(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(plain)) as Report;
}
