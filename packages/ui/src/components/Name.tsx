import { createContext, useContext } from "react";
import type { PersonRef } from "@commitscape/data";
import { useLogin } from "./login";
import { Face, type FaceSize } from "./Face";

/** Where a GitHub login's Standing in this repository lives, when the page knows one. */
export const StandingContext = createContext<((login: string) => string) | null>(null);

/** The address of a person's Standing in this repository, or null. */
export function useStanding(login: string | null | undefined): string | null {
  const href = useContext(StandingContext);
  return href && login ? href(login) : null;
}

/** A person's face and name; a button that opens what they did here when it can be opened. */
export function Name({ p, onOpen, size = 20, className = "" }: { p: PersonRef | null | undefined; onOpen?: (id: number) => void; size?: FaceSize; className?: string }) {
  const login = useLogin(p);
  if (!p) return <span className="text-secondary">someone unknown</span>;
  const body = (
    <>
      <Face login={login} name={p.name} size={size} decorative />
      <bdi className="truncate">{p.name}</bdi>
    </>
  );
  if (!onOpen) return <span className={`inline-flex min-w-0 items-center gap-2 align-middle ${className}`}>{body}</span>;
  return (
    <button type="button" onClick={() => onOpen(p.id)} className={`plain-button hit inline-flex min-h-6 max-w-full min-w-0 items-center gap-2 align-middle text-primary hover:underline hover:decoration-line-strong hover:underline-offset-4 ${className}`}>
      {body}
    </button>
  );
}

/** A path in the code; a button that opens it when it can be opened. */
export function Path({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
  if (!onOpen) return <code className="mono truncate type-caption">{path}</code>;
  return (
    <button type="button" onClick={() => onOpen(path)} className="plain-button hit mono min-h-6 max-w-full truncate type-caption text-primary hover:underline hover:decoration-line-strong hover:underline-offset-4">
      {path}
    </button>
  );
}
