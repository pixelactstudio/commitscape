import { useContext } from "react";
import type { PersonRef } from "@commitscape/data";
import { LoginsContext } from "../help";

export function useLogin(p: PersonRef | null | undefined): string | null {
  const logins = useContext(LoginsContext);
  if (!p) return null;
  return p.login ?? logins.get(p.id) ?? null;
}
