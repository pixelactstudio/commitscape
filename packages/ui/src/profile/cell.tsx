import type { ReactNode } from "react";

/** One slot of the headline numbers. */
export function Cell({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return <div className={`min-w-0 border-line [&:not(:last-child)]:border-e max-lg:[&:nth-child(2n)]:border-e-0 max-lg:[&:nth-child(n+3)]:border-t ${small ? "px-4 py-4 sm:px-5" : "px-4 py-6 sm:px-5"}`}>{children}</div>;
}
