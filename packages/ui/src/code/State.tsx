import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ICON } from "../design/tokens";

/** What the window shows in place of a file's text, and why: an icon, a title, what happened, and what can be done instead. */
export function State({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-lg border border-line bg-sunken text-secondary" aria-hidden>
        <Icon size={ICON.lg} strokeWidth={1.75} absoluteStrokeWidth />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="m-0 type-label">{title}</p>
        {children && <div className="m-0 type-description">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
