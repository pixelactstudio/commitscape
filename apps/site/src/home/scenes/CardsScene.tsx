import type { CSSProperties } from "react";
import { Check, Copy } from "lucide-react";
import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { DEFAULT_STYLE, Face, Logo, lookOf, PRESETS, styleQuery, type CardStyle, type PresetId } from "@commitscape/ui";
import { DAN } from "./data";
import { compact, point, press, whole } from "./kit";
import { Cursor } from "./parts";

type Step = { style: CardStyle; theme: "light" | "dark" };

const SHOWN: PresetId[] = ["classic", "ocean", "sunset", "grape", "paper"];
const ACCENTS = ["#12b24a", "#7c5cff", "#f43f5e", "#eab308"];
const PINK = "#f43f5e";

const STEPS: { target: string; step: Step }[] = [
  { target: "[data-preset=ocean]", step: { style: { ...DEFAULT_STYLE, preset: "ocean" }, theme: "dark" } },
  { target: `[data-accent="${PINK}"]`, step: { style: { ...DEFAULT_STYLE, preset: "ocean", accent: PINK }, theme: "dark" } },
  { target: "[data-preset=paper]", step: { style: { ...DEFAULT_STYLE, preset: "paper" }, theme: "light" } },
];

const FIRST: Step = { style: DEFAULT_STYLE, theme: "dark" };

function vars({ style, theme }: Step): Record<string, string> {
  const look = lookOf(theme, style);
  return { "--c-bg": look.t.bg, "--c-text": look.t.text, "--c-muted": look.t.muted, "--c-accent": look.t.accent, "--c-border": look.t.border };
}

function art({ style, theme }: Step) {
  const look = lookOf(theme, style);
  return { backgroundImage: look.backgroundImage ?? "none", backgroundSize: look.backgroundSize ?? "auto" };
}

function swatch(id: PresetId): CSSProperties {
  const p = PRESETS[id].dark;
  return { background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` };
}

/** The Card studio at work: the cursor picks presets and an accent, the Card changes colour, and the Markdown follows. */
export function CardsScene() {
  const ref = useScene(
    (tl, q, root) => {
      const cursor = q("[data-cursor]")[0];
      const card = q("[data-card]")[0] as HTMLElement | undefined;
      const glow = q("[data-glow]")[0] as HTMLElement | undefined;
      const query = q("[data-query]")[0];
      const copy = q("[data-copy]")[0];
      const wide = window.matchMedia("(min-width: 40rem)").matches;
      const dress = (s: Step) => {
        if (!card) return;
        for (const [k, v] of Object.entries(vars(s))) card.style.setProperty(k, v);
        if (glow) Object.assign(glow.style, art(s));
        if (query) query.textContent = styleQuery(s.style) || "preset=classic";
        q("[data-preset]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-preset") === s.style.preset));
        q("[data-accent]").forEach((el) => el.toggleAttribute("data-on", el.getAttribute("data-accent") === s.style.accent));
      };
      const pick = (target: Element | undefined, s: Step, at: string | number) => {
        point(tl, cursor, target, root, at);
        press(tl, cursor, target, ">");
        tl.to(glow ?? {}, { opacity: 0, duration: DURATION.fast }, "<");
        tl.call(() => dress(s), undefined, ">");
        tl.to(glow ?? {}, { opacity: 1, duration: DURATION.slow }, ">");
      };
      tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.5, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
      STEPS.filter((s) => wide || !s.target.startsWith("[data-accent")).forEach((s, i) => pick(q(s.target)[0], s.step, i === 0 ? BEAT.short : `+=${BEAT.base}`));
      if (wide && copy) {
        point(tl, cursor, copy, root, `+=${BEAT.base}`);
        press(tl, cursor, copy, ">");
        tl.call(() => copy.toggleAttribute("data-on", true), undefined, ">");
        tl.call(() => copy.toggleAttribute("data-on", false), undefined, `+=${BEAT.long}`);
      }
      pick(q("[data-preset=classic]")[0], FIRST, `+=${BEAT.base}`);
      tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.short}`);
    },
    { still: 0 },
  );
  const first = vars(FIRST) as CSSProperties;
  return (
    <div ref={ref} className="relative flex size-full items-center justify-center gap-5 sm:gap-8">
      <div data-card className="cards-mini relative w-full max-w-[18.5rem] flex-none max-sm:-mt-12 overflow-hidden rounded-[16px] border p-4 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.55)]" style={{ ...first, "--t": `${DURATION.slow}s` } as CSSProperties}>
        <span data-glow className="absolute inset-0" style={art(FIRST)} />
        <div className="relative flex items-center gap-2.5">
          <Face login={DAN.login} name={DAN.name} size={32} />
          <div className="flex flex-col leading-tight">
            <span className="text-[0.85rem] font-semibold">{DAN.name}</span>
            <span className="cards-mini-muted text-[0.7rem]">@{DAN.login}</span>
          </div>
        </div>
        <div className="relative mt-3.5 grid grid-cols-3 gap-2">
          {[
            [compact(DAN.lines), "lines still running"],
            [whole(DAN.merged), "pull requests merged"],
            [whole(DAN.reviews), "reviews given"],
          ].map(([v, l], i) => (
            <div key={l} className="flex flex-col gap-0.5">
              <span className={`text-[1.05rem] leading-none font-semibold tracking-[-0.03em] tnum ${i === 0 ? "cards-mini-accent" : ""}`}>{v}</span>
              <span className="cards-mini-muted text-[0.6rem] leading-snug">{l}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-3.5 flex items-center gap-1.5 text-[0.62rem] font-medium">
          <Logo size={14} />
          <span className="cards-mini-muted">commitscape</span>
        </div>
      </div>
      <div className="flex w-[13.5rem] flex-none flex-col gap-3 max-sm:absolute max-sm:bottom-3 max-sm:w-auto">
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.66rem] text-secondary max-sm:hidden">Preset</span>
          <div className="flex gap-1.5 rounded-full border border-line bg-[var(--color-background-surface)] p-1 sm:w-fit">
            {SHOWN.map((id) => (
              <span key={id} data-preset={id} data-on={id === "classic" ? "" : undefined} title={PRESETS[id].label} className="size-[22px] rounded-full ring-offset-2 ring-offset-[var(--color-background-surface)] data-[on]:ring-2 data-[on]:ring-[var(--color-text-primary)]" style={swatch(id)} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 max-sm:hidden">
          <span className="text-[0.66rem] text-secondary">Accent</span>
          <div className="flex gap-1.5">
            {ACCENTS.map((c) => (
              <span key={c} data-accent={c} className="size-[18px] rounded-full ring-offset-2 ring-offset-[var(--color-background-body)] data-[on]:ring-2 data-[on]:ring-[var(--color-text-primary)]" style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-[10px] border border-line bg-[var(--color-background-surface)] py-1.5 ps-2.5 pe-1.5 max-sm:hidden">
          <span className="min-w-0 flex-1 truncate font-mono text-[0.62rem] text-secondary">
            totals.svg?<span data-query className="text-primary">preset=classic</span>
          </span>
          <span data-copy className="group/copy flex size-[22px] flex-none items-center justify-center rounded-[6px] text-secondary data-[on]:bg-brand-soft data-[on]:text-brand">
            <Copy size={12} className="group-data-[on]/copy:hidden" />
            <Check size={12} className="hidden group-data-[on]/copy:block" />
          </span>
        </div>
      </div>
      <Cursor />
    </div>
  );
}
