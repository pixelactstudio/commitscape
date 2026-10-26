import { Check } from "lucide-react";
import { WORK } from "./data";
import { whole } from "./format";
import { Cursor, Mini, MiniHead } from "./parts";

const TOTAL = WORK.reduce((n, w) => n + w.added, 0);
const EXPORTS = ["Markdown", "Link", "PDF"];

/** A month of merged pull requests checked off one by one, totalled, then saved as a PDF. */
export function WorkScene() {
  return (
    <div data-scene="work" className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-80 overflow-hidden">
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
