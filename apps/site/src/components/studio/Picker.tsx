import { useMemo, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { cardSrc } from "#/lib/markdown";
import type { CardChoice } from "./types";

/** The Cards to choose from, as thumbnails in the chosen style, grouped by kind. */
export function Picker({ choices, value, query, mode, onPick }: { choices: CardChoice[]; value: string; query: string; mode: "light" | "dark"; onPick: (id: string) => void }) {
  const groups = useMemo(() => {
    const out = new Map<string, CardChoice[]>();
    for (const c of choices) out.set(c.group ?? "Cards", [...(out.get(c.group ?? "Cards") ?? []), c]);
    return [...out.entries()];
  }, [choices]);
  const [group, setGroup] = useState(() => choices.find((c) => c.id === value)?.group ?? groups[0]?.[0] ?? "Cards");
  if (choices.length < 2) return null;
  const list = groups.find(([g]) => g === group)?.[1] ?? groups[0]?.[1] ?? [];
  return (
    <div className="flex flex-col gap-3">
      {groups.length > 1 && (
        <SegmentedControl label="Kind of Card" size="sm" layout="fill" value={group} onChange={setGroup}>
          {groups.map(([g]) => (
            <SegmentedControlItem key={g} value={g} label={g} />
          ))}
        </SegmentedControl>
      )}
      <div className="grid grid-cols-3 gap-2">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)} aria-pressed={c.id === value} className="studio-pick flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-md border border-line bg-transparent p-1.5 text-start">
            <span className="block aspect-[3/2] overflow-hidden rounded-sm bg-sunken p-1.5">
              <img src={cardSrc(c.url, "svg", mode, query)} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain drop-shadow-sm" />
            </span>
            <span title={c.title} className="truncate px-0.5 text-2xs font-medium text-primary">{c.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
