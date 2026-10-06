import { useEffect, useMemo, useRef } from "react";
import { CommandPalette, CommandPaletteInput } from "@astryxdesign/core/CommandPalette";
import type { SearchSource } from "@astryxdesign/core/Typeahead";
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { LookupRow, useLookupSource, type Item } from "#/lib/lookup";

/** The Site-wide search: people and repositories, recent visits, and a Versus with whoever is typed. */
export function SearchPalette({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "__root__" });
  const source = useLookupSource(user?.login ?? null);
  const items = useRef(new Map<string, string>());
  const local = useRouterState({ select: (s) => /^\/(gh|s)\//.test(s.location.pathname) });
  useEffect(() => {
    if (local) return;
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onOpenChange, local]);
  const remembering: SearchSource<Item> = useMemo(
    () => ({
      bootstrap: async () => {
        const list = await source.bootstrap();
        for (const i of list) if (i.auxiliaryData) items.current.set(i.id, i.auxiliaryData.to);
        return list;
      },
      search: async (q) => {
        const list = await source.search(q);
        for (const i of list) if (i.auxiliaryData) items.current.set(i.id, i.auxiliaryData.to);
        return list;
      },
    }),
    [source],
  );
  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Search people and repositories"
      searchSource={remembering}
      renderItem={(item, selected) => <LookupRow item={item} selected={selected} />}
      emptySearchText="Nobody by that name. Try a GitHub username, or owner/repo."
      onValueChange={(id) => {
        const to = items.current.get(id);
        onOpenChange(false);
        if (to) void navigate({ to: to as "/" });
      }}
      width={600}
      input={<CommandPaletteInput placeholder="Search people or repositories, or type owner/repo" />}
    />
  );
}
