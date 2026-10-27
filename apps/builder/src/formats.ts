const KEPT_MS = 5 * 60_000;

/** The pack format to write: 3 when the engine service at `url` says it reads it, else 2, which every engine service reads, also when it cannot be asked; its health answer is asked at most every five minutes. Without an engine service to ask, 3. */
export function packFormatOf(url: string | undefined, fetcher: typeof fetch = fetch): () => Promise<2 | 3> {
  let known: { format: 2 | 3; at: number } | null = null;
  return async () => {
    if (!url) return 3;
    if (known && Date.now() - known.at < KEPT_MS) return known.format;
    const format = await fetcher(new URL("/healthz", url), { signal: AbortSignal.timeout(5000) })
      .then(async (r) => (r.ok ? ((await r.json()) as { pack_formats?: unknown }) : null))
      .then((health): 2 | 3 => (Array.isArray(health?.pack_formats) && health.pack_formats.includes(3) ? 3 : 2))
      .catch((): 2 => 2);
    known = { format, at: Date.now() };
    return format;
  };
}
