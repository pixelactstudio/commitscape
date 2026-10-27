import type { Storage } from "@commitscape/server";

/** Loads a repository's new Stored Index through `load`, then deletes the stored Atlas payloads and the pack of the Stored Index it replaces, so neither is served again. */
export async function replaceIndex<T extends { si: number }>(storage: Storage, before: { id: number; pack?: string | null } | null, load: () => Promise<T>): Promise<T> {
  const loaded = await load();
  if (before && before.id !== loaded.si) {
    await storage.deletePrefix(`atlas/${before.id}/`).catch(() => undefined);
    await storage.deletePrefix(`screens/${before.id}/`).catch(() => undefined);
    if (before.pack) await storage.delete([before.pack]).catch(() => undefined);
  }
  return loaded;
}
