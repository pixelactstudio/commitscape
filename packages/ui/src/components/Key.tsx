import { useContext } from "react";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HelpContext } from "../help";

/** A keyboard key, ringed while help is shown so every shortcut on screen stands out. */
export function Key({ keys }: { keys: string }) {
  const help = useContext(HelpContext);
  return (
    <span className={`inline-flex rounded-[var(--radius-inner)] transition-shadow ${help ? "bg-[var(--color-accent-muted)] shadow-[0_0_0_2px_var(--color-accent)]" : ""}`}>
      <Kbd keys={keys} />
    </span>
  );
}
