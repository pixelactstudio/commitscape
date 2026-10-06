import type { ReactNode } from "react";
import { Face, type FaceProps, type FaceSize } from "../components/Face";

type Who = { login: string; name?: string | null };

/** A person in a row: their face, their name, and their @login beneath it when the name says something else. */
export function Person({ login, name, size = 32, ring, glow, note, className = "" }: Who & { size?: FaceSize; ring?: string; glow?: boolean; note?: ReactNode; className?: string }) {
  const shown = name ?? login;
  const sub = note ?? (name && name !== login ? `@${login}` : null);
  return (
    <span className={`inline-flex min-w-0 items-center gap-3 ${className}`}>
      <Face login={login} name={shown} size={size} ring={ring} glow={glow} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{shown}</span>
        {sub && <span className="truncate text-xs text-secondary">{sub}</span>}
      </span>
    </span>
  );
}

/** A few faces overlapping, each cut out of the surface behind it. */
export function FaceStack({ people, size = 32, edge = "surface", label }: { people: Who[]; size?: FaceSize; edge?: FaceProps["edge"]; label?: string }) {
  return (
    <span className="flex flex-none -space-x-2" role={label ? "img" : undefined} aria-label={label}>
      {people.map((p) => (
        <Face key={p.login} login={p.login} name={p.name ?? p.login} size={size} edge={edge} />
      ))}
    </span>
  );
}
