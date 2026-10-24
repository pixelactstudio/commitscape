import type { ReactNode } from "react";

/** One slot of a row of numbers. `bare` is a slot in a grid that draws its own rules between slots; `reserve` holds the height of the tallest typical slot, so the row keeps its size while its numbers arrive. */
export function Cell({ children, small = false, bare = false, reserve = false }: { children: ReactNode; small?: boolean; bare?: boolean; reserve?: boolean }) {
  const size = small ? `px-4 py-4 sm:px-5 ${reserve ? "lg:min-h-34" : ""}` : `px-4 py-6 sm:px-5 ${reserve ? "min-h-37 lg:min-h-47" : ""}`;
  const rules = bare ? "bg-surface" : "border-line [&:not(:last-child)]:border-e max-lg:[&:nth-child(2n)]:border-e-0 max-lg:[&:nth-child(n+3)]:border-t";
  return <div className={`min-w-0 ${rules} ${size}`}>{children}</div>;
}
