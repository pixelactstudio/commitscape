/**
 * Every number's explanation, shown under it when `?` is pressed (or the
 * `?` button), and hidden again the same way.
 */
import { useContext, type ReactNode } from "react";
import { HelpContext } from "./help";

export function Explain({ children }: { children: ReactNode }) {
  const on = useContext(HelpContext);
  if (!on) return null;
  return <div className="explain">{children}</div>;
}
