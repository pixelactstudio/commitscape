import { useContext } from "react";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HelpContext } from "../help";

/** A keyboard key, ringed while help is shown so every shortcut on screen stands out. */
export function Key({ keys }: { keys: string }) {
  const help = useContext(HelpContext);
  return (
    <span className={`inline-flex rounded-xs transition-shadow ${help ? "bg-accent-muted ring-2 ring-accent-bg" : ""}`}>
      <Kbd keys={keys} />
    </span>
  );
}
