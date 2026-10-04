import { useEffect } from "react";

export type Visit = { kind: "person" | "repo"; id: string };

const KEY = "commitscape:recent";

/** The people and repositories this browser opened last, newest first. */
export function recent(): Visit[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? (list as Visit[]).filter((v) => (v.kind === "person" || v.kind === "repo") && typeof v.id === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a visit to a Profile or repository for the search box. */
export function useRemember(visit: Visit | null) {
  const kind = visit?.kind;
  const id = visit?.id;
  useEffect(() => {
    if (!kind || !id) return;
    try {
      const next = [{ kind, id }, ...recent().filter((v) => v.id.toLowerCase() !== id.toLowerCase())].slice(0, 8);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return;
    }
  }, [kind, id]);
}
