import type { CSSProperties } from "react";
import { Flame } from "lucide-react";
import type { Profile } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { grouped, many } from "../format";
import { Stat } from "../kit/layout";
import { BEAT, motion } from "../motion";
import { DAY, streakHeat, WEEKDAYS, weekdayOf } from "./days";

/** The streak running now, laid out like the numbers beside it, with a flame by the number whose colour climbs with its length; the longest streak beneath, and the last seven days as dots. */
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
  const value = (
    <span className="inline-flex items-center gap-1.5">
      {grouped(now)}
      <span className="text-md font-medium tracking-normal">{now === 1 ? "day" : "days"}</span>
      <motion.span aria-hidden className={`ms-0.5 inline-grid place-items-center ${lit ? "text-[var(--heat)]" : "text-tertiary"}`} style={{ transformOrigin: "50% 90%", filter: lit && now >= 7 ? "drop-shadow(0 0 6px var(--heat))" : undefined }} animate={lit ? { scale: [1, 1.08, 0.97, 1.04, 1], rotate: [0, -3, 2, -1, 0] } : undefined} transition={lit ? { duration: BEAT.hold, repeat: Infinity, ease: "easeInOut" } : undefined}>
        <Flame size={ICON.lg} strokeWidth={2} fill={lit ? "currentColor" : "none"} fillOpacity={0.28} />
      </motion.span>
    </span>
  );
  return (
    <div style={{ "--heat": heat.colour } as CSSProperties}>
      <Stat size="sm" value={value} label={lit ? "Streak now" : "No streak today"} note={lit ? `${heat.word} · longest ${many(longest, "day", "days")}` : longest > 0 ? `longest ${many(longest, "day", "days")}` : "one contribution starts one"}>
        <span className="mt-1 flex gap-1" aria-label={`${week.filter((w) => w.n > 0).length} of the last 7 days with a contribution`} role="img">
          {week.map((w) => (
            <span key={w.d} title={`${WEEKDAYS[weekdayOf(w.d)]}: ${many(w.n, "contribution", "contributions")}`} className={`block h-1.5 w-4 rounded-full ${w.n > 0 ? "" : "bg-[var(--color-track)]"}`} style={w.n > 0 ? { background: lit ? "var(--heat)" : "var(--brand)" } : undefined} />
          ))}
        </span>
      </Stat>
    </div>
  );
}
