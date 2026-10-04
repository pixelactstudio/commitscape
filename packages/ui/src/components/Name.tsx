import type { PersonRef } from "@commitscape/data";
import { useLogin } from "./login";
import { Face } from "./Face";

export function Name({ p, onOpen }: { p: PersonRef | null | undefined; onOpen?: (id: number) => void }) {
  const login = useLogin(p);
  if (!p) return <span className="note">someone unknown</span>;
  const mark = (
    <span className="face" aria-hidden>
      <Face login={login} name={p.name} size={20} />
    </span>
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

export function Path({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
  if (!onOpen) return <code className="path">{path}</code>;
  return (
    <button type="button" className="path link" onClick={() => onOpen(path)}>
      {path}
    </button>
  );
}
