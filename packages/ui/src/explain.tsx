import { useContext, type ReactNode } from "react";
import { HelpContext } from "./help";

/** What a number means, shown only while help is on. */
export function Explain({ children }: { children: ReactNode }) {
  const on = useContext(HelpContext);
  if (!on) return null;
  return <div className="fade rounded-e-[var(--radius-inner)] border-s-[3px] border-[var(--color-accent)] bg-[var(--color-accent-muted)] px-3 py-2 text-[0.84rem] text-pretty text-secondary [&_ul]:my-1 [&_ul]:ps-4">{children}</div>;
}
