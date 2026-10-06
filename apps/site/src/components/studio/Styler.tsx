import { useState, type ReactNode } from "react";
import { Check, Pipette } from "lucide-react";
import { BACKGROUNDS, CORNERS, hexOf, lookOf, PRESETS, SWATCHES, type CardStyle, type PresetId } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";

type Props = { style: CardStyle; mode: "light" | "dark"; set: (s: Partial<CardStyle>) => void; compact?: boolean };

/** The style controls: a preset, an accent from the swatches or any colour, a background and corners. */
export function Styler({ style, mode, set, compact = false }: Props) {
  const own = PRESETS[style.preset][mode].accent;
  const accent = style.accent ?? own;
  const background = style.background ?? PRESETS[style.preset].background;
  const corner = style.corner ?? "round";
  const custom = style.accent !== null && !SWATCHES.includes(style.accent);
  return (
    <div className={`flex flex-col ${compact ? "gap-4" : "gap-5"}`}>
      <Group label="Preset" value={PRESETS[style.preset].label}>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const look = lookOf(mode, { preset: id, accent: null, background: null, corner: null });
            const p = look.t;
            return (
              <button key={id} type="button" aria-pressed={style.preset === id} onClick={() => set({ preset: id, accent: null, background: null })} className="studio-pick flex cursor-pointer flex-col gap-1.5 rounded-md border border-line bg-transparent p-1 text-start">
                <span className={`flex flex-col justify-between rounded-sm p-1.5 ${compact ? "h-9" : "h-12"}`} style={{ backgroundColor: p.bg, backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize, boxShadow: `inset 0 0 0 1px ${p.border}` }}>
                  <span className="h-1 w-8 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
                  <span className="flex items-end gap-0.5">
                    {[0.45, 0.9, 0.65].map((h) => (
                      <span key={h} className="w-2 rounded-t-cell" style={{ height: h * (compact ? 12 : 18), background: p.accent }} />
                    ))}
                  </span>
                </span>
                <span className="truncate px-0.5 text-2xs font-medium text-primary">{PRESETS[id].label}</span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group label="Accent" value={style.accent ? style.accent.toUpperCase() : "The preset's"}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Swatch colour={own} label="The preset's colour" on={style.accent === null} onPick={() => set({ accent: null })} ring />
          <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
          {SWATCHES.map((s) => (
            <Swatch key={s} colour={s} label={`Accent ${s}`} on={style.accent === s} onPick={() => set({ accent: s })} />
          ))}
          <label
            title="Any colour"
            className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
            style={{ background: custom ? accent : "conic-gradient(#f43f5e, #eab308, #22c55e, #0ea5e9, #8b5cf6, #f43f5e)", boxShadow: custom ? `0 0 0 2px var(--color-background-surface), 0 0 0 4px ${accent}` : undefined }}
          >
            <Pipette size={ICON.xs} color="#fff" strokeWidth={2.5} aria-hidden />
            <input type="color" value={accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any accent colour" />
          </label>
        </div>
        {!compact && (
          <div className="flex items-center gap-2">
            <span className="grid h-7 place-items-center rounded-sm border border-line bg-sunken px-2 font-mono text-2xs text-secondary">#</span>
            <HexInput key={style.accent ?? "preset"} value={style.accent} placeholder={accent} onHex={(hex) => set({ accent: hex })} />
          </div>
        )}
      </Group>
      <Group label="Background" value={BACKGROUNDS.find((b) => b.id === background)?.label}>
        <div className={`grid gap-2 ${compact ? "grid-cols-3 sm:grid-cols-6 md:grid-cols-3" : "grid-cols-3"}`}>
          {BACKGROUNDS.map((b) => {
            const look = lookOf(mode, { ...style, background: b.id });
            return (
              <button key={b.id} type="button" aria-pressed={background === b.id} onClick={() => set({ background: b.id })} className="studio-pick flex cursor-pointer flex-col gap-1.5 rounded-md border border-line bg-transparent p-1">
                <span className={`block rounded-sm ${compact ? "h-7" : "h-10"}`} style={{ backgroundColor: look.t.bg, backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize, boxShadow: `inset 0 0 0 1px ${look.t.border}` }} />
                <span className="truncate px-0.5 text-start text-2xs font-medium text-primary">{b.label}</span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group label="Corners" value={CORNERS.find((c) => c.id === corner)?.label}>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${CORNERS.length}, minmax(0, 1fr))` }}>
          {CORNERS.map((c) => (
            <button key={c.id} type="button" aria-pressed={corner === c.id} onClick={() => set({ corner: c.id })} className="studio-pick flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-transparent px-2 text-xs font-medium text-primary">
              <span aria-hidden className="size-3.5 border-s-2 border-t-2 border-current" style={{ borderTopLeftRadius: Math.round(c.radius * 0.5) }} />
              {c.label}
            </button>
          ))}
        </div>
      </Group>
    </div>
  );
}

function Swatch({ colour, label, on, onPick, ring = false }: { colour: string; label: string; on: boolean; onPick: () => void; ring?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onPick}
      className="grid size-7 cursor-pointer place-items-center rounded-full border-0 p-0 transition-transform duration-(--duration-fast) hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      style={{ background: ring ? `radial-gradient(circle, ${colour} 0 42%, transparent 46%), var(--color-background-surface)` : colour, boxShadow: on ? `0 0 0 2px var(--color-background-surface), 0 0 0 4px ${colour}` : ring ? `inset 0 0 0 2px ${colour}` : "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }}
    >
      {on && !ring && <Check size={ICON.sm} color="#fff" strokeWidth={3} aria-hidden />}
    </button>
  );
}

function HexInput({ value, placeholder, onHex }: { value: string | null; placeholder: string; onHex: (hex: string) => void }) {
  const [typed, setTyped] = useState(value ?? "");
  return (
    <input
      value={typed.replace(/^#/, "")}
      placeholder={placeholder.replace(/^#/, "")}
      maxLength={7}
      spellCheck={false}
      aria-label="Accent colour as hex"
      onChange={(e) => {
        setTyped(e.target.value);
        const hex = hexOf(e.target.value);
        if (hex) onHex(hex);
      }}
      className="h-7 w-28 rounded-sm border border-line bg-body px-2 font-mono text-2xs text-primary uppercase outline-none focus:border-brand"
    />
  );
}

function Group({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label">{label}</span>
        {value && <span className="truncate type-caption">{value}</span>}
      </div>
      {children}
    </div>
  );
}
