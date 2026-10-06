import { useState, type CSSProperties, type ReactNode } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Check } from "lucide-react";
import { BACKGROUNDS, CORNERS, hexOf, lookOf, PRESETS, SWATCHES, type CardStyle, type Corner, type PresetId } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";

type Props = { style: CardStyle; mode: "light" | "dark"; set: (s: Partial<CardStyle>) => void };

/** The style controls: a preset, an accent from the swatches or any colour, a background and corners, each drawn the way it will look on the Card. */
export function Style({ style, mode, set }: Props) {
  const own = PRESETS[style.preset][mode].accent;
  const accent = style.accent ?? own;
  const background = style.background ?? PRESETS[style.preset].background;
  const corner = style.corner ?? "round";
  return (
    <div className="flex flex-col divide-y divide-line">
      <Group label="Preset" value={PRESETS[style.preset].label} first>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const look = lookOf(mode, { preset: id, accent: null, background: null, corner: null });
            return (
              <Tile key={id} on={style.preset === id} onPick={() => set({ preset: id, accent: null, background: null })} paint={paint(look)} tick={look.t.accent} className="h-[4.5rem]">
                <span aria-hidden className="flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ background: look.t.accent }} />
                  <span className="h-1 w-7 rounded-full opacity-40" style={{ background: look.t.text }} />
                </span>
                <span className="flex items-end justify-between gap-1">
                  <span className="truncate text-xs font-semibold" style={{ color: look.t.text }}>
                    {PRESETS[id].label}
                  </span>
                  <span aria-hidden className="flex flex-none items-end gap-px">
                    {[0.5, 1, 0.7].map((h) => (
                      <span key={h} className="w-1.5 rounded-t-[2px]" style={{ height: h * 14, background: look.t.accent }} />
                    ))}
                  </span>
                </span>
              </Tile>
            );
          })}
        </div>
      </Group>
      <Group label="Accent" value={style.accent ? style.accent.toUpperCase() : "The preset's"}>
        <div className="grid grid-cols-6 justify-items-center gap-y-2.5">
          <Swatch colour={own} label="The preset's colour" on={style.accent === null} onPick={() => set({ accent: null })} ring />
          {SWATCHES.map((s) => (
            <Swatch key={s} colour={s} label={`Accent ${s}`} on={style.accent === s} onPick={() => set({ accent: s })} />
          ))}
          <label
            title="Any colour"
            className="studio-dot relative size-9 cursor-pointer rounded-full focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
            style={{ background: "conic-gradient(from 90deg, #f43f5e, #eab308, #22c55e, #0ea5e9, #8b5cf6, #f43f5e)" }}
          >
            <input type="color" value={accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Any accent colour" />
          </label>
        </div>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-sunken ps-1.5 pe-3 focus-within:border-brand">
          <span aria-hidden className="size-7 flex-none rounded-md" style={{ background: accent, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }} />
          <span aria-hidden className="font-mono text-sm text-secondary">#</span>
          <HexInput key={style.accent ?? "preset"} value={style.accent} placeholder={accent} onHex={(hex) => set({ accent: hex })} />
        </div>
      </Group>
      <Group label="Background" value={BACKGROUNDS.find((b) => b.id === background)?.label}>
        <div className="grid grid-cols-3 gap-2">
          {BACKGROUNDS.map((b) => {
            const look = lookOf(mode, { ...style, background: b.id });
            return (
              <Tile key={b.id} on={background === b.id} onPick={() => set({ background: b.id })} paint={paint(look)} tick={look.t.accent} className="h-16 justify-end">
                <span className="truncate text-xs font-semibold" style={{ color: look.t.text }}>
                  {b.label}
                </span>
              </Tile>
            );
          })}
        </div>
      </Group>
      <Group label="Corners" value={CORNERS.find((c) => c.id === corner)?.label}>
        <SegmentedControl label="Corners" layout="fill" value={corner} onChange={(c) => set({ corner: c as Corner })}>
          {CORNERS.map((c) => (
            <SegmentedControlItem key={c.id} value={c.id} label={c.label} />
          ))}
        </SegmentedControl>
      </Group>
    </div>
  );
}

const paint = (look: ReturnType<typeof lookOf>): CSSProperties => ({ backgroundColor: look.t.bg, backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize, boxShadow: `inset 0 0 0 1px ${look.t.border}` });

function Tile({ on, onPick, paint, tick, className, children }: { on: boolean; onPick: () => void; paint: CSSProperties; tick: string; className: string; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className={`studio-swatch relative flex min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-lg border-0 p-2 text-start ${className}`} style={paint}>
      {children}
      {on && (
        <span aria-hidden className="absolute end-1.5 top-1.5 grid size-4 place-items-center rounded-full" style={{ background: tick }}>
          <Check size={10} strokeWidth={3.5} color="#fff" />
        </span>
      )}
    </button>
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
      className="studio-dot grid size-9 cursor-pointer place-items-center rounded-full border-0 p-0"
      style={{ background: ring ? `radial-gradient(circle, ${colour} 0 40%, transparent 44%)` : colour, boxShadow: ring ? `inset 0 0 0 2px ${colour}` : "inset 0 0 0 1px rgb(0 0 0 / 0.12)", ["--dot" as string]: colour }}
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
      className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-primary uppercase outline-none placeholder:text-secondary"
    />
  );
}

function Group({ label, value, first = false, children }: { label: string; value?: ReactNode; first?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-3 ${first ? "pb-5" : "py-5 last:pb-0"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 type-label">{label}</h3>
        {value && <span className="truncate type-caption">{value}</span>}
      </div>
      {children}
    </div>
  );
}
