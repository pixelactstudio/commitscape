import { OTHER_TAGS, tagFamilyOf, type GitTag } from "@commitscape/data";
import { DAY } from "./time";

export type Family = {
  key: string;
  label: string;
  line: boolean;
  tags: GitTag[];
  newest: GitTag;
  gaps: number;
  cadence: number | null;
  lastYear: number;
};

const GAPS_USED = 12;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** The days between one day with a release and the next, newest first; tags made on one day count once. */
export function gapsOf(tags: readonly GitTag[]): number[] {
  const days = [...new Set(tags.map((t) => Math.floor(t.at / DAY)))].sort((a, b) => b - a);
  return days.slice(1).map((d, i) => (days[i] ?? d) - d);
}

const LINE = "\u0001";

function lineOf(name: string): { key: string; label: string } {
  const major = /^(v?)(\d+)\./.exec(name);
  return major ? { key: `${LINE}${major[2]}`, label: `${major[1]}${major[2]}.x` } : { key: LINE, label: name };
}

function labelOf(key: string, sep: string, newest: string): string {
  if (key === OTHER_TAGS) return "Other tags";
  if (key.startsWith(LINE)) return lineOf(newest).label;
  return `${key}${sep}`;
}

/** The tags gathered by family: the repository's own version lines (`v19.x`, `v18.x`, down to `v0.x`) first, newest version first, then the families named by a prefix, the one released in last first, and each family with its usual gap between release days. */
export function familiesOf(tags: readonly GitTag[]): Family[] {
  const by = new Map<string, { sep: string; tags: GitTag[] }>();
  for (const t of tags) {
    const named = tagFamilyOf(t.name);
    const { key, sep } = named.key === "" ? { key: lineOf(t.name).key, sep: "" } : named;
    const had = by.get(key);
    if (had) had.tags.push(t);
    else by.set(key, { sep, tags: [t] });
  }
  const latest = Math.max(0, ...tags.map((t) => t.at));
  const out: Family[] = [];
  for (const [key, { sep, tags: list }] of by) {
    const sorted = [...list].sort((a, b) => b.at - a.at);
    const newest = sorted[0];
    if (!newest) continue;
    const gaps = gapsOf(sorted).slice(0, GAPS_USED);
    out.push({ key, label: labelOf(key, sep, newest.name), line: key.startsWith(LINE), tags: sorted, newest, gaps: gaps.length, cadence: gaps.length > 0 ? median(gaps) : null, lastYear: sorted.filter((t) => latest - t.at <= 365 * DAY).length });
  }
  return out.sort((a, b) => Number(b.line) - Number(a.line) || (a.line && b.line ? Number(b.key.slice(1)) - Number(a.key.slice(1)) || 0 : 0) || b.newest.at - a.newest.at || (a.key < b.key ? -1 : 1));
}

/** The family the repository's own releases are: the version line released in last, else the family with most tags. */
export function leadOf(families: readonly Family[]): Family | undefined {
  return families.find((f) => f.line) ?? [...families].filter((f) => f.key !== OTHER_TAGS).sort((a, b) => b.tags.length - a.tags.length)[0];
}

/** The tag nearest a time among tags newest first, or undefined for none. */
export function nearestTag(tags: readonly GitTag[], seconds: number): GitTag | undefined {
  let lo = 0;
  let hi = tags.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tags[mid]?.at ?? 0) > seconds) lo = mid + 1;
    else hi = mid;
  }
  const a = tags[lo];
  const b = tags[lo - 1];
  if (!a) return b;
  if (!b) return a;
  return Math.abs(a.at - seconds) <= Math.abs(b.at - seconds) ? a : b;
}
