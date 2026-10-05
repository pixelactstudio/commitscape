import { useMemo, useState, type ReactNode } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Eye } from "lucide-react";
import type { Profile } from "@commitscape/data";
import { YearGrid } from "../charts/Year";
import { day, grouped, many } from "../format";
import { Panel } from "../kit/layout";
import { DAY, lastYear, longestRun, monthKey, MONTHS, streakHeat, WEEKDAYS, weekdayOf } from "./days";

const KINDS = [
  { key: "commits", label: "Commits", colour: "var(--s1)" },
  { key: "prs", label: "Pull requests", colour: "var(--s7)" },
  { key: "reviews", label: "Reviews", colour: "var(--s3)" },
  { key: "issues", label: "Issues", colour: "var(--s4)" },
  { key: "hidden", label: "Private", colour: "var(--other)" },
] as const;

function breakdown(profile: Profile) {
  const year = lastYear(profile);
  const { firstDay, days } = year;
  const total = days.reduce((a, b) => a + b, 0);
  const active = days.filter((n) => n > 0).length;
  const best = days.reduce((b, n, i) => (n > b.n ? { n, d: firstDay + i } : b), { n: 0, d: firstDay });
  const weeks: { n: number; d: number }[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push({ n: days.slice(i, i + 7).reduce((a, b) => a + b, 0), d: firstDay + i });
  const bestWeek = weeks.reduce((b, w) => (w.n > b.n ? w : b), { n: 0, d: firstDay });
  const months = new Map<string, number>();
  days.forEach((n, i) => months.set(monthKey(firstDay + i), (months.get(monthKey(firstDay + i)) ?? 0) + n));
  const monthList = [...months.entries()].map(([key, n]) => ({ key, n }));
  const bestMonth = monthList.reduce((b, m) => (m.n > b.n ? m : b), { key: "", n: 0 });
  const weekdays = Array.from({ length: 7 }, () => ({ n: 0, active: 0, days: 0 }));
  days.forEach((n, i) => {
    const w = weekdays[weekdayOf(firstDay + i)];
    if (!w) return;
    w.n += n;
    w.days++;
    if (n > 0) w.active++;
  });
  const run = longestRun(days);
  const firstYear = new Date(firstDay * DAY * 1000).getUTCFullYear();
  const lastDay = firstDay + days.length - 1;
  const thisYear = new Date(lastDay * DAY * 1000).getUTCFullYear();
  const kinds = profile.years.filter((y) => y.year >= firstYear && y.year <= thisYear).sort((a, b) => b.year - a.year);
  return { firstDay, lastDay, total, active, length: days.length, best, bestWeek, monthList, bestMonth, weekdays, run, kinds, thisYear };
}

const monthName = (key: string) => {
  const [y = "", m = "01"] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

/** The last year, a square a day, its busiest day, and everything behind it in a dialog. */
export function LastYear({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const year = lastYear(profile);
  const total = year.days.reduce((a, b) => a + b, 0);
  const best = year.days.reduce((b, n, i) => (n > b.n ? { n, i } : b), { n: 0, i: -1 });
  return (
    <Panel
      title="The last year"
      description={`${many(total, "contribution", "contributions")} on GitHub: commits, pull requests, reviews and issues`}
      actions={
        <div className="flex items-center gap-4 text-sm">
          {best.i >= 0 && (
            <span className="flex flex-col items-end">
              <span className="font-semibold tnum">{grouped(best.n)}</span>
              <span className="text-xs text-secondary">best day, {day(year.firstDay + best.i)}</span>
            </span>
          )}
          {total > 0 && <IconButton label="The last year in numbers" tooltip="The last year in numbers" variant="secondary" size="sm" icon={<Icon icon={Eye} size="sm" />} onClick={() => setOpen(true)} />}
        </div>
      }
    >
      <YearGrid firstDay={year.firstDay} days={year.days} unit="contributions" label="Contributions a day over the last year" table={false} />
      {open && <YearDialog profile={profile} open={open} onOpenChange={setOpen} />}
    </Panel>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-element)] border border-line bg-[var(--color-background-body)] px-3.5 py-3">
      <span className="text-xs font-medium text-secondary">{label}</span>
      <span className="text-[1.3rem] leading-none font-semibold tracking-[-0.02em] tnum" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      {note && <span className="truncate text-xs text-secondary">{note}</span>}
    </div>
  );
}

function Heading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h3 className="m-0 text-sm font-semibold">{children}</h3>
      {note && <span className="text-xs text-secondary">{note}</span>}
    </div>
  );
}

function YearDialog({ profile, open, onOpenChange }: { profile: Profile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const b = useMemo(() => breakdown(profile), [profile]);
  const t = profile.totals;
  const mostMonth = Math.max(1, ...b.monthList.map((m) => m.n));
  const mostWeekday = Math.max(1, ...b.weekdays.map((w) => w.n));
  const topWeekday = b.weekdays.reduce((best, w, i) => (w.n > (b.weekdays[best]?.n ?? 0) ? i : best), 0);
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width="min(760px, 96vw)" maxHeight="90dvh" padding={5}>
      <DialogHeader title="The last year, in numbers" subtitle={`${day(b.firstDay)} to ${day(b.lastDay)}, as GitHub counts contributions`} onOpenChange={onOpenChange} />
      <div className="flex flex-col gap-6 pt-2">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="Contributions" value={grouped(b.total)} note={b.active > 0 ? `${(b.total / b.active).toFixed(1)} on an active day` : "none yet"} />
          <Tile label="Active days" value={grouped(b.active)} note={`${Math.round((b.active * 100) / Math.max(1, b.length))}% of ${grouped(b.length)} days`} />
          <Tile label="Best day" value={grouped(b.best.n)} note={b.best.n > 0 ? day(b.best.d) : "—"} />
          <Tile label="Best week" value={grouped(b.bestWeek.n)} note={b.bestWeek.n > 0 ? `from ${day(b.bestWeek.d)}` : "—"} />
          <Tile label="Best month" value={grouped(b.bestMonth.n)} note={b.bestMonth.n > 0 ? monthName(b.bestMonth.key) : "—"} />
          <Tile label="Longest streak here" value={many(b.run.length, "day", "days")} note={b.run.length > 0 ? `from ${day(b.firstDay + b.run.start)}` : "—"} />
          <Tile label="Streak now" value={many(t.currentStreak, "day", "days")} note={streakHeat(t.currentStreak).word} tone={t.currentStreak > 0 ? streakHeat(t.currentStreak).colour : undefined} />
          <Tile label="Longest ever" value={many(t.longestStreak, "day", "days")} note={`${grouped(t.activeDays)} active days in all`} />
        </div>

        <section className="flex flex-col gap-3">
          <Heading note={b.bestMonth.n > 0 ? `busiest: ${monthName(b.bestMonth.key)}` : undefined}>Month by month</Heading>
          <ol className="m-0 grid h-36 list-none items-end gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${b.monthList.length}, minmax(0, 1fr))` }} aria-label="Contributions each month">
            {b.monthList.map((m) => {
              const [, mm = "01"] = m.key.split("-");
              const top = m.key === b.bestMonth.key && m.n > 0;
              return (
                <li key={m.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" aria-label={`${monthName(m.key)}: ${many(m.n, "contribution", "contributions")}`}>
                  <span className={`text-[0.65rem] tnum ${top ? "font-semibold text-primary" : "text-secondary"}`}>{m.n > 0 ? grouped(m.n) : ""}</span>
                  <span className={`block w-full rounded-t-[4px] ${top ? "bg-brand" : "bg-[var(--green-2)] opacity-70"}`} style={{ height: `${Math.max(m.n > 0 ? 3 : 1, (m.n * 100) / mostMonth)}%` }} />
                  <span className="text-[0.65rem] text-secondary">{MONTHS[Number(mm) - 1]?.slice(0, 1)}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          <section className="flex flex-col gap-3">
            <Heading note={`most on ${WEEKDAYS[topWeekday]}s`}>Day of the week</Heading>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {b.weekdays.map((w, i) => (
                <li key={WEEKDAYS[i]} className="grid grid-cols-[2.4rem_1fr_auto] items-center gap-2.5 text-xs">
                  <span className="text-secondary">{WEEKDAYS[i]?.slice(0, 3)}</span>
                  <span className="block h-2 overflow-hidden rounded-full bg-[var(--color-track)]">
                    <span className={`block h-full rounded-full ${i >= 5 ? "bg-[var(--s7)]" : "bg-[var(--s1)]"}`} style={{ width: `${(w.n * 100) / mostWeekday}%` }} />
                  </span>
                  <span className="w-[7.5rem] text-end text-secondary tnum">
                    <strong className="font-medium text-primary">{grouped(w.n)}</strong> · active {Math.round((w.active * 100) / Math.max(1, w.days))}%
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <Heading note="per calendar year">By kind</Heading>
            {b.kinds.length === 0 ? (
              <p className="m-0 text-sm text-secondary">GitHub has no counts by kind for these years.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
                {b.kinds.map((y) => {
                  const sum = Math.max(1, y.commits + y.prs + y.reviews + y.issues + y.hidden);
                  return (
                    <li key={y.year} className="flex flex-col gap-1.5">
                      <span className="flex justify-between text-xs">
                        <span className="font-medium">{y.year === b.thisYear ? `${y.year} so far` : y.year}</span>
                        <span className="text-secondary tnum">{grouped(y.commits + y.prs + y.reviews + y.issues + y.hidden)}</span>
                      </span>
                      <span className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                        {KINDS.map((k) => (y[k.key] > 0 ? <span key={k.key} className="block h-full" style={{ width: `${(y[k.key] * 100) / sum}%`, background: k.colour }} /> : null))}
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-secondary">
                        {KINDS.filter((k) => k.key !== "hidden" || y.hidden > 0).map((k) => (
                          <span key={k.key} className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-[2px]" style={{ background: k.colour }} />
                            {k.label} <strong className="font-medium text-primary tnum">{grouped(y[k.key])}</strong>
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="m-0 text-xs text-pretty text-secondary">GitHub splits contributions by kind per calendar year, so these cover the whole years the last 12 months touch. Private ones are counted, never split.</p>
          </section>
        </div>
      </div>
    </Dialog>
  );
}
