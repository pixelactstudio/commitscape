import type { Params } from "../source";
import { Analysis } from "./analysis";
import { limited, topOf } from "./limit";
import { activity, file, mapLevel, overview, people, person, stats } from "./screens";
import { DAY, type IndexView, type ViewWindow } from "./view";

export * from "./view";
export { Analysis } from "./analysis";
export { mapFolders, profiled, personRef } from "./screens";
export { commitsUnder, filesUnder, gitCoupling, gitLog, gitTree, lastInFolder, MONTH, monthsOf, type Blob, type TreeOf } from "./git";
export { askedOf, limited, topOf, TOP_MAX, withoutTop } from "./limit";

export const SPANS: Record<string, number | null> = { "30d": 30, "90d": 90, "1y": 365, all: null };

const KEPT = 12;

const analyses = new WeakMap<IndexView, Map<string, Analysis>>();

/** The Window a request names: one of the Report's spans back from the anchor, or any `from`..`to` in seconds. */
export function windowOf(v: IndexView, params: Params): { label: string; window: ViewWindow } | null {
  const from = params.from === undefined || params.from === null || params.from === "" ? null : Number(params.from);
  const to = params.to === undefined || params.to === null || params.to === "" ? null : Number(params.to);
  if (from !== null || to !== null) {
    if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to))) return null;
    const end = to ?? v.anchor;
    if (from !== null && from > end) return null;
    return { label: "range", window: { from, to: end } };
  }
  const label = String(params.window ?? "all");
  if (!(label in SPANS)) return null;
  const days = SPANS[label] ?? null;
  return { label, window: { from: days === null ? null : v.anchor - days * DAY, to: v.anchor } };
}

/** The Analysis of one Window of a view, kept while the view is, so the screens of one Window share their work. */
export function analysisOf(v: IndexView, window: ViewWindow): Analysis {
  let kept = analyses.get(v);
  if (!kept) {
    kept = new Map();
    analyses.set(v, kept);
  }
  const key = `${window.from}:${window.to}`;
  const found = kept.get(key);
  if (found) {
    kept.delete(key);
    kept.set(key, found);
    return found;
  }
  const made = new Analysis(v, window);
  kept.set(key, made);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  return made;
}

/** How many Analyses of a view are kept beside it now. */
export function analysesHeld(v: IndexView): number {
  return analyses.get(v)?.size ?? 0;
}

/** Answers one Data Source request from a Stored Index held in memory, in the shapes the Report uses, cut to its first `top` people when asked; null when there is no such answer. */
export function answer(v: IndexView, path: string, params: Params = {}): unknown {
  return limited(path, topOf(params), whole(v, path, params));
}

function whole(v: IndexView, path: string, params: Params): unknown {
  if (path === "/api/stats") return stats(v);
  const w = windowOf(v, params);
  if (!w) return null;
  const a = analysisOf(v, w.window);
  switch (path) {
    case "/api/overview":
      return overview(a, w.label);
    case "/api/activity":
      return activity(a, w.label);
    case "/api/people":
      return people(a, w.label);
    case "/api/person": {
      const id = Number(params.id);
      return Number.isInteger(id) ? person(a, id) : null;
    }
    case "/api/map":
      return mapLevel(a, String(params.path ?? ""));
    case "/api/file":
      return params.path ? file(a, String(params.path)) : null;
    default:
      return null;
  }
}
