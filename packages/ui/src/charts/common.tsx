import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { Eye } from "lucide-react";
import { CHART } from "../design/tokens";
import { grouped } from "../format";

export type Swatch = { label: string; colour: string; mark?: "line" | "dash" | "block" };

/** What each colour or line in a chart is, in a row beneath it. */
export function Legend({ items }: { items: Swatch[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 type-micro">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden className="flex-none">
            {s.mark === "line" || s.mark === "dash" ? (
              <line x1="0" x2="14" y1="5" y2="5" stroke={s.colour} strokeWidth="2" strokeDasharray={s.mark === "dash" ? "3 2" : undefined} />
            ) : (
              <rect width="14" height="10" rx={CHART.barRadius} fill={s.colour} />
            )}
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export type Entry = string | number | ReactNode;

/** A link-styled button inside a chart's table: the keyboard way to ask for what a click on the picture does. */
export function TableAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="plain-button inline-link hit inline-flex min-h-6 items-center type-caption whitespace-nowrap">
      {children}
    </button>
  );
}

/** A chart's numbers as a plain table behind an eye button, in a dialog: the keyboard and screen-reader twin of the picture. Using any button or link inside it closes it. */
export function TableView({ head, rows, title = "The numbers behind the chart", children, className = "-ms-3 flex self-start" }: { head: string[]; rows: Entry[][]; title?: string; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className={className}>
        <Button label="Numbers" variant="ghost" size="sm" icon={<Icon icon={Eye} size="sm" />} onClick={() => setOpen(true)} aria-haspopup="dialog" />
      </span>
      {open && (
        <Dialog isOpen onOpenChange={setOpen} width="min(880px, 96vw)" maxHeight="90dvh" padding={0}>
          <div className="px-5 pt-5">
            <DialogHeader title={title} subtitle="The numbers behind the chart." onOpenChange={setOpen} />
          </div>
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5" onClick={(e) => (e.target as HTMLElement).closest("button, a") && setOpen(false)}>
            <div className="max-h-128 overflow-auto overscroll-contain rounded-md border border-line">
              <table className="w-full min-w-max border-collapse type-caption">
                <thead>
                  <tr>
                    {head.map((h, i) => (
                      <th key={`${h}${i}`} scope="col" className={`sticky top-0 bg-surface px-3 py-1.5 font-medium whitespace-nowrap ${i === 0 ? "text-start" : "text-end"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {r.map((c, j) => (
                        <td key={j} className={`px-3 py-1 text-primary ${j === 0 ? "text-start whitespace-nowrap" : "text-end tnum"}`}>
                          {typeof c === "number" ? grouped(c) : c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {children}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** A chart with a name, a sentence for readers who cannot see it, and its numbers as a table beneath. */
export function ChartFrame({ label, summary, children, table }: { label: string; summary: string; children: ReactNode; table?: ReactNode }) {
  return (
    <figure aria-label={label} className="m-0 flex min-w-0 flex-col gap-1">
      <div role="img" aria-label={summary} className="min-w-0">
        {children}
      </div>
      {table}
    </figure>
  );
}
