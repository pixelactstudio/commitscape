import type { SearchableItem, SearchSource } from "@astryxdesign/core/Typeahead";
import type { Route } from "./route";

/** Somewhere ⌘K can go: a screen, a person, a folder, a file. */
export type Jump = SearchableItem<{ group: string; to: Partial<Route> }>;

/**
 * Finds jumps by every word typed, in any order, ignoring case, once the
 * list has arrived: a query typed before it is answered from it.
 */
export function jumpSource(items: Promise<Jump[]>): SearchSource<Jump> {
  const shown = (list: Jump[]) => list.slice(0, 60);
  return {
    bootstrap: async () => shown((await items).filter((i) => i.auxiliaryData?.group === "Screens")),
    async search(query) {
      const all = await items;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) return shown(all);
      return shown(all.filter((i) => words.every((w) => i.label.toLowerCase().includes(w))));
    },
  };
}
