import type { SearchableItem, SearchSource } from "@astryxdesign/core/Typeahead";
import type { Route } from "./route";

export type Jump = SearchableItem<{ group: string; to: Partial<Route>; login?: string | null; hint?: string; file?: string }>;

export function jumpSource(items: Promise<Jump[]>): SearchSource<Jump> {
  const shown = (list: Jump[]) => list.slice(0, 60);
  return {
    bootstrap: async () => shown((await items).filter((i) => i.auxiliaryData?.group === "Screens")),
    async search(query) {
      const all = await items;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) return shown(all);
      const commits: Jump = { id: `commits:${query.trim()}`, label: `Commits that mention “${query.trim()}”`, auxiliaryData: { group: "Commits", to: { screen: "commits", q: query.trim(), id: undefined, file: undefined } } };
      const found = all.filter((i) => words.every((w) => i.label.toLowerCase().includes(w)));
      const first = words[0] ?? "";
      const leading = found.filter((i) => i.label.toLowerCase().startsWith(first));
      return [...shown([...leading, ...found.filter((i) => !leading.includes(i))]), commits];
    },
  };
}
