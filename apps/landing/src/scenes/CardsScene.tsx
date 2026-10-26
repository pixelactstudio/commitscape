import type { CSSProperties, ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { PRESETS } from "@commitscape/ui/cards/style";
import { Face } from "@commitscape/ui/components/Face";
import { Logo } from "@commitscape/ui/components/Logo";
import { ICON } from "@commitscape/ui/design";
import { DURATION } from "@commitscape/ui/motion/constants";
import { ACCENTS, address, art, BACKS, CELLS, FIRST, PRESET_IDS, swatch, vars } from "./cards";
import { DAN } from "./data";
import { compact, whole } from "./format";
import { Cursor, Mini, MiniHead } from "./parts";

/** The Card studio at work: the cursor picks a preset, an accent, a background and a theme; the Card and its address follow. */
export function CardsScene() {
  return (
    <div data-scene="cards" className="relative flex size-full flex-col items-center justify-center gap-3 lg:flex-row lg:gap-8">
      <div data-card className="cards-mini relative w-full max-w-76 flex-none overflow-hidden rounded-xl border p-4 shadow-md" style={{ ...vars(FIRST), "--t": `${DURATION.slow}s` } as CSSProperties}>
        <span data-glow className="absolute inset-0" style={art(FIRST)} />
        <div className="relative flex items-center gap-2.5">
          <Face login={DAN.login} name={DAN.name} size={32} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">{DAN.name}</span>
            <span className="cards-mini-muted text-2xs">@{DAN.login}</span>
          </div>
          <span className="cards-mini-muted ms-auto flex items-center gap-1 text-2xs font-medium">
            <Logo size={ICON.xs} />
            commitscape
          </span>
        </div>
        <div className="relative mt-3 grid grid-cols-3 gap-2">
          {[
            [compact(DAN.lines), "lines still running"],
            [whole(DAN.merged), "pull requests merged"],
            [whole(DAN.reviews), "reviews given"],
          ].map(([v, l], i) => (
            <div key={l} className="flex flex-col gap-1">
              <span className={`type-stat-sm ${i === 0 ? "cards-mini-accent" : ""}`}>{v}</span>
              <span className="cards-mini-muted text-2xs">{l}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-3 grid grid-flow-col grid-rows-7 justify-between gap-0.5">
          {CELLS.map((v, i) => (
            <span key={i} className="cards-mini-cell size-2 rounded-cell" style={{ backgroundColor: `var(--c-l${v})` }} />
          ))}
        </div>
      </div>
      <Mini className="flex w-full max-w-88 min-w-0 flex-1 flex-col overflow-hidden max-lg:hidden">
        <MiniHead
          title="Card studio"
          end={
            <span className="flex rounded-sm bg-sunken p-0.5 text-2xs">
              {(["dark", "light"] as const).map((m) => (
                <span key={m} data-mode={m} data-on={m === "dark" ? "" : undefined} className="rounded-xs px-2 py-0.5 capitalize text-secondary data-[on]:bg-surface data-[on]:text-primary data-[on]:shadow-xs">
                  {m}
                </span>
              ))}
            </span>
          }
        />
        <Row label="Preset">
          {PRESET_IDS.map((id) => (
            <span key={id} data-preset={id} data-on={id === "classic" ? "" : undefined} title={PRESETS[id].label} className="size-5 rounded-full ring-offset-2 ring-offset-[var(--color-background-surface)] data-[on]:ring-2 data-[on]:ring-[var(--color-text-primary)]" style={swatch(id)} />
          ))}
        </Row>
        <Row label="Accent">
          {ACCENTS.map((c) => (
            <span key={c} data-accent={c} className="size-4 rounded-full ring-offset-2 ring-offset-[var(--color-background-surface)] data-[on]:ring-2 data-[on]:ring-[var(--color-text-primary)]" style={{ background: c }} />
          ))}
        </Row>
        <Row label="Background">
          {BACKS.map((b) => (
            <span key={b} data-back={b} data-on={b === "plain" ? "" : undefined} className="rounded-xs border border-line px-1.5 py-px text-2xs text-secondary capitalize data-[on]:border-brand-line data-[on]:bg-brand-soft data-[on]:text-brand">
              {b}
            </span>
          ))}
        </Row>
        <div className="flex items-start gap-2 px-4 py-2.5">
          <span className="line-clamp-2 min-w-0 flex-1 font-mono text-2xs break-normal text-secondary">
            totals.svg
            <span data-query className="text-primary">
              {address(FIRST).replaceAll("&", "\u200b&")}
            </span>
          </span>
          <span data-copy className="group/copy flex size-6 flex-none items-center justify-center rounded-sm border border-line text-secondary data-[on]:border-brand-line data-[on]:bg-brand-soft data-[on]:text-brand">
            <Copy size={ICON.xs} className="group-data-[on]/copy:hidden" />
            <Check size={ICON.xs} className="hidden group-data-[on]/copy:block" />
          </span>
        </div>
      </Mini>
      <div className="relative -mt-7 flex gap-1.5 rounded-full border border-line bg-surface p-1 shadow-md lg:hidden">
        {PRESET_IDS.map((id) => (
          <span key={id} data-preset={id} data-on={id === "classic" ? "" : undefined} title={PRESETS[id].label} className="size-5 rounded-full ring-offset-2 ring-offset-[var(--color-background-surface)] data-[on]:ring-2 data-[on]:ring-[var(--color-text-primary)]" style={swatch(id)} />
        ))}
      </div>
      <Cursor />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-line px-4">
      <span className="w-16 flex-none type-micro">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
    </div>
  );
}
