import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { count, type } from "./kit";

const RUN = "npx commitscape";
const LINK = "https://commitscape.damnlabs.com/s/k3f9q2x7#0dbf…";
const COMMITS = 412;
const TOLD = [
  "This uploads my-project's Report to commitscape.damnlabs.com.",
  "  It holds file paths, people's names and GitHub logins, and commit subjects. No email addresses.",
  "  It is locked with a key only the link holds, so the Site cannot read it.",
  "  The link works for 4 hours.",
];

/** The command line at work: a run asks before it uploads, reads the history, then prints a link and opens it. */
export function TerminalScene() {
  const ref = useScene(
    (tl, q) => {
      const runText = q("[data-run]")[0];
      const told = q("[data-told]");
      const ask = q("[data-ask]")[0];
      const read = q("[data-read]")[0];
      const done = q("[data-done]")[0];
      const out = q("[data-out]");
      const first = q("[data-first]")[0];
      const second = q("[data-second]")[0];
      tl.set(first ?? {}, { opacity: 1 }, 0);
      tl.set(second ?? {}, { opacity: 0 }, 0);
      type(tl, runText, RUN, BEAT.short);
      tl.from(told, { opacity: 0, x: -DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose }, `+=${DURATION.base}`);
      tl.from(ask ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.short}`);
      tl.from(read ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.hold}`);
      count(tl, done, 0, COMMITS, "<", { duration: DURATION.scene });
      tl.addLabel("ran", `+=${DURATION.scene}`);
      tl.to(first ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.set(second ?? {}, { opacity: 1 });
      tl.from(out, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose * 3 }, `+=${DURATION.base}`);
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
        <div data-first className="absolute inset-0 flex flex-col gap-1.5 p-4 sm:p-5">
          <div>
            <span className="terminal-go">$ </span>
            <span data-run>{RUN}</span>
            <span className="terminal-caret" />
          </div>
          {TOLD.map((line) => (
            <div key={line} data-told className={`truncate ${line.startsWith(" ") ? "terminal-dim" : "terminal-soft"}`}>
              {line}
            </div>
          ))}
          <div data-ask className="terminal-bright">
            Upload it? [Y/n] <span className="terminal-go">⏎</span>
          </div>
          <div data-read className="terminal-dim whitespace-nowrap">
            indexing history: <span data-done className="terminal-bright tnum">{COMMITS}</span> / {COMMITS} commits
          </div>
        </div>
        <div data-second className="absolute inset-0 flex flex-col gap-1.5 p-4 opacity-0 sm:p-5">
          <div>
            <span className="terminal-go">$ </span>
            <span>{RUN}</span>
          </div>
          <div data-out className="terminal-link truncate">
            {LINK}
          </div>
          <div data-out className="terminal-soft">
            It works in any browser and expires in 4 hours.
          </div>
          <div data-out className="terminal-dim">
            Opened in your browser.
          </div>
        </div>
      </div>
    </div>
  );
}
