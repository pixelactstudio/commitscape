import { ENGINE_FORMATS_KEY, type Storage } from "@commitscape/server";

export type PackFormat = 2 | 3;

const WRITTEN: PackFormat[] = [3, 2];

const KEPT_MS = 5 * 60_000;

const newest = (read: unknown): PackFormat | null => (Array.isArray(read) ? (WRITTEN.find((f) => read.includes(f)) ?? null) : null);

export type FormatSources = { setting?: PackFormat | undefined; url?: string | undefined; storage?: Pick<Storage, "get"> | undefined; log?: (line: string) => void };

/** The pack format to write, worked out at most every five minutes: `PACK_FORMAT` when set; else the newest the engine service reads, as its health answer says when `ENGINE_URL` reaches it (one listing no formats is of a release that reads only format 2), or as the marker it writes to R2 when it starts says; else 3. Says in the log when the format or what decided it changes. */
export function packFormatOf(sources: FormatSources, fetcher: typeof fetch = fetch): () => Promise<PackFormat> {
  let known: { format: PackFormat; at: number; why: string } | null = null;
  const fromHealth = async (url: string): Promise<PackFormat | null> =>
    fetcher(new URL("/healthz", url), { signal: AbortSignal.timeout(5000) })
      .then(async (r) => (r.ok ? ((await r.json()) as { pack_formats?: unknown }) : null))
      .then((health) => (health ? (newest(health.pack_formats) ?? 2) : null))
      .catch(() => null);
  const fromMarker = async (storage: Pick<Storage, "get">): Promise<PackFormat | null> =>
    storage
      .get(ENGINE_FORMATS_KEY)
      .then((o) => (o ? newest((JSON.parse(new TextDecoder().decode(o.body)) as { pack_formats?: unknown }).pack_formats) : null))
      .catch(() => null);
  const decide = async (): Promise<{ format: PackFormat; why: string }> => {
    if (sources.setting) return { format: sources.setting, why: "PACK_FORMAT" };
    const asked = sources.url ? await fromHealth(sources.url) : null;
    if (asked) return { format: asked, why: "the engine service's health answer" };
    const marked = sources.storage ? await fromMarker(sources.storage) : null;
    if (marked) return { format: marked, why: `the engine service's ${ENGINE_FORMATS_KEY}` };
    return { format: 3, why: "no word from the engine service" };
  };
  return async () => {
    if (known && Date.now() - known.at < KEPT_MS) return known.format;
    const decided = await decide();
    if (known?.format !== decided.format || known.why !== decided.why) sources.log?.(`packs: format ${decided.format}, from ${decided.why}`);
    known = { ...decided, at: Date.now() };
    return decided.format;
  };
}
