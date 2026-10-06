import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { count, type } from "./kit";

const RUN = "npx commitscape";
const SHARE = "npx commitscape share --yes";
const LINK = "https://commitscape.damnlabs.com/s/k3f9q2x7#0dbf…";
const TABS = ["Overview", "People", "Activity", "Map", "Commits"];
const WEEKS = [3, 5, 4, 7, 6, 9, 5, 8, 11, 7, 10, 12];
const PEAK = Math.max(...WEEKS);
const ROWS: { label: string; value?: number; text?: string; note?: string; bars?: boolean }[] = [
  { label: "Commits", value: 412, bars: true },
  { label: "People", value: 9, note: "4 Maintainers" },
  { label: "Bus Factor", value: 2, note: "src/engine/" },
  { label: "Top Hotspot", text: "src/engine/blame.rs", note: "2nd most changed of 40" },
];

/** The command line at work: a run draws a small Report in the terminal, then `share` prints a link. */
export function TerminalScene() {
  const ref = useScene(
    (tl, q) => {
      const runText = q("[data-run]")[0];
      const shareText = q("[data-share]")[0];
      const report = q("[data-report]")[0];
      const lines = q("[data-line]");
      const bars = q("[data-week]");
      const out = q("[data-out]");
      const first = q("[data-first]")[0];
      const second = q("[data-second]")[0];
      tl.set(first ?? {}, { opacity: 1 }, 0);
      tl.set(second ?? {}, { opacity: 0 }, 0);
      type(tl, runText, RUN, BEAT.short);
      tl.from(report ?? {}, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.base }, `+=${DURATION.base}`);
      tl.from(lines, { opacity: 0, x: -DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose }, "<");
      tl.from(bars, { scaleY: 0, duration: DURATION.base, ease: GSAP_EASE.out, stagger: STAGGER.tight }, "<");
      q("[data-tnum]").forEach((el, i) => {
        const v = ROWS.filter((r) => r.value !== undefined)[i]?.value ?? 0;
        count(tl, el, 0, v, "<", { duration: DURATION.scene });
      });
      tl.addLabel("ran", `+=${DURATION.scene}`);
      tl.to(first ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.set(second ?? {}, { opacity: 1 });
      type(tl, shareText, SHARE, ">");
      tl.from(out, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose * 3 }, `+=${DURATION.slow}`);
      tl.to(second ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
    },
    { still: "ran" },
  );
  return (
    <div ref={ref} className="terminal overflow-hidden rounded-xl border border-line shadow-lg">
      <div className="flex items-center gap-1.5 border-b terminal-line px-4 py-2.5">
        {["close", "min", "max"].map((c) => (
          <span key={c} className={`terminal-light terminal-${c} size-2.5 rounded-full`} />
        ))}
        <span className="terminal-dim ms-3 text-2xs">~/code/my-project</span>
      </div>
      <div className="relative h-66 font-mono text-xs leading-relaxed sm:h-72 sm:text-sm">
        <div data-first className="absolute inset-0 flex flex-col gap-3 p-4 sm:p-5">
          <div>
            <span className="terminal-go">$ </span>
            <span data-run>{RUN}</span>
            <span className="terminal-caret" />
          </div>
          <div data-report className="flex flex-col overflow-hidden rounded-md border terminal-line">
            <div className="flex gap-3 overflow-hidden border-b terminal-line px-3 py-1.5 text-2xs whitespace-nowrap terminal-dim">
              {TABS.map((t, i) => (
                <span key={t} className={i === 0 ? "terminal-go" : ""}>
                  {i + 1} {t}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1 px-3 py-2.5">
              <div data-line className="terminal-dim">
                my-project · last 90 days
              </div>
              {ROWS.map((r) => (
                <div key={r.label} data-line className="flex items-baseline gap-3 whitespace-nowrap">
                  <span className="terminal-soft w-26 flex-none">{r.label}</span>
                  {r.value !== undefined ? (
                    <span data-tnum className="terminal-bright w-8 flex-none text-end font-semibold tnum">
                      {r.value}
                    </span>
                  ) : (
                    <span className="terminal-path truncate">{r.text}</span>
                  )}
                  {r.bars && (
                    <span className="flex h-3 items-end gap-0.5">
                      {WEEKS.map((h, i) => (
                        <span key={i} data-week className="terminal-bar w-1.5 origin-bottom rounded-cell" style={{ height: `${(h / PEAK) * 100}%` }} />
                      ))}
                    </span>
                  )}
                  {r.note && <span className="terminal-dim truncate max-sm:hidden">{r.note}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div data-second className="absolute inset-0 flex flex-col gap-1.5 p-4 opacity-0 sm:p-5">
          <div>
            <span className="terminal-go">$ </span>
            <span data-share>{SHARE}</span>
            <span className="terminal-caret" />
          </div>
          <div data-out className="terminal-link truncate">
            {LINK}
          </div>
          <div data-out className="terminal-soft">
            It works in any browser and expires in 4 hours.
          </div>
        </div>
      </div>
    </div>
  );
}
