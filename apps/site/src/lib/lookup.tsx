import { useMemo, useRef, useState } from "react";
import type { SearchableItem, SearchSource } from "@astryxdesign/core/Typeahead";
import { BookMarked, CornerDownLeft, Search, Swords, User } from "lucide-react";
import { parseTarget } from "@commitscape/data";
import { avatarUrl } from "@commitscape/ui";
import { search } from "#/functions/search";
import { recent, type Visit } from "#/lib/recent";

export type Item = SearchableItem<{ group: string; to: string; hint?: string; face?: string | null; icon?: "person" | "repo" | "versus" | "search" }>;

const EXAMPLES: Visit[] = [
  { kind: "person", id: "gaearon" },
  { kind: "person", id: "torvalds" },
  { kind: "person", id: "sindresorhus" },
  { kind: "repo", id: "react/react" },
];

function visitItem(v: Visit, group: string): Item {
  return v.kind === "person"
    ? { id: `${group}:u:${v.id}`, label: v.id, auxiliaryData: { group, to: `/u/${v.id}`, hint: "Profile", face: v.id, icon: "person" } }
    : { id: `${group}:gh:${v.id}`, label: v.id, auxiliaryData: { group, to: `/gh/${v.id}`, hint: "Repository", face: v.id.split("/")[0], icon: "repo" } };
}

/** Where someone might want to go from what they typed: the person or repository itself, a Versus, then matches on GitHub. */
export function useLookupSource(me: string | null): SearchSource<Item> {
  const last = useRef(0);
  return useMemo(
    () => ({
      bootstrap: () => {
        const mine: Item[] = me ? [{ id: "me", label: "Your Profile", auxiliaryData: { group: "You", to: `/u/${me}`, hint: `@${me}`, face: me, icon: "person" } }] : [];
        const seen = recent().slice(0, 5);
        return [...mine, ...seen.map((v) => visitItem(v, "Recent")), ...EXAMPLES.filter((e) => !seen.some((s) => s.id === e.id)).map((v) => visitItem(v, "Try"))];
      },
      search: async (query: string) => {
        const q = query.trim();
        const target = parseTarget(q);
        const direct: Item[] = [];
        if (target?.kind === "person") {
          direct.push({ id: `go:u:${target.login}`, label: `@${target.login}`, auxiliaryData: { group: "Go to", to: `/u/${target.login}`, hint: "Open Profile", face: target.login, icon: "person" } });
          if (me && me.toLowerCase() !== target.login.toLowerCase()) direct.push({ id: `go:vs:${target.login}`, label: `You versus @${target.login}`, auxiliaryData: { group: "Go to", to: `/vs/${me}/${target.login}`, hint: "Compare", icon: "versus" } });
        }
        if (target?.kind === "repository") direct.push({ id: `go:gh:${target.owner}/${target.name}`, label: `${target.owner}/${target.name}`, auxiliaryData: { group: "Go to", to: `/gh/${target.owner}/${target.name}`, hint: "Open repository", face: target.owner, icon: "repo" } });
        if (q.length < 2) return direct;
        const ticket = ++last.current;
        await new Promise((r) => setTimeout(r, 180));
        if (ticket !== last.current) return direct;
        const found = await search({ data: { q } }).catch(() => ({ people: [], repositories: [] }));
        const people: Item[] = found.people
          .filter((p) => !direct.some((d) => d.id === `go:u:${p.login}`))
          .map((p) => ({ id: `u:${p.login}`, label: p.login, auxiliaryData: { group: "People on GitHub", to: `/u/${p.login}`, hint: p.organization ? "Organization" : "Profile", face: p.login, icon: "person" } }));
        const repos: Item[] = found.repositories.map((r) => ({
          id: `gh:${r.owner}/${r.name}`,
          label: `${r.owner}/${r.name}`,
          auxiliaryData: { group: "Repositories", to: `/gh/${r.owner}/${r.name}`, hint: `${r.stars.toLocaleString("en-US")} stars${r.language ? ` · ${r.language}` : ""}`, face: r.owner, icon: "repo" },
        }));
        return [...direct, ...people, ...repos];
      },
    }),
    [me],
  );
}

/** One suggestion: a face, a name and what opening it does. */
export function LookupRow({ item, selected }: { item: Item; selected: boolean }) {
  const a = item.auxiliaryData;
  const Glyph = a?.icon === "versus" ? Swords : a?.icon === "repo" ? BookMarked : a?.icon === "search" ? Search : User;
  const [broken, setBroken] = useState(false);
  return (
    <span className="flex w-full min-w-0 items-center gap-3 py-0.5">
      {a?.face && !broken ? (
        <img src={avatarUrl(a.face, 24)} alt="" width={24} height={24} onError={() => setBroken(true)} className={`size-6 flex-none bg-muted ${a.icon === "repo" ? "rounded-md" : "rounded-full"}`} />
      ) : (
        <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-secondary">
          <Glyph size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
      {a?.hint && <span className="flex-none text-2xs text-secondary">{a.hint}</span>}
      <CornerDownLeft size={14} className={`flex-none text-secondary transition-opacity ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
    </span>
  );
}

