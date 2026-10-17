import type { ReactNode } from "react";

/** A screen's one row of filters, above the list it narrows: two to a row on a phone, side by side from the width of a tablet. */
export function Toolbar({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`grid grid-cols-2 items-center gap-2 @min-[40rem]:flex @min-[40rem]:flex-wrap ${className}`}>
      {children}
    </div>
  );
}

const FIELDS = {
  search: "col-span-2 min-w-0 @min-[40rem]:min-w-56 @min-[40rem]:flex-1",
  find: "col-span-2 min-w-0 @min-[40rem]:w-96",
  person: "min-w-0 @min-[40rem]:w-52",
  option: "min-w-0 @min-[40rem]:w-44",
  order: "col-span-2 min-w-0 @min-[40rem]:w-44",
} as const;

export type Field = keyof typeof FIELDS;

/** One control of a Toolbar at the width its kind takes: the search grows to what is left, a search on its own and the others have a set width. */
export function ToolbarField({ kind, children, className = "" }: { kind: Field; children: ReactNode; className?: string }) {
  return <div className={`${FIELDS[kind]} ${className}`}>{children}</div>;
}
