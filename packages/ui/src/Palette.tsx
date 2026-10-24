import { useMemo } from "react";
import { CommandPalette, CommandPaletteInput } from "@astryxdesign/core/CommandPalette";
import { File, Folder, GitCommitHorizontal, LayoutGrid } from "lucide-react";
import type { DataSource, MapLevel, People } from "@commitscape/data";
import { Face } from "./components/Face";
import { ICON } from "./design/tokens";
import { grouped } from "./format";
import { useSource } from "./data";
import { jumpSource, type Jump } from "./jump";
import { codeLink } from "./code/address";
import { useGitOptional } from "./git/source";
import { SCREENS, TITLES, type Route, type Screen } from "./route";
import { folderOf } from "./screens/props";

export function Palette({
  isOpen,
  onOpenChange,
  window,
  go,
  route,
  screens,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  window: string;
  go: (change: Partial<Route>) => void;
  route: Route;
  screens?: readonly Screen[];
}) {
  const source = useSource();
  const code = useGitOptional() !== null;
  const items = useMemo(() => (isOpen ? jumps(source, window, screens ?? SCREENS, code) : Promise.resolve([])), [isOpen, source, window, screens, code]);
  const searchSource = useMemo(() => jumpSource(items), [items]);
  const pick = (id: string) => {
    if (id.startsWith("commits:")) go({ screen: "commits", q: id.slice("commits:".length), id: undefined, file: undefined });
    else
      void items.then((list) => {
        const found = list.find((i) => i.id === id)?.auxiliaryData;
        if (found?.file) go(codeLink(route, found.file));
        else if (found) go(found.to);
      });
    onOpenChange(false);
  };
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
        label="Search this Report"
        input={<CommandPaletteInput label="Search this Report" placeholder="Search people, folders, files and commits" />}
        renderItem={(item) => <Entry item={item} />}
        searchSource={searchSource}
        emptySearchText="Nothing by that name in this Window"
        onValueChange={pick}
      />
    </div>
  );
}

function Entry({ item }: { item: Jump }) {
  const group = item.auxiliaryData?.group;
  const path = group === "Folders" || group === "Files";
  const icon = group === "People" ? <Face login={item.auxiliaryData?.login} name={item.label} size={20} decorative /> : group === "Folders" ? <Folder size={ICON.md} aria-hidden /> : group === "Files" ? <File size={ICON.md} aria-hidden /> : group === "Commits" ? <GitCommitHorizontal size={ICON.md} aria-hidden /> : <LayoutGrid size={ICON.md} aria-hidden />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex w-5 flex-none items-center justify-center text-secondary">{icon}</span>
      <span className={`min-w-0 truncate ${path ? "mono type-caption" : "type-ui"}`}>{item.label}</span>
      {item.auxiliaryData?.hint && <span className="ms-auto flex-none ps-3 type-caption tnum">{item.auxiliaryData.hint}</span>}
    </span>
  );
}

async function jumps(source: DataSource, window: string, screens: readonly Screen[], code: boolean): Promise<Jump[]> {
  const soft = <T,>(p: Promise<T>) => p.catch(() => null);
  const [people, map] = await Promise.all([soft(source.get<People>("/api/people", { window })), soft(source.get<MapLevel>("/api/map", { window }))]);
  const out: Jump[] = screens.map((s) => ({
    id: `screen:${s}`,
    label: TITLES[s],
    auxiliaryData: { group: "Screens", to: { screen: s, id: undefined, file: undefined } },
  }));
  for (const p of people?.people ?? []) {
    out.push({ id: `person:${p.person.id}`, label: p.person.name, auxiliaryData: { group: "People", to: { screen: "people", id: p.person.id }, login: p.person.login, hint: `${grouped(p.commits)} ${p.commits === 1 ? "commit" : "commits"}` } });
  }
  const files = new Set<string>();
  for (const b of map?.children ?? []) {
    for (const c of [b, ...b.inside]) {
      if (c.file) files.add(c.path);
      else out.push({ id: `folder:${c.path}`, label: c.path, auxiliaryData: { group: "Folders", to: { screen: "map", path: c.path, file: undefined } } });
    }
  }
  for (const f of files) {
    out.push({ id: `file:${f}`, label: f, auxiliaryData: { group: "Files", to: { screen: "map", path: folderOf(f), file: f }, ...(code ? { file: f } : {}) } });
  }
  return out;
}
