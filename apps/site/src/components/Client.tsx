import type { ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";

/**
 * Pages drawn in the browser only. The app's one shell (`index.html`) is
 * served for every path, so it holds no page: drawing one into it ahead of
 * time would not match the page the browser then draws for another path.
 */
export function Client({ children }: { children: ReactNode }) {
  return <ClientOnly fallback={<div className="booting" />}>{children}</ClientOnly>;
}
