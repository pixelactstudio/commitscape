export type Mark = { day: number; label: string };

const MARK_GAP = 3.5;
const LABEL_GAP = 13;

export function binDays(days: number): number {
  if (days <= 120) return 1;
  if (days <= 840) return 7;
  if (days <= 28 * 160) return 28;
  return 91;
}

/** The releases drawn on a chart: only those at least a few percent apart, newest kept first, and labels only where they fit. */
export function thinMarks(marks: Mark[], firstDay: number, days: number): { mark: Mark; at: number; labelled: boolean }[] {
  const span = Math.max(1, days);
  const placed = marks
    .map((mark) => ({ mark, at: ((mark.day - firstDay) / span) * 100 }))
    .filter((m) => m.at >= 0 && m.at <= 100)
    .sort((a, b) => b.at - a.at);
  const kept: { mark: Mark; at: number; labelled: boolean }[] = [];
  let lastMark = Infinity;
  let lastLabel = Infinity;
  for (const m of placed) {
    if (lastMark - m.at < MARK_GAP) continue;
    const labelled = lastLabel - m.at >= LABEL_GAP && m.at <= 100 - 4;
    kept.push({ ...m, labelled });
    lastMark = m.at;
    if (labelled) lastLabel = m.at;
  }
  return kept.reverse();
}

export function yearsOf(firstDay: number, days: number): number[] {
  const out: number[] = [];
  const first = new Date(firstDay * 86_400_000).getUTCFullYear();
  const last = new Date((firstDay + days) * 86_400_000).getUTCFullYear();
  for (let y = first + 1; y <= last; y++) out.push(Date.UTC(y, 0, 1) / 86_400_000);
  const every = Math.ceil(out.length / 10);
  return out.filter((_, i) => i % every === 0);
}
