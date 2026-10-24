import type { CSSProperties, ReactNode } from "react";
import type { BranchState } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { grouped } from "../format";
import { noteOf, ORDER, STATES, TAGS } from "./states";

function Card({ colour, icon, title, count, note, pressed, onClick, className = "" }: { className?: string; colour: string; icon: ReactNode; title: string; count: ReactNode; note: ReactNode; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={{ "--state": colour } as CSSProperties}
      className={`press surface flex min-w-0 cursor-pointer flex-col items-stretch gap-1 px-4 py-3 text-start font-[inherit] transition-colors duration-(--duration-instant) hover:bg-hover aria-pressed:border-(--state) aria-pressed:bg-raised aria-pressed:shadow-ring-hover ${className}`}
    >
      <span className="flex items-center gap-2 type-label">
        <span className="inline-flex flex-none" style={{ color: colour }}>
          {icon}
        </span>
        <span className="truncate">{title}</span>
      </span>
      <span className="type-stat">{count}</span>
      <span className="type-caption min-h-[2.8em] text-pretty">{note}</span>
    </button>
  );
}

/** The branch states as cards that are also the filter, each with its count and what it counts; the tags card opens the releases. */
export function StateCards({ counts, active, tagsOpen, root, tags, newest, onState, onTags }: { counts: Record<BranchState, number>; active: BranchState | undefined; tagsOpen: boolean; root: string; tags: number; newest: string; onState: (state: BranchState | undefined) => void; onTags: () => void }) {
  return (
    <div className="@container">
      <div role="group" aria-label="Show branches in a state" className="grid grid-cols-2 gap-2 @xl:grid-cols-3 @[50rem]:grid-cols-5">
        {ORDER.map((state) => {
          const { Icon, title, colour } = STATES[state];
          return <Card key={state} colour={colour} icon={<Icon size={ICON.md} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />} title={title} count={grouped(counts[state])} note={noteOf(state, root)} pressed={!tagsOpen && active === state} onClick={() => onState(!tagsOpen && active === state ? undefined : state)} />;
        })}
        <Card className="col-span-2 @[50rem]:col-span-1" colour={TAGS.colour} icon={<TAGS.Icon size={ICON.md} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />} title={TAGS.title} count={grouped(tags)} note={newest} pressed={tagsOpen} onClick={onTags} />
      </div>
    </div>
  );
}
