import { useState } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Award, Check, Eye, Lock, Minus, Share2 } from "lucide-react";
import { ARCHETYPE_MINIMUM, ARCHETYPES, type Achievement, type Archetype, type ArchetypeCheck } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { Chip, Panel } from "../kit/layout";
import { meshFallback } from "../motion/mesh";
import { MeshGradient } from "../motion/MeshGradient";
import { ARCHETYPE_ICONS, ARCHETYPE_PALETTES } from "./icons";

/** Their Archetype as the hero of its own stage: its name and what it means, the numbers that met its rule as meters, and a dialog with every rule. */
export function ArchetypePanel({ archetypes, complete, checks }: { archetypes: Archetype[]; complete: boolean; checks?: ArchetypeCheck[] }) {
  const [open, setOpen] = useState(false);
  const main = archetypes[0];
  const closest = main ? null : [...(checks ?? [])].sort((a, b) => mean(b) - mean(a))[0];
  const shown = main ? checks?.find((c) => c.id === main.id) : closest;
  const Glyph = main ? ARCHETYPE_ICONS[main.id] : Award;
  const palette = ARCHETYPE_PALETTES[main?.id ?? "none"];
  return (
    <section aria-label="Archetype" className="archetype-card relative isolate flex h-full min-w-0 flex-col gap-5 overflow-hidden rounded-lg p-panel text-on-stage shadow-sm" style={{ background: meshFallback(palette) }}>
      <MeshGradient palette={palette} seed={main ? main.id.length : 3} />
      <Glyph aria-hidden size={176} strokeWidth={1.25} className="pointer-events-none absolute -end-8 -bottom-8 -z-10 text-on-stage opacity-10" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-semibold tracking-wide text-on-stage-2 uppercase">Archetype</span>
        <button type="button" onClick={() => setOpen(true)} aria-label="Every Archetype rule" title="Every rule, and the numbers behind it" className="archetype-button inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
          <Eye size={ICON.sm} aria-hidden /> Every rule
        </button>
      </div>
      <div className="flex items-start gap-4">
        <span className="archetype-tile grid size-14 flex-none place-items-center rounded-xl">
          <Glyph size={28} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-on-stage-2">{main ? "They are a" : "Not decided yet"}</span>
          <span className="type-title text-on-stage">{main ? main.title : "No Archetype"}</span>
        </div>
      </div>
      <p className="m-0 text-sm text-pretty text-on-stage-2">{main ? main.rule : `None of the rules fits yet. A rule is tried once they have ${ARCHETYPE_MINIMUM} contributions, each against its own threshold.`}</p>
      {shown && shown.evidence.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="text-2xs font-semibold tracking-wide text-on-stage-2 uppercase">{main ? "What made it" : `Closest: ${shown.title}`}</span>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shown.evidence.map((e) => (
              <li key={e.label} className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-on-stage-2">{e.label}</span>
                  <span className="flex-none font-semibold tnum text-on-stage">{e.value}</span>
                </span>
                <span role="meter" aria-label={`${e.label}: ${e.value}, needs ${e.goal}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(e.share * 100)} className="archetype-track block h-1.5 overflow-hidden rounded-full">
                  <span className={`block h-full rounded-full ${e.met ? "archetype-fill" : "archetype-fill-dim"}`} style={{ width: `${Math.max(3, e.share * 100)}%` }} />
                </span>
                <span className="flex items-center gap-1 text-2xs text-on-stage-2">
                  {e.met ? <Check size={ICON.xs} strokeWidth={3} aria-hidden /> : <Minus size={ICON.xs} aria-hidden />}
                  needs {e.goal}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(archetypes.length > 1 || !complete) && (
        <div className="mt-auto flex flex-col gap-2">
          {archetypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-on-stage-2">Also</span>
              {archetypes.slice(1).map((a) => {
                const Also = ARCHETYPE_ICONS[a.id];
                return (
                  <span key={a.id} className="archetype-chip inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium" title={a.rule}>
                    <Also size={ICON.xs} aria-hidden />
                    {a.title}
                  </span>
                );
              })}
            </div>
          )}
          {!complete && <p className="m-0 text-2xs text-on-stage-2">Some rules wait for their pull requests to be read.</p>}
        </div>
      )}
      {open && <RulesDialog open={open} onOpenChange={setOpen} archetypes={archetypes} checks={checks} />}
    </section>
  );
}

function mean(c: ArchetypeCheck): number {
  return c.evidence.length === 0 ? 0 : c.evidence.reduce((n, e) => n + e.share, 0) / c.evidence.length;
}

function RulesDialog({ open, onOpenChange, archetypes, checks }: { open: boolean; onOpenChange: (open: boolean) => void; archetypes: Archetype[]; checks?: ArchetypeCheck[] }) {
  const met = new Set(archetypes.map((a) => a.id));
  const main = archetypes[0]?.id;
  const byId = new Map((checks ?? []).map((c) => [c.id, c]));
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width="min(640px, 96vw)" maxHeight="90dvh" padding={5}>
      <DialogHeader title="Every Archetype rule" subtitle={`Tried in this order; the first one met is theirs. None applies below ${ARCHETYPE_MINIMUM} contributions.`} onOpenChange={onOpenChange} />
      <dl className="m-0 flex flex-col gap-2 pt-2">
        {ARCHETYPES.map((a, i) => {
          const yes = met.has(a.id);
          const check = byId.get(a.id);
          return (
            <div key={a.id} className={`grid grid-cols-[1.75rem_1fr] gap-x-3 gap-y-0.5 rounded-md border px-3 py-2.5 ${a.id === main ? "border-brand-line bg-brand-soft" : "border-line"}`}>
              <span className={`row-span-3 grid size-7 place-items-center rounded-full ${yes ? "bg-brand text-on-brand" : "bg-[var(--color-track)] text-secondary"}`} aria-label={yes ? "Met" : "Not met"}>
                {yes ? <Check size={ICON.sm} strokeWidth={3} aria-hidden /> : <Minus size={ICON.sm} aria-hidden />}
              </span>
              <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="type-micro tnum">{i + 1}.</span>
                {a.title}
                {a.id === main && <Chip tone="brand">theirs</Chip>}
                {yes && a.id !== main && <Chip tone="quiet">also met</Chip>}
              </dt>
              <dd className="m-0 type-caption text-pretty">{a.rule}</dd>
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
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {achievements.map((a) => (
          <li key={a.id} className={`flex items-start gap-3 rounded-md border p-3 ${a.earned ? "border-line bg-body" : "border-dashed border-line"}`}>
            <span className={`grid size-9 flex-none place-items-center rounded-full ${a.earned ? "medal-earned" : "bg-[var(--color-track)] text-secondary"}`}>{a.earned ? <Award size={ICON.md} aria-hidden /> : <Lock size={ICON.sm} aria-hidden />}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold">{a.title}</span>
              <span className="type-caption text-pretty">{a.earned ? [a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule : a.rule}</span>
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
    <div className="grid items-stretch gap-gutter lg:grid-cols-[1fr_2fr]">
      <ArchetypePanel archetypes={archetypes} complete={complete} checks={checks} />
      <AchievementsPanel achievements={achievements} onCard={onCard} />
    </div>
  );
}
