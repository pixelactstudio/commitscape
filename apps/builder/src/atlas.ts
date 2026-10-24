import type { Storage } from "@commitscape/server";

/** Loads a repository's new Stored Index through `load`, then deletes the stored Atlas payloads of the Stored Index it replaces, so the Universe never serves an old one. */
export async function replaceIndex<T extends { si: number }>(storage: Storage, before: { id: number } | null, load: () => Promise<T>): Promise<T> {
  const loaded = await load();
  if (before && before.id !== loaded.si) await storage.deletePrefix(`atlas/${before.id}/`).catch(() => undefined);
  return loaded;
}
