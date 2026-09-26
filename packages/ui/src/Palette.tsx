/**
 * ⌘K: jump to a screen, a person, a folder or a file. What it offers comes
 * through the Data Source like everything else, asked for when it opens:
 * the Window's people, the Map's first two levels of folders and files,
 * and the Hotspots.
 */
import { useMemo } from "react";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import type { DataSource, MapLevel, Meta, People, Risk } from "@commitscape/data";
import { useSource } from "./data";
import { jumpSource, type Jump } from "./jump";
import { SCREENS, TITLES, type Route } from "./route";
import { folderOf } from "./screens/props";

export function Palette({
  isOpen,
  onOpenChange,
  meta,
  window,
  go,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  meta: Meta;
  window: string;
  go: (change: Partial<Route>) => void;
}) {
  const source = useSource();
  // Asked for each time it opens, so it follows the Window and the server.
  const items = useMemo(
    () => (isOpen ? jumps(source, window) : Promise.resolve([])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, source, window, meta.generation],
  );
  const searchSource = useMemo(() => jumpSource(items), [items]);
  const pick = (id: string) => {
    void items.then((list) => {
      const to = list.find((i) => i.id === id)?.auxiliaryData?.to;
      if (to) go(to);
    });
    onOpenChange(false);
  };
  // Enter with nothing highlighted takes the first match, as npmx.dev does.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const input = e.target as HTMLElement;
    if (e.key !== "Enter" || input.getAttribute("role") !== "combobox" || input.getAttribute("aria-activedescendant")) return;
    const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
    const first = list?.querySelector<HTMLElement>('[role="option"][data-value]')?.dataset.value;
    if (!first) return;
    e.preventDefault();
    e.stopPropagation();
    pick(first);
  };
  return (
    <div onKeyDownCapture={onKeyDownCapture}>
      <CommandPalette
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        label="Jump to"
        searchSource={searchSource}
        emptySearchText="Nothing by that name in this Window"
        onValueChange={pick}
      />
    </div>
  );
}

/** Everywhere to jump to in a Window, from what the Data Source answers. */
async function jumps(source: DataSource, window: string): Promise<Jump[]> {
  const soft = <T,>(p: Promise<T>) => p.catch(() => null);
  const [people, map, risk] = await Promise.all([
    soft(source.get<People>("/api/people", { window })),
    soft(source.get<MapLevel>("/api/map", { window })),
    soft(source.get<Risk>("/api/risk", { window })),
  ]);
  const out: Jump[] = SCREENS.map((s) => ({
    id: `screen:${s}`,
    label: TITLES[s],
    auxiliaryData: { group: "Screens", to: { screen: s, id: undefined, file: undefined } },
  }));
  for (const p of people?.people ?? []) {
    out.push({ id: `person:${p.person.id}`, label: p.person.name, auxiliaryData: { group: "People", to: { screen: "people", id: p.person.id } } });
  }
  const files = new Set<string>();
  for (const b of map?.children ?? []) {
    for (const c of [b, ...b.inside]) {
      if (c.file) files.add(c.path);
      else out.push({ id: `folder:${c.path}`, label: c.path, auxiliaryData: { group: "Folders", to: { screen: "map", path: c.path, file: undefined } } });
    }
  }
  for (const h of risk?.hotspots ?? []) files.add(h.path);
  for (const f of files) {
    out.push({ id: `file:${f}`, label: f, auxiliaryData: { group: "Files", to: { screen: "map", path: folderOf(f), file: f } } });
  }
  return out;
}
