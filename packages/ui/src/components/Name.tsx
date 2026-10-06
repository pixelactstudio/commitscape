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
      <span className="inline-flex flex-none" aria-hidden>
        <Face login={login} name={p.name} size={size} />
      </span>
      <span className="truncate">{p.name}</span>
    </>
  );
  if (!onOpen) return <span className={`inline-flex min-w-0 items-center gap-2 align-middle ${className}`}>{body}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(p.id)}
      className={`inline-flex max-w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-start align-middle font-[inherit] text-primary decoration-[var(--color-border-emphasized)] underline-offset-[3px] hover:underline ${className}`}
    >
      {body}
    </button>
  );
}

/** A path in the code; a button that opens it when it can be opened. */
export function Path({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
  if (!onOpen) return <code className="truncate font-mono text-[0.85em]">{path}</code>;
  return (
    <button type="button" onClick={() => onOpen(path)} className="max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-start font-mono text-[0.85em] text-primary underline-offset-[3px] hover:underline">
      {path}
    </button>
  );
}
