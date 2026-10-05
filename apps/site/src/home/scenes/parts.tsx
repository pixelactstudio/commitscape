import type { ReactNode } from "react";

/** The pointer that moves and clicks inside a scene. Starts hidden in the top-left corner. */
export function Cursor() {
  return (
    <span data-cursor className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 [will-change:transform]">
      <svg width="18" height="20" viewBox="0 0 18 20" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_2px_4px_rgb(0_0_0/0.35)]">
        <path d="M2 1.5v15.2l4.1-3.9 2.7 6.1 2.9-1.3-2.7-6h5.8z" fill="var(--color-text-primary)" stroke="var(--color-background-body)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** A small window of the product drawn inside a tile. */
export function Mini({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mini relative rounded-[14px] border border-line bg-[var(--color-background-surface)] ${className}`}>{children}</div>;
}

/** The row at the top of a Mini: a title and something on the right. */
export function MiniHead({ title, end }: { title: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 border-b border-line px-3.5 text-[0.72rem]">
      <span className="truncate font-medium text-primary">{title}</span>
      {end && <span className="flex-none text-secondary">{end}</span>}
    </div>
  );
}
