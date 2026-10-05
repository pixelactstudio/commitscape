import { useState } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Award, Check, Eye, Lock, Minus, Share2 } from "lucide-react";
import { ARCHETYPE_MINIMUM, ARCHETYPES, type Achievement, type Archetype, type ArchetypeCheck } from "@commitscape/data";
import { Panel } from "../kit/layout";

/** Their Archetype by its written rule, and a dialog with every rule, which they meet, and the numbers each was tried on. */
export function ArchetypePanel({ archetypes, complete, checks }: { archetypes: Archetype[]; complete: boolean; checks?: ArchetypeCheck[] }) {
  const [open, setOpen] = useState(false);
  const main = archetypes[0];
  return (
    <Panel
      title="Archetype"
      description="A label from a written rule over their numbers; never a guess"
      className="h-full [&>*]:h-full [&>*>*]:h-full"
      actions={<IconButton label="Every Archetype rule" tooltip="Every rule, and the numbers behind it" variant="secondary" size="sm" icon={<Icon icon={Eye} size="sm" />} onClick={() => setOpen(true)} />}
    >
      <div className="archetype-card relative flex min-h-44 flex-1 flex-col justify-end gap-2 overflow-hidden rounded-[var(--radius-element)] p-5">
        <span className="text-xs font-medium tracking-[0.12em] text-white/70 uppercase">{main ? "They are a" : "Not decided yet"}</span>
        <span className="text-[2rem] leading-none font-semibold tracking-[-0.03em] text-white">{main ? main.title : "No Archetype"}</span>
        <span className="text-sm text-pretty text-white/80">{main ? main.rule : `None of the rules fits yet. They need ${ARCHETYPE_MINIMUM} contributions, then each rule its own threshold.`}</span>
      </div>
      {(archetypes.length > 1 || !complete) && (
        <div className="flex flex-col gap-1">
          {archetypes.length > 1 && <p className="m-0 text-sm text-secondary">Also {archetypes.slice(1).map((a) => a.title).join(", ")}.</p>}
          {!complete && <p className="m-0 text-xs text-secondary">Some rules wait for their pull requests to be read.</p>}
        </div>
      )}
      {open && <RulesDialog open={open} onOpenChange={setOpen} archetypes={archetypes} checks={checks} />}
    </Panel>
  );
}

function RulesDialog({ open, onOpenChange, archetypes, checks }: { open: boolean; onOpenChange: (open: boolean) => void; archetypes: Archetype[]; checks?: ArchetypeCheck[] }) {
  const met = new Set(archetypes.map((a) => a.id));
  const main = archetypes[0]?.id;
  const byId = new Map((checks ?? []).map((c) => [c.id, c]));
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width="min(640px, 96vw)" maxHeight="90dvh" padding={5}>
      <DialogHeader title="Every Archetype rule" subtitle={`Tried in this order; the first one met is theirs. None applies below ${ARCHETYPE_MINIMUM} contributions.`} onOpenChange={onOpenChange} />
      <dl className="m-0 flex flex-col gap-1.5 pt-2">
        {ARCHETYPES.map((a, i) => {
          const yes = met.has(a.id);
          const check = byId.get(a.id);
          return (
            <div key={a.id} className={`grid grid-cols-[1.75rem_1fr] gap-x-3 gap-y-0.5 rounded-[var(--radius-element)] border px-3 py-2.5 ${a.id === main ? "border-[color-mix(in_oklab,var(--brand)_45%,transparent)] bg-[var(--brand-soft)]" : "border-line"}`}>
              <span className={`row-span-3 grid size-[28px] place-items-center rounded-full text-xs font-semibold ${yes ? "bg-brand text-[var(--color-background-body)]" : "bg-[var(--color-track)] text-secondary"}`} aria-label={yes ? "Met" : "Not met"}>
                {yes ? <Check size={15} strokeWidth={3} aria-hidden /> : <Minus size={14} aria-hidden />}
              </span>
              <dt className="flex flex-wrap items-center gap-2 font-semibold">
                <span className="text-xs font-normal text-secondary tnum">{i + 1}.</span>
                {a.title}
                {a.id === main && <span className="rounded-full bg-brand px-2 py-px text-[0.68rem] font-semibold text-[var(--color-background-body)]">theirs</span>}
                {yes && a.id !== main && <span className="rounded-full border border-line px-2 py-px text-[0.68rem] font-medium text-secondary">also met</span>}
              </dt>
              <dd className="m-0 text-sm text-pretty text-secondary">{a.rule}</dd>
              {check && <dd className="m-0 text-xs font-medium text-primary tnum">{check.numbers}</dd>}
            </div>
          );
        })}
      </dl>
    </Dialog>
  );
}

/** Every Achievement: reached ones in colour, each a Card away, the rest with what reaches them. */
export function AchievementsPanel({ achievements, onCard }: { achievements: Achievement[]; onCard?: (id: string) => void }) {
  const earned = achievements.filter((a) => a.earned);
  return (
    <Panel title="Achievements" description={`${earned.length} of ${achievements.length} reached`} className="h-full [&>*]:h-full">
      <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
        {achievements.map((a) => (
          <li key={a.id} className={`flex items-start gap-3 rounded-[var(--radius-element)] border p-3 ${a.earned ? "border-line bg-[var(--color-background-body)]" : "border-dashed border-line"}`}>
            <span className={`grid size-9 flex-none place-items-center rounded-full ${a.earned ? "medal-earned" : "bg-[var(--color-track)] text-secondary"}`}>{a.earned ? <Award size={17} aria-hidden /> : <Lock size={14} aria-hidden />}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold">{a.title}</span>
              <span className="text-xs text-pretty text-secondary">{a.earned ? [a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule : a.rule}</span>
            </span>
            {a.earned && onCard && <IconButton label={`Share “${a.title}” as a Card`} tooltip="Share as a Card" size="sm" variant="ghost" icon={<Icon icon={Share2} size="sm" />} onClick={() => onCard(a.id)} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Their Archetype beside every Achievement, the two the same height. */
export function TraitsPanel({ archetypes, achievements, complete, onCard, checks }: { archetypes: Archetype[]; achievements: Achievement[]; complete: boolean; onCard?: (id: string) => void; checks?: ArchetypeCheck[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <ArchetypePanel archetypes={archetypes} complete={complete} checks={checks} />
      <AchievementsPanel achievements={achievements} onCard={onCard} />
    </div>
  );
}
