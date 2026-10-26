import { COMMITS, RUN } from "./terminal";

const LINK = "https://app.commitscape.com/s/k3f9q2x7#0dbf…";
const TOLD = [
  "This uploads my-project's Report to app.commitscape.com.",
  "  It holds paths, people's names, logins and commit subjects.",
  "  No email addresses.",
  "  Locked with a key only the link holds: the Site cannot read it.",
  "  The link works for 4 hours.",
];

/** The command line at work: a run asks before it uploads, reads the history, then prints a link and opens it. */
export function TerminalScene() {
  return (
    <div data-scene="terminal" className="terminal overflow-hidden rounded-xl border border-line shadow-lg">
      <div className="flex items-center gap-1.5 border-b terminal-line px-4 py-2.5">
        {["close", "min", "max"].map((c) => (
          <span key={c} className={`terminal-light terminal-${c} size-2.5 rounded-full`} />
        ))}
        <span className="terminal-dim ms-3 text-2xs">~/code/my-project</span>
      </div>
      <div className="relative h-80 font-mono text-xs leading-relaxed sm:h-72 sm:text-sm">
        <div data-first className="absolute inset-0 flex flex-col gap-1.5 p-4 sm:p-5">
          <div>
            <span className="terminal-go">$ </span>
            <span data-run>{RUN}</span>
            <span className="terminal-caret" />
          </div>
          {TOLD.map((line) => (
            <div key={line} data-told className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${line.startsWith(" ") ? "terminal-dim" : "terminal-soft"}`}>
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
          <div data-out className="terminal-link [overflow-wrap:anywhere]">
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
