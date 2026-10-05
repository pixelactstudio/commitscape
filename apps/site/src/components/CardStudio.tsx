import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Check, Download, Link2, Moon, RotateCcw, Sun } from "lucide-react";
import { BACKGROUNDS, CORNERS, DEFAULT_STYLE, hexOf, lookOf, PRESETS, styleQuery, SWATCHES, type CardStyle, type PresetId } from "@commitscape/ui";
import { cardSrc, markdownOf } from "#/lib/markdown";
import { useToast } from "#/lib/toast";

/** One Card someone can pick in the studio; its url and link are addresses on the Site, without the origin. */
export type CardChoice = { id: string; title: string; about: string; url: string; width: number; height: number; link: string; share: string; alt: string; group?: string };

export type StudioState = { card: string; style: CardStyle; mode: "light" | "dark" };

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** An image that keeps showing the last one until the next has loaded, so changing it never flashes. */
export function SteadyImage({ src, alt, width, height, className = "", eager = false }: { src: string; alt: string; width: number; height: number; className?: string; eager?: boolean }) {
  const [shown, setShown] = useState(src);
  const wanted = useRef(src);
  const loading = src !== shown;
  useEffect(() => {
    if (src === shown) return;
    wanted.current = src;
    const img = new Image();
    img.onload = img.onerror = () => {
      if (wanted.current === src) setShown(src);
    };
    img.src = src;
  }, [src, shown]);
  return (
    <span className={`relative block ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={shown} alt={alt} width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async" className="block h-full w-full" />
      <span className={`pointer-events-none absolute end-2 top-2 rounded-full bg-[var(--color-background-popover)] p-1.5 shadow-[var(--shadow-low)] transition-opacity duration-200 ${loading ? "opacity-100" : "opacity-0"}`}>
        <Spinner size="sm" />
      </span>
    </span>
  );
}

/** Picks a Card and dresses it: a preset, an accent, a background, corners; then gives the README Markdown, links and images, all carrying the style. */
export function CardStudio({ choices, state, onChange, origin, pinned = true }: { choices: CardChoice[]; state: StudioState; onChange: (next: StudioState) => void; origin: string; pinned?: boolean }) {
  const choice = choices.find((c) => c.id === state.card) ?? choices[0];
  const query = useSettled(styleQuery(state.style), 220);
  const set = (style: Partial<CardStyle>) => onChange({ ...state, style: { ...state.style, ...style } });
  if (!choice) return null;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className={`flex min-w-0 flex-col gap-4 ${pinned ? "lg:sticky lg:top-20" : ""}`}>
        <div className="studio-stage relative flex min-h-[22rem] items-center justify-center overflow-hidden rounded-[var(--radius-container)] border border-line px-4 py-10 sm:px-10">
          <div className="absolute end-3 top-3 z-10">
            <SegmentedControl label="Preview in" size="sm" value={state.mode} onChange={(m) => onChange({ ...state, mode: m as "light" | "dark" })}>
              <SegmentedControlItem value="light" label="Light" icon={<Icon icon={Sun} size="sm" />} />
              <SegmentedControlItem value="dark" label="Dark" icon={<Icon icon={Moon} size="sm" />} />
            </SegmentedControl>
          </div>
          <div className="w-full drop-shadow-[0_24px_48px_rgb(0_0_0/0.28)]" style={{ maxWidth: Math.min(choice.width, 760) }}>
            <SteadyImage src={cardSrc(choice.url, "svg", state.mode, query)} alt={`${choice.alt}, ${state.mode}`} width={choice.width} height={choice.height} eager />
          </div>
        </div>
        <Outputs choice={choice} query={query} origin={origin} />
      </div>
      <div className="flex flex-col gap-4">
        <Picker choices={choices} value={choice.id} query={query} mode={state.mode} onPick={(card) => onChange({ ...state, card })} />
        <Styler style={state.style} mode={state.mode} set={set} reset={() => onChange({ ...state, style: DEFAULT_STYLE })} />
      </div>
    </div>
  );
}

function Picker({ choices, value, query, mode, onPick }: { choices: CardChoice[]; value: string; query: string; mode: "light" | "dark"; onPick: (id: string) => void }) {
  const groups = useMemo(() => {
    const out = new Map<string, CardChoice[]>();
    for (const c of choices) out.set(c.group ?? "Cards", [...(out.get(c.group ?? "Cards") ?? []), c]);
    return [...out.entries()];
  }, [choices]);
  if (choices.length < 2) return null;
  return (
    <section className="rounded-[var(--radius-container)] border border-line bg-surface p-4">
      <h2 className="m-0 mb-3 text-sm font-semibold">Card</h2>
      <div className="flex max-h-[26rem] flex-col gap-4 overflow-y-auto pe-1 [scrollbar-width:thin]">
        {groups.map(([group, list]) => (
          <div key={group} className="flex flex-col gap-2">
            {groups.length > 1 && <span className="text-xs font-medium text-secondary">{group}</span>}
            <div className="grid grid-cols-2 gap-2">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c.id)}
                  aria-pressed={c.id === value}
                  className={`group flex cursor-pointer flex-col gap-1.5 rounded-[var(--radius-element)] border bg-transparent p-1.5 text-start transition-colors ${c.id === value ? "border-[var(--color-accent)] ring-2 ring-[var(--brand-soft)]" : "border-line hover:border-strong"}`}
                >
                  <span className="flex h-16 items-center justify-center overflow-hidden rounded-md bg-[var(--color-background-body)]">
                    <img src={cardSrc(c.url, "svg", mode, query)} alt="" loading="lazy" className="max-h-14 max-w-[92%] rounded-[4px]" />
                  </span>
                  <span className="truncate px-0.5 text-xs font-medium text-primary">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Styler({ style, mode, set, reset }: { style: CardStyle; mode: "light" | "dark"; set: (s: Partial<CardStyle>) => void; reset: () => void }) {
  const accent = style.accent ?? PRESETS[style.preset][mode].accent;
  const changed = styleQuery(style) !== "";
  return (
    <section className="flex flex-col gap-5 rounded-[var(--radius-container)] border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-sm font-semibold">Style</h2>
        <Button label="Reset" variant="ghost" size="sm" icon={<Icon icon={RotateCcw} size="sm" />} onClick={reset} isDisabled={!changed} />
      </div>
      <Field label="Preset">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const p = PRESETS[id][mode];
            const look = lookOf(mode, { preset: id, accent: null, background: null, corner: null });
            return (
              <button
                key={id}
                type="button"
                aria-pressed={style.preset === id}
                onClick={() => set({ preset: id, accent: null, background: null })}
                className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-element)] border bg-transparent p-1 text-start ${style.preset === id ? "border-[var(--color-accent)] ring-2 ring-[var(--brand-soft)]" : "border-line hover:border-strong"}`}
              >
                <span className="flex h-11 flex-col justify-between rounded-md p-1.5" style={{ backgroundColor: p.bg, backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize, boxShadow: `inset 0 0 0 1px ${p.border}` }}>
                  <span className="h-1.5 w-8 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
                  <span className="flex items-end gap-0.5">
                    {[0.5, 0.9, 0.7].map((h) => (
                      <span key={h} className="w-2 rounded-t-[2px]" style={{ height: h * 14, background: p.accent }} />
                    ))}
                  </span>
                </span>
                <span className="px-0.5 text-[0.7rem] font-medium text-primary">{PRESETS[id].label}</span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Accent colour">
        <div className="flex flex-wrap items-center gap-1.5">
          {SWATCHES.map((s) => (
            <button key={s} type="button" aria-label={`Accent ${s}`} aria-pressed={style.accent === s} onClick={() => set({ accent: s })} className="grid size-7 cursor-pointer place-items-center rounded-full border-0 p-0" style={{ background: s, boxShadow: style.accent === s ? `0 0 0 2px var(--color-background-surface), 0 0 0 4px ${s}` : "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }}>
              {style.accent === s && <Check size={14} color="#fff" strokeWidth={3} />}
            </button>
          ))}
          <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-strong" title="Any colour" style={{ background: style.accent && !SWATCHES.includes(style.accent) ? style.accent : "conic-gradient(#f43f5e, #eab308, #22c55e, #0ea5e9, #8b5cf6, #f43f5e)" }}>
            <input type="color" value={accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any accent colour" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-secondary">#</span>
          <HexInput key={style.accent ?? "preset"} value={style.accent} placeholder={accent} onHex={(hex) => set({ accent: hex })} />
          {style.accent && <Button label="Preset's colour" variant="ghost" size="sm" onClick={() => set({ accent: null })} />}
        </div>
      </Field>
      <Field label="Background">
        <div className="grid grid-cols-3 gap-2">
          {BACKGROUNDS.map((b) => {
            const look = lookOf(mode, { ...style, background: b.id });
            const on = (style.background ?? PRESETS[style.preset].background) === b.id;
            return (
              <button key={b.id} type="button" aria-pressed={on} onClick={() => set({ background: b.id })} className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-element)] border bg-transparent p-1 ${on ? "border-[var(--color-accent)] ring-2 ring-[var(--brand-soft)]" : "border-line hover:border-strong"}`}>
                <span className="block h-9 rounded-md" style={{ backgroundColor: look.t.bg, backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize, boxShadow: `inset 0 0 0 1px ${look.t.border}` }} />
                <span className="text-[0.7rem] font-medium text-primary">{b.label}</span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Corners">
        <SegmentedControl label="Corners" size="sm" layout="fill" value={style.corner ?? "round"} onChange={(c) => set({ corner: c as CardStyle["corner"] })}>
          {CORNERS.map((c) => (
            <SegmentedControlItem key={c.id} value={c.id} label={c.label} />
          ))}
        </SegmentedControl>
      </Field>
    </section>
  );
}

function HexInput({ value, placeholder, onHex }: { value: string | null; placeholder: string; onHex: (hex: string) => void }) {
  const [typed, setTyped] = useState(value ?? "");
  return (
    <input
      value={typed.replace(/^#/, "")}
      placeholder={placeholder.replace(/^#/, "")}
      maxLength={6}
      spellCheck={false}
      aria-label="Accent colour as hex"
      onChange={(e) => {
        setTyped(e.target.value);
        const hex = hexOf(e.target.value);
        if (hex) onHex(hex);
      }}
      className="h-7 w-24 rounded-md border border-line bg-[var(--color-background-body)] px-2 font-mono text-xs text-primary uppercase outline-none focus:border-[var(--color-accent)]"
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-secondary">{label}</span>
      {children}
    </div>
  );
}

function Outputs({ choice, query, origin }: { choice: CardChoice; query: string; origin: string }) {
  const [tab, setTab] = useState("readme");
  const toast = useToast();
  const copy = (text: string, words: string) => void navigator.clipboard?.writeText(text).then(() => toast(words));
  const absolute = (u: string) => (u.startsWith("http") ? u : `${origin}${u}`);
  const url = absolute(choice.url);
  const link = absolute(choice.link);
  const markdown = markdownOf(url, choice.alt, link, query);
  return (
    <section className="rounded-[var(--radius-container)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <TabList value={tab} onChange={setTab} size="sm" role="tablist">
          <Tab value="readme" panelId="studio-output" label="README" />
          <Tab value="links" panelId="studio-output" label="Links" />
          <Tab value="post" panelId="studio-output" label="Post it" />
        </TabList>
        <div className="flex gap-1.5 pb-2">
          <Button label="PNG" size="sm" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={cardSrc(choice.url, "png", "light", query)} target="_blank" />
          <Button label="PNG, dark" size="sm" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={cardSrc(choice.url, "png", "dark", query)} target="_blank" />
        </div>
      </div>
      <div id="studio-output" role="tabpanel" className="border-t border-line p-4">
        {tab === "readme" && (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm text-secondary">Paste into a README. GitHub shows the dark Card to readers in dark mode, animated, and it refreshes every six hours.</p>
            <CodeBlock code={markdown} language="html" width="100%" size="sm" isWrapped onCopy={() => toast("Markdown copied")} />
          </div>
        )}
        {tab === "links" && (
          <div className="flex flex-col gap-2">
            {[
              ["The page it links to", absolute(choice.link)],
              ["The Card, light", absolute(cardSrc(choice.url, "svg", "light", query))],
              ["The Card, dark", absolute(cardSrc(choice.url, "svg", "dark", query))],
              ["As a PNG", absolute(cardSrc(choice.url, "png", "light", query))],
            ].map(([label, link]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-36 flex-none text-xs text-secondary">{label}</span>
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{link}</code>
                <Button label="Copy" isIconOnly size="sm" variant="ghost" icon={<Icon icon={Link2} size="sm" />} onClick={() => copy(link ?? "", "Link copied")} />
              </div>
            ))}
          </div>
        )}
        {tab === "post" && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-secondary">The post links to the page; X and LinkedIn show its preview image. Download the PNG to attach the Card itself.</p>
            <div className="flex flex-wrap gap-2">
              <Button label="Post on X" variant="primary" href={`https://x.com/intent/post?text=${encodeURIComponent(choice.share)}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" />
              <Button label="Share on LinkedIn" variant="secondary" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" />
              <Button label="Copy text and link" variant="ghost" onClick={() => copy(`${choice.share} ${link}`, "Copied")} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
