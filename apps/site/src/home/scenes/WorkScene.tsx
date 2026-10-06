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
      const total = q("[data-total]")[0];
      const many = q("[data-count]")[0];
      const lines = (v: number) => `+${whole(v)}`;
      tl.addLabel("shown", 0);
      tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.3, y: () => root.clientHeight * 0.95, opacity: 0 }, 0);
      tl.addLabel("out", BEAT.long);
      tl.call(() => pdf?.toggleAttribute("data-on", false), undefined, "out");
      tl.to(ticks, { scale: 0, duration: DURATION.fast, stagger: STAGGER.tight, ease: GSAP_EASE.in }, "out");
      tl.to(rows, { opacity: 0.35, duration: DURATION.fast }, "out");
      count(tl, total, TOTAL, 0, "out", { duration: DURATION.base, format: lines, suffix: " lines" });
      count(tl, many, WORK.length, 0, "out", { duration: DURATION.base });
      tl.addLabel("in", `out+=${DURATION.base + BEAT.short}`);
      tl.to(rows, { opacity: 1, duration: DURATION.base, stagger: DURATION.slow }, "in");
      tl.fromTo(ticks, { scale: 0 }, { scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: DURATION.slow, immediateRender: false }, "in");
      count(tl, total, 0, TOTAL, "in", { duration: DURATION.slow * WORK.length, format: lines, suffix: " lines", prime: false });
      count(tl, many, 0, WORK.length, "in", { duration: DURATION.slow * WORK.length, prime: false });
      point(tl, cursor, pdf, root, `+=${BEAT.short}`);
      press(tl, cursor, pdf, ">");
      tl.call(() => pdf?.toggleAttribute("data-on", true), undefined, ">");
      tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
      tl.to({}, { duration: BEAT.hold });
    },
    { still: "shown", repeatDelay: 0 },
  );
  return (
    <div ref={ref} className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] overflow-hidden">
        <MiniHead
          title="Proof of Work · September"
          end={
            <span className="flex gap-1">
              {EXPORTS.map((e) => (
                <span key={e} data-export={e} className="rounded-xs border border-line px-1.5 py-px text-2xs transition-colors data-[on]:border-brand-line data-[on]:bg-brand-soft data-[on]:text-brand">
                  {e}
                </span>
              ))}
            </span>
          }
        />
        <ul className="m-0 flex list-none flex-col p-0">
          {WORK.map((w) => (
            <li key={w.title} data-item className="flex items-center gap-2.5 border-b border-line px-4 py-1.5">
              <span className="relative flex size-4 flex-none items-center justify-center rounded-full border border-line-strong">
                <span data-tick className="absolute inset-[-1px] flex items-center justify-center rounded-full bg-brand text-on-brand">
                  <Check size={9} strokeWidth={3.5} />
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-primary">{w.title}</span>
                <span className="type-micro">{w.repo}</span>
              </span>
              <span className="text-2xs text-added tnum">+{w.added}</span>
            </li>
          ))}
        </ul>
        <div className="flex h-10 items-center justify-between px-4 type-micro">
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
