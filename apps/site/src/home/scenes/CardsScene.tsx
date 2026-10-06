import type { CSSProperties, ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { DEFAULT_STYLE, Face, Logo, lookOf, PRESETS, styleQuery, type Background, type CardStyle, type PresetId } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { DAN, levels } from "./data";
import { compact, point, press, whole } from "./kit";
import { Cursor, Mini, MiniHead } from "./parts";

type Theme = "light" | "dark";
type Look = { style: CardStyle; theme: Theme };
type Step = { target: string; look: Look };

const PRESET_IDS: PresetId[] = ["classic", "ocean", "sunset", "grape", "paper"];
const ACCENTS = ["#12b24a", "#2a78d6", "#7c5cff", "#f43f5e", "#eab308"];
const BACKS: Background[] = ["plain", "glow", "dots"];
const PINK = "#f43f5e";
const WEEKS = 26;
const CELLS = levels(WEEKS * 7, 5);

const FIRST: Look = { style: DEFAULT_STYLE, theme: "dark" };
const OCEAN: CardStyle = { ...DEFAULT_STYLE, preset: "ocean" };
const PINKED: CardStyle = { ...OCEAN, accent: PINK };
const DOTTED: CardStyle = { ...PINKED, background: "dots" };

const FULL: Step[] = [
  { target: "[data-preset=ocean]", look: { style: OCEAN, theme: "dark" } },
  { target: `[data-accent="${PINK}"]`, look: { style: PINKED, theme: "dark" } },
  { target: "[data-back=dots]", look: { style: DOTTED, theme: "dark" } },
  { target: "[data-mode=light]", look: { style: DOTTED, theme: "light" } },
  { target: "[data-copy]", look: { style: DOTTED, theme: "light" } },
  { target: "[data-preset=classic]", look: { style: DEFAULT_STYLE, theme: "light" } },
  { target: "[data-mode=dark]", look: FIRST },
];

const SMALL: Step[] = [
  { target: "[data-preset=ocean]", look: { style: OCEAN, theme: "dark" } },
  { target: "[data-preset=sunset]", look: { style: { ...DEFAULT_STYLE, preset: "sunset" }, theme: "dark" } },
  { target: "[data-preset=paper]", look: { style: { ...DEFAULT_STYLE, preset: "paper" }, theme: "light" } },
  { target: "[data-preset=classic]", look: FIRST },
];

function vars({ style, theme }: Look): Record<string, string> {
  const { t } = lookOf(theme, style);
  const ramp = t.ramp;
  return { "--c-bg": t.bg, "--c-text": t.text, "--c-muted": t.muted, "--c-accent": t.accent, "--c-border": t.border, "--c-l0": t.empty, "--c-l1": ramp[0], "--c-l2": ramp[1], "--c-l3": ramp[2], "--c-l4": ramp[3] };
}

function art({ style, theme }: Look) {
  const look = lookOf(theme, style);
  return { backgroundImage: look.backgroundImage ?? "none", backgroundSize: look.backgroundSize ?? "auto" };
}

function address({ style, theme }: Look) {
  const query = [theme === "dark" ? "theme=dark" : "", styleQuery(style)].filter(Boolean).join("&");
  return query ? `?${query}` : "";
}

function swatch(id: PresetId): CSSProperties {
  const p = PRESETS[id].dark;
  return { background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` };
}

function visible(q: (s: string) => Element[], selector: string) {
  return q(selector).find((el) => (el as HTMLElement).offsetParent !== null);
}

/** The Card studio at work: the cursor picks a preset, an accent, a background and a theme; the Card and its address follow. */
export function CardsScene() {
  const ref = useScene(
    (tl, q, root) => {
      const cursor = q("[data-cursor]")[0];
      const card = q("[data-card]")[0] as HTMLElement | undefined;
      const glow = q("[data-glow]")[0] as HTMLElement | undefined;
      const query = q("[data-query]")[0];
      const copy = q("[data-copy]")[0];
      const full = !!visible(q, "[data-accent]");
      const dress = (look: Look) => {
        if (!card) return;
        for (const [k, v] of Object.entries(vars(look))) card.style.setProperty(k, v);
        if (glow) Object.assign(glow.style, art(look));
        if (query) query.textContent = address(look).replaceAll("&", "\u200b&");
        const back = lookOf(look.theme, look.style).background;
        q("[data-preset]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-preset") === look.style.preset));
        q("[data-accent]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-accent") === look.style.accent));
        q("[data-back]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-back") === back));
        q("[data-mode]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-mode") === look.theme));
      };
      tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.5, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
      (full ? FULL : SMALL).forEach((step, i) => {
        const target = visible(q, step.target);
        if (!target) return;
        point(tl, cursor, target, root, i === 0 ? BEAT.base : `+=${BEAT.base}`);
        press(tl, cursor, target, ">");
        if (target === copy) {
          tl.call(() => copy?.toggleAttribute("data-on", true), undefined, ">");
          tl.call(() => copy?.toggleAttribute("data-on", false), undefined, `+=${BEAT.long}`);
          return;
        }
        tl.to(glow ?? {}, { opacity: 0, duration: DURATION.fast }, "<");
        tl.call(() => dress(step.look), undefined, ">");
        tl.to(glow ?? {}, { opacity: 1, duration: DURATION.slow }, ">");
      });
      tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.short}`);
    },
    { still: 0, repeatDelay: BEAT.base },
  );
  return (
    <div ref={ref} className="relative flex size-full flex-col items-center justify-center gap-3 lg:flex-row lg:gap-8">
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
