import { periodDates, PERIODS, type Period, type WorkKind } from "@commitscape/data";

export { periodWords } from "@commitscape/data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });

/** The colour each kind of work wears, the same as in the PDF. */
export const KIND_COLOURS: Record<WorkKind, string> = {
  feature: "var(--s1)",
  fix: "var(--s2)",
  refactor: "var(--s3)",
  docs: "var(--s4)",
  test: "var(--s5)",
  perf: "var(--s7)",
  chore: "var(--ink-3)",
  other: "var(--other)",
};

/** Two days as a short range: "1–30 Sep 2026", "28 Sep – 4 Oct 2026". */
export function shortRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  const end = `${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (from === to) return end;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${end}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${end}`;
  return `${a.d}–${end}`;
}

/** The named period two dates make, if they make one. */
export function presetOf(from: string, to: string, today: Date = new Date()): Period | null {
  return PERIODS.find(([p]) => {
    const d = periodDates(p, today);
    return d.from === from && d.to === to;
  })?.[0] ?? null;
}

/** The organisations and repositories a person's work is in, busiest first, with how many items each holds; an entry with a count stands for that many items. */
export function placesOf(items: { repo: string; count?: number }[]) {
  const repos = new Map<string, number>();
  const owners = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const i of items) {
    const n = i.count ?? 1;
    repos.set(i.repo, (repos.get(i.repo) ?? 0) + n);
    const owner = i.repo.split("/")[0] ?? i.repo;
    owners.set(owner, (owners.get(owner) ?? new Set()).add(i.repo));
    counts.set(owner, (counts.get(owner) ?? 0) + n);
  }
  const busiest = <T,>(a: [string, T, number], b: [string, T, number]) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1);
  return {
    organisations: [...owners.entries()].map(([o, set]) => [o, set.size, counts.get(o) ?? 0] as [string, number, number]).sort(busiest).map(([name, repositories, count]) => ({ name, repositories, count })),
    repositories: [...repos.entries()].map(([r, n]) => [r, 0, n] as [string, number, number]).sort(busiest).map(([name, , count]) => ({ name, count })),
  };
}
