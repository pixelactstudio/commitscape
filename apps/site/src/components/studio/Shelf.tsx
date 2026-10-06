import { useEffect, useMemo, useRef, useState } from "react";
import { Carousel, type CarouselHandle } from "@astryxdesign/core/Carousel";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { cardSrc } from "#/lib/markdown";
import type { CardChoice } from "./types";

type Props = { choices: CardChoice[]; value: string; query: string; mode: "light" | "dark"; onPick: (id: string) => void; layout?: "strip" | "grid" };

/** The Cards to choose from, large enough to read, in the chosen style and grouped by kind: a strip to scroll on the studio page, a grid in the Share dialog. */
export function Shelf({ choices, value, query, mode, onPick, layout = "strip" }: Props) {
  const groups = useMemo(() => {
    const out = new Map<string, CardChoice[]>();
    for (const c of choices) out.set(c.group ?? "Cards", [...(out.get(c.group ?? "Cards") ?? []), c]);
    return [...out.entries()];
  }, [choices]);
  const groupOf = (id: string) => choices.find((c) => c.id === id)?.group ?? groups[0]?.[0] ?? "Cards";
  const [group, setGroup] = useState(() => groupOf(value));
  const own = groupOf(value);
  useEffect(() => setGroup(own), [own]);
  const list = groups.find(([g]) => g === group)?.[1] ?? groups[0]?.[1] ?? [];
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<CarouselHandle>(null);
  const at = list.findIndex((c) => c.id === value);
  useEffect(() => {
    const box = root.current?.getBoundingClientRect();
    const tile = root.current?.querySelector(`[data-card="${CSS.escape(value)}"]`)?.getBoundingClientRect();
    if (!box || !tile || at < 0) return;
    if (tile.left < box.left || tile.right > box.right) handle.current?.scrollTo(at);
  }, [value, at, group]);
  if (choices.length < 2) return null;
  const tiles = list.map((c) => <Tile key={c.id} choice={c} on={c.id === value} src={cardSrc(c.url, "svg", mode, query)} onPick={onPick} grid={layout === "grid"} />);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.length > 1 && (
        <div className="flex min-w-0 items-center gap-3">
          <SegmentedControl label="Kind of Card" size="sm" layout={layout === "grid" ? "fill" : "hug"} value={group} onChange={setGroup}>
            {groups.map(([g, cards]) => (
              <SegmentedControlItem key={g} value={g} label={`${g} ${cards.length}`} />
            ))}
          </SegmentedControl>
        </div>
      )}
      {layout === "grid" ? (
        <div className="grid grid-cols-2 gap-2">{tiles}</div>
      ) : (
        <Carousel ref={root} handleRef={handle} aria-label="Cards to pick" gap={2} hasSnap>
          {tiles}
        </Carousel>
      )}
    </div>
  );
}

function Tile({ choice, on, src, onPick, grid }: { choice: CardChoice; on: boolean; src: string; onPick: (id: string) => void; grid: boolean }) {
  return (
    <button
      type="button"
      data-card={choice.id}
      aria-pressed={on}
      onClick={() => onPick(choice.id)}
      className={`studio-tile group/tile flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border border-line bg-surface p-1.5 text-start ${grid ? "w-full" : "w-60 sm:w-72"}`}
    >
      <span className={`studio-tile-well grid w-full place-items-center overflow-hidden rounded-lg px-3 py-2.5 ${grid ? "h-24" : "h-28 sm:h-36"}`}>
        <img src={src} alt="" width={choice.width} height={choice.height} loading="lazy" decoding="async" className="h-full w-full object-contain drop-shadow-md transition-transform duration-(--duration-base) ease-(--ease-out) group-hover/tile:scale-[1.04]" />
      </span>
      <span className="flex min-w-0 flex-col px-1.5 pb-1">
        <span title={choice.title} className="truncate text-sm font-medium text-primary">{choice.title}</span>
        {!grid && <span title={choice.about} className="truncate text-xs text-secondary">{choice.about}</span>}
      </span>
    </button>
  );
}
