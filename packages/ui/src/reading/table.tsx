import type { ReactNode } from "react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ICON } from "../design/tokens";

/** The empty rows above and below the ones drawn, so the scrollbar is as long as the table. */
export function Spacer({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden style={{ height }}>
      <td className="p-0" />
    </tr>
  );
}

/** A column heading that sorts: a button with the arrow of the direction while it is the column in use, and what the column counts as a tooltip. */
export function SortHead({ label, why, active, down, onSort, align = "end", className = "" }: { label: ReactNode; why: string; active: boolean; down: boolean; onSort: () => void; align?: "start" | "end"; className?: string }) {
  return (
    <th scope="col" aria-sort={active ? (down ? "descending" : "ascending") : undefined} className={`sticky top-(--chrome-top) z-(--z-raised) border-b border-separator bg-surface px-3 py-0 font-medium whitespace-nowrap ${align === "end" ? "text-end" : "text-start"} ${className}`}>
      <Tooltip content={why} placement="below">
        <button type="button" onClick={onSort} className={`plain-button inline-flex h-10 items-center gap-1 rounded-md px-1.5 type-caption font-medium hover:text-primary ${align === "end" ? "-me-1.5 flex-row-reverse" : "-ms-1.5"} ${active ? "text-primary" : ""}`}>
          {label}
          {active ? down ? <ArrowDown size={ICON.xs} aria-hidden /> : <ArrowUp size={ICON.xs} aria-hidden /> : <span aria-hidden className="w-3" />}
        </button>
      </Tooltip>
    </th>
  );
}

/** A plain column heading, sticky like the sorting ones. */
export function PlainHead({ children, align = "start", className = "" }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <th scope="col" className={`sticky top-(--chrome-top) z-(--z-raised) h-10 border-b border-separator bg-surface px-3 py-0 type-caption font-medium whitespace-nowrap ${align === "end" ? "text-end" : "text-start"} ${className}`}>
      {children}
    </th>
  );
}
