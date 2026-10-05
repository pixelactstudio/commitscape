import type { CSSProperties } from "react";
import { Flame } from "lucide-react";
import type { Profile } from "@commitscape/data";
import { grouped, many } from "../format";
import { motion } from "../motion";
import { DAY, streakHeat, WEEKDAYS, weekdayOf } from "./days";

/** The streak running now, large, with a flame whose colour climbs with its length; the longest streak beneath, and the last seven days as dots. */
export function StreakCell({ profile }: { profile: Profile }) {
  const { currentStreak: now, longestStreak: longest } = profile.totals;
  const heat = streakHeat(now);
  const lit = now > 0;
  const { firstDay, days } = profile.calendar;
  const today = Math.floor(profile.fetchedAt / DAY);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = today - 6 + i;
    return { d, n: days[d - firstDay] ?? 0 };
  });
  return (
    <div role="group" aria-label="Current streak" className="flex min-w-0 items-start gap-3" style={{ "--heat": heat.colour } as CSSProperties}>
      <span className={`relative grid size-[40px] flex-none place-items-center rounded-[12px] ${lit ? "bg-[color-mix(in_oklab,var(--heat)_16%,transparent)] text-[var(--heat)]" : "bg-[var(--empty)] text-secondary"}`} style={lit && now >= 7 ? { boxShadow: "0 0 18px -4px var(--heat)" } : undefined}>
        <motion.span className="grid place-items-center" style={{ transformOrigin: "50% 90%" }} animate={lit ? { scale: [1, 1.08, 0.97, 1.04, 1], rotate: [0, -3, 2, -1, 0] } : undefined} transition={lit ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}>
          <Flame size={22} strokeWidth={2} fill={lit ? "currentColor" : "none"} fillOpacity={0.28} aria-hidden />
        </motion.span>
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={`text-[1.25rem] leading-none font-semibold tracking-[-0.03em] ${lit ? "text-[var(--heat)]" : "text-primary"}`}>
          {grouped(now)} <span className="text-[0.95rem] font-medium tracking-normal">{now === 1 ? "day" : "days"}</span>
        </span>
        <span className="mt-1 text-sm font-medium text-primary">{lit ? "Streak now" : "No streak today"}</span>
        <span className="text-[0.8rem] text-secondary">{lit ? `${heat.word} · longest ${many(longest, "day", "days")}` : longest > 0 ? `One contribution starts a new one. Longest ${many(longest, "day", "days")}` : "One contribution starts one"}</span>
        <span className="mt-1 flex gap-1" aria-label={`${week.filter((w) => w.n > 0).length} of the last 7 days with a contribution`} role="img">
          {week.map((w) => (
            <span key={w.d} title={`${WEEKDAYS[weekdayOf(w.d)]}: ${many(w.n, "contribution", "contributions")}`} className={`block h-1.5 w-4 rounded-full ${w.n > 0 ? "" : "bg-[var(--color-track)]"}`} style={w.n > 0 ? { background: lit ? "var(--heat)" : "var(--brand)" } : undefined} />
          ))}
        </span>
      </span>
    </div>
  );
}
