import { useContext, type ReactNode } from "react";
import { HelpContext } from "./help";

/** What a number means, shown only while help is on. */
export function Explain({ children }: { children: ReactNode }) {
  const on = useContext(HelpContext);
  if (!on) return null;
  return <div className="fade rounded-e-sm border-s-3 border-accent-bg bg-accent-muted px-3 py-2 type-description [&_ul]:my-1 [&_ul]:ps-4">{children}</div>;
}
