import type { PersonRef } from "../api/types";
import { personColour } from "../theme";

/**
 * A person as every screen writes them: a swatch of their colour beside
 * their name, which carries who they are (the colour never does alone).
 * Clicking opens their profile.
 */
export function Name({ p, onOpen }: { p: PersonRef | null | undefined; onOpen?: (id: number) => void }) {
  if (!p) return <span className="note">someone unknown</span>;
  const swatch = <span className="swatch" style={{ background: personColour(p.colour) }} aria-hidden />;
  if (!onOpen) {
    return (
      <span className="name">
        {swatch}
        {p.name}
      </span>
    );
  }
  return (
    <button type="button" className="name link" onClick={() => onOpen(p.id)}>
      {swatch}
      {p.name}
    </button>
  );
}

/** A path, in monospace, that can be clicked to open it. */
export function Path({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
  if (!onOpen) return <code className="path">{path}</code>;
  return (
    <button type="button" className="path link" onClick={() => onOpen(path)}>
      {path}
    </button>
  );
}
