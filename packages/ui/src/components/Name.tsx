import { useContext } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import type { PersonRef } from "@commitscape/data";
import { AvatarsContext } from "../help";
import { avatarUrl } from "./avatar";
import { personColour } from "../theme";

/**
 * A person as every screen writes them: their GitHub avatar when they have
 * one (and the page may show it), or a swatch of their colour, beside their
 * name, which carries who they are (the colour never does alone). Clicking
 * opens their profile.
 */
export function Name({ p, onOpen }: { p: PersonRef | null | undefined; onOpen?: (id: number) => void }) {
  const avatars = useContext(AvatarsContext);
  if (!p) return <span className="note">someone unknown</span>;
  const mark =
    avatars && p.login ? (
      <span className="avatar" style={{ borderColor: personColour(p.colour) }} aria-hidden>
        <Avatar src={avatarUrl(p.login)} name={p.name} size="xsm" tooltip={false} />
      </span>
    ) : (
      <span className="swatch" style={{ background: personColour(p.colour) }} aria-hidden />
    );
  if (!onOpen) {
    return (
      <span className="name">
        {mark}
        {p.name}
      </span>
    );
  }
  return (
    <button type="button" className="name link" onClick={() => onOpen(p.id)}>
      {mark}
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
