import type { BranchState } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { STATES } from "./states";

/** A state's glyph in its colour: the shape says it as the colour does. */
export function StateMark({ state, size = ICON.sm }: { state: BranchState; size?: number }) {
  const { Icon, colour } = STATES[state];
  return (
    <span className="inline-flex flex-none" style={{ color: colour }}>
      <Icon size={size} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
    </span>
  );
}
