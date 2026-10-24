export type Peak = { day: number; hour: number; commits: number; times: number };

/** The busiest weekday and hour of a week of commits, and how many times a typical hour it is. */
export function peakOf(week: number[][]): Peak | null {
  let best: Peak | null = null;
  const all = week.flat().reduce((a, b) => a + b, 0);
  week.forEach((hours, day) =>
    hours.forEach((commits, hour) => {
      if (commits > 0 && (!best || commits > best.commits)) best = { day, hour, commits, times: 0 };
    }),
  );
  if (!best) return null;
  const found: Peak = best;
  return { ...found, times: all > 0 ? found.commits / (all / 168) : 0 };
}
