import { Check } from "lucide-react";
import { BEAT, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { WORK } from "./data";
import { count, point, press, whole } from "./kit";
import { Cursor, Mini, MiniHead } from "./parts";

const TOTAL = WORK.reduce((n, w) => n + w.added, 0);
const EXPORTS = ["Markdown", "Link", "PDF"];

/** A month of merged pull requests checked off one by one, totalled, then saved as a PDF. */
export function WorkScene() {
  const ref = useScene(
    (tl, q, root) => {
      const cursor = q("[data-cursor]")[0];
      const ticks = q("[data-tick]");
      const rows = q("[data-item]");
      const pdf = q("[data-export=PDF]")[0];
      tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.3, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
      tl.from(rows, { opacity: 0.35, duration: DURATION.base, stagger: DURATION.slow }, BEAT.short);
      tl.from(ticks, { scale: 0, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: DURATION.slow }, BEAT.short);
      const reset = count(tl, q("[data-total]")[0], 0, TOTAL, BEAT.short, { duration: DURATION.slow * WORK.length, format: (v) => `+${whole(v)}`, suffix: " lines" });
      const n = count(tl, q("[data-count]")[0], 0, WORK.length, BEAT.short, { duration: DURATION.slow * WORK.length });
      point(tl, cursor, pdf, root, `+=${BEAT.short}`);
      press(tl, cursor, pdf, ">");
      tl.call(() => pdf?.toggleAttribute("data-on", true), undefined, ">");
      tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
      tl.addLabel("shown");
      tl.to([...ticks], { scale: 0, duration: DURATION.fast, stagger: STAGGER.tight, ease: GSAP_EASE.in }, `+=${BEAT.base}`);
      tl.to(rows, { opacity: 0.35, duration: DURATION.fast }, "<");
      tl.call(() => {
        reset();
        n();
        pdf?.toggleAttribute("data-on", false);
      });
    },
    { still: "shown" },
  );
  return (
    <div ref={ref} className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] overflow-hidden">
        <MiniHead
          title="Proof of Work · September"
          end={
            <span className="flex gap-1">
              {EXPORTS.map((e) => (
                <span key={e} data-export={e} className="rounded-[5px] border border-line px-1.5 py-px text-[0.6rem] transition-colors data-[on]:border-[var(--brand)] data-[on]:bg-brand-soft data-[on]:text-brand">
                  {e}
                </span>
              ))}
            </span>
          }
        />
        <ul className="m-0 flex list-none flex-col p-0">
          {WORK.map((w) => (
            <li key={w.title} data-item className="flex items-center gap-2.5 border-b border-line px-3.5 py-[7px]">
              <span className="relative flex size-[15px] flex-none items-center justify-center rounded-full border border-[var(--color-border-emphasized)]">
                <span data-tick className="absolute inset-[-1px] flex items-center justify-center rounded-full bg-brand text-[var(--color-background-body)]">
                  <Check size={9} strokeWidth={3.5} />
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[0.72rem] text-primary">{w.title}</span>
                <span className="text-[0.62rem] text-secondary">{w.repo}</span>
              </span>
              <span className="text-[0.66rem] text-added tnum">+{w.added}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-3.5 py-2 text-[0.68rem] text-secondary">
          <span>
            <span data-count className="font-semibold text-primary tnum">
              {WORK.length}
            </span>{" "}
            pull requests merged
          </span>
          <span data-total className="text-added tnum">
            +{whole(TOTAL)} lines
          </span>
        </div>
      </Mini>
      <Cursor />
    </div>
  );
}
