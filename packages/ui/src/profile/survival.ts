import type { EngineRepo, EngineView, UnreadRepo } from "@commitscape/data";

/** Survival, as a share, only when both numbers are known and it is a share: an import left out of Lines Changed can make it pass 100%, and then it is not shown. */
export function survival(lines: number | null, added: number | null): string | null {
  if (lines === null || added === null || added === 0 || lines > added) return null;
  const p = (lines * 100) / added;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

export type Coverage = {
  counted: EngineRepo[];
  waiting: EngineRepo[];
  unread: UnreadRepo[];
  total: number | null;
  added: number | null;
  repositories: number | null;
  busy: boolean;
};

/** What a Surviving Lines total covers: the counted repositories it is the sum of, the read ones still waiting for a count, and the ones not read yet; the total is only ever the sum of the counted list. */
export function coverage(engine: EngineView): Coverage {
  const counted = engine.repos.filter((r) => r.surviving.status === "counted" && r.surviving.lines !== null);
  const waiting = engine.repos.filter((r) => !counted.includes(r));
  const unread = engine.unread ?? [];
  const total = counted.length > 0 ? counted.reduce((n, r) => n + (r.surviving.lines ?? 0), 0) : null;
  const added = counted.length > 0 && counted.every((r) => r.surviving.added !== null) ? counted.reduce((n, r) => n + (r.surviving.added ?? 0), 0) : null;
  return {
    counted,
    waiting,
    unread,
    total,
    added,
    repositories: engine.unread ? engine.repos.length + unread.length : null,
    busy: waiting.some((r) => r.surviving.status === "counting") || unread.some((r) => r.state === "reading"),
  };
}
