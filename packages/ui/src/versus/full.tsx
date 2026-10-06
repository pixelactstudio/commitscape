import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Award, Flame, Lock, MessagesSquare } from "lucide-react";
import { ICON } from "../design/tokens";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Achievement, SharedRepo, SharedWork, VersusFull, VersusPerson } from "@commitscape/data";
import { useTip } from "../charts/tip";
import { Face } from "../components/Face";
import { compact, day, grouped, many } from "../format";
import { A } from "../kit/A";
import { LangDot, Panel } from "../kit/layout";
import { Nothing, Reveal } from "../motion";
import { DuelRows, GrowBar } from "./duel";
import { toneOf, TONE, type Duel, type Side } from "./tone";

const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
const days = (n: number) => `${grouped(n)} ${Math.round(n) === 1 ? "day" : "days"}`;
const pct = (n: number) => `${Math.round(n)}%`;
const at = (h: number) => `${String(h).padStart(2, "0")}:00`;

function Who({ p, side, size = 24 }: { p: VersusPerson; side: Side; size?: 20 | 24 | 32 }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2" style={toneOf(side)}>
      <span className="flex-none rounded-full p-0.5 ring-2 ring-[var(--side)]">
        <Face login={p.identity.login} name={p.identity.login} size={size} />
      </span>
      <span className="truncate text-xs font-semibold">@{p.identity.login}</span>
    </span>
  );
}

function Pair({ a, b, children }: { a: ReactNode; b: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {children}
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <div className="flex min-w-0 flex-col gap-3">{a}</div>
        <div className="flex min-w-0 flex-col gap-3">{b}</div>
      </div>
    </div>
  );
}

function Fact({ value, label }: { value: ReactNode; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-md font-semibold tnum">{value}</span>
      <span className="type-micro">{label}</span>
    </span>
  );
}

function Calendar({ p, side }: { p: VersusPerson; side: Side }) {
  const tip = useTip();
  const { firstDay, days: list } = p.lastYear;
  const offset = (firstDay + 3) % 7;
  const cells = [...Array.from({ length: offset }, () => -1), ...list];
  const sorted = list.filter((n) => n > 0).sort((x, y) => x - y);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 1;
  const steps = [q(0.25), q(0.5), q(0.75)];
  const level = (n: number) => (n <= 0 ? 0 : n <= (steps[0] ?? 1) ? 0.3 : n <= (steps[1] ?? 1) ? 0.5 : n <= (steps[2] ?? 1) ? 0.75 : 1);
  const total = list.reduce((s, n) => s + n, 0);
  const best = list.reduce((b, n, i) => (n > b.n ? { n, i } : b), { n: 0, i: -1 });
  return (
    <div className="flex flex-col gap-3" style={toneOf(side)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Who p={p} side={side} />
        <div className="flex gap-5 text-end">
          <Fact value={grouped(total)} label="contributions" />
          {best.i >= 0 && <Fact value={grouped(best.n)} label={`best day, ${day(firstDay + best.i)}`} />}
          <Fact
            value={
              <span className="inline-flex items-center gap-1">
                {p.totals.currentStreak > 0 && <Flame size={ICON.xs} className="text-[var(--s2)]" aria-hidden />}
                {days(p.totals.currentStreak)}
              </span>
            }
            label="streak now"
          />
        </div>
      </div>
      <div role="img" aria-label={`@${p.identity.login}: ${many(total, "contribution", "contributions")} over the last year`} className="grid grid-flow-col grid-rows-7 gap-0.5 sm:gap-0.75" style={{ gridAutoColumns: "minmax(0, 1fr)" }}>
        {cells.map((n, i) =>
          n < 0 ? (
            <span key={`pad${i}`} />
          ) : (
            <span
              key={i}
              className="aspect-square rounded-cell"
              style={{ background: n > 0 ? `color-mix(in oklab, var(--side) ${level(n) * 100}%, var(--empty))` : "var(--empty)" }}
              {...tip(
                <>
                  <strong>{many(n, "contribution", "contributions")}</strong>
                  <div className="note">{day(firstDay + i - offset)}</div>
                </>,
              )}
            />
          ),
        )}
      </div>
    </div>
  );
}

const METRICS = [
  ["contributions", "All", "Contributions"],
  ["commits", "Commits", "Commits"],
  ["prs", "PRs", "Pull requests opened"],
  ["reviews", "Reviews", "Reviews"],
] as const;
type Metric = (typeof METRICS)[number][0];

function Years({ v }: { v: VersusFull }) {
  const [metric, setMetric] = useState<Metric>("contributions");
  const { a, b } = v.people;
  const points = useMemo(() => {
    const all = [...a.years, ...b.years].filter((y) => y.contributions > 0).map((y) => y.year);
    if (all.length === 0) return [];
    const from = Math.min(...all);
    const to = Math.max(...all);
    const value = (p: VersusPerson, year: number) => {
      const joined = new Date(p.identity.createdAt).getUTCFullYear();
      if (year < joined) return null;
      return p.years.find((y) => y.year === year)?.[metric] ?? 0;
    };
    return Array.from({ length: to - from + 1 }, (_, i) => ({ year: String(from + i), a: value(a, from + i), b: value(b, from + i) }));
  }, [a, b, metric]);
  if (points.length === 0) return null;
  const label = METRICS.find(([m]) => m === metric)?.[2] ?? "";
  return (
    <Panel
      title="Over the years"
      description={`${label} on GitHub each year, side by side`}
      actions={
        <SegmentedControl label="Count" size="sm" value={metric} onChange={(m) => setMetric(m as Metric)}>
          {METRICS.map(([m, l]) => (
            <SegmentedControlItem key={m} value={m} label={l} />
          ))}
        </SegmentedControl>
      }
    >
      <div className="flex flex-wrap gap-4">
        <Who p={a} side="a" size={20} />
        <Who p={b} side="b" size={20} />
      </div>
      <div className="-mx-1 h-65">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tickFormatter={(n: number) => compact(n)} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip content={<YearTip a={a.identity.login} b={b.identity.login} unit={label.toLowerCase()} />} cursor={{ stroke: "var(--color-border-emphasized)" }} />
            <Line type="monotone" dataKey="a" name={a.identity.login} stroke={TONE.a} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-surface)" }} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="b" name={b.identity.login} stroke={TONE.b} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-surface)" }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function YearTip({ active, payload, label, a, b, unit }: { active?: boolean; payload?: { dataKey?: string; value?: number | null }[]; label?: string; a: string; b: string; unit: string }) {
  if (!active || !payload?.length) return null;
  const of = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  return (
    <div className="min-w-40 rounded-md border border-line bg-popover px-3 py-2 text-sm shadow-md">
      <div className="mb-1 font-medium text-primary">
        {label} · {unit}
      </div>
      {(
        [
          ["a", a],
          ["b", b],
        ] as const
      ).map(([k, login]) => (
        <div key={k} className="flex items-center justify-between gap-4 text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: TONE[k] }} />@{login}
          </span>
          <span className="font-medium text-primary tnum">{of(k) === null || of(k) === undefined ? "not on GitHub yet" : grouped(of(k) ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

function pullDuels(v: VersusFull): Duel[] {
  const { a, b } = v.people;
  const t = (p: VersusPerson) => p.totals;
  const rate = (p: VersusPerson) => (t(p).prsOpened > 0 ? (t(p).prsMerged * 100) / t(p).prsOpened : null);
  const capped = [a, b].filter((p) => p.read.prs < p.read.prsTotal);
  return [
    { key: "opened", label: "Opened", a: t(a).prsOpened, b: t(b).prsOpened, format: grouped },
    { key: "merged", label: "Merged", a: t(a).prsMerged, b: t(b).prsMerged, format: grouped },
    { key: "rate", label: "Share merged", a: rate(a), b: rate(b), format: pct },
    { key: "open", label: "Open now", a: t(a).prsOpen, b: t(b).prsOpen, format: grouped, winner: null },
    { key: "closed", label: "Closed unmerged", a: t(a).prsClosed, b: t(b).prsClosed, format: grouped, winner: null },
    { key: "lines", label: "Lines merged", a: t(a).linesAdded === null ? null : (t(a).linesAdded ?? 0) + (t(a).linesRemoved ?? 0), b: t(b).linesAdded === null ? null : (t(b).linesAdded ?? 0) + (t(b).linesRemoved ?? 0), format: compact },
    { key: "merge", label: "Time to merge", a: t(a).hoursToMerge, b: t(b).hoursToMerge, lowerWins: true, format: hours, note: capped.length > 0 ? `From the newest ${capped.map((p) => `${grouped(p.read.prs)} of @${p.identity.login}'s`).join(" and ")} pull requests.` : undefined },
  ];
}

function rhythmDuels(v: VersusFull): Duel[] {
  const { a, b } = v.people;
  const year = (p: VersusPerson) => p.lastYear.days.reduce((s, n) => s + n, 0);
  return [
    { key: "now", label: "Streak now", a: a.totals.currentStreak, b: b.totals.currentStreak, format: days },
    { key: "longest", label: "Longest streak", a: a.totals.longestStreak, b: b.totals.longestStreak, format: days },
    { key: "active", label: "Active days", a: a.totals.activeDays, b: b.totals.activeDays, format: days },
    { key: "year", label: "Contributions, last year", a: year(a), b: year(b), format: grouped },
    { key: "all", label: "Contributions, all time", a: a.totals.contributions, b: b.totals.contributions, format: grouped },
    { key: "issues", label: "Issues opened", a: a.totals.issues, b: b.totals.issues, format: grouped },
    { key: "repos", label: "Public repositories worked in", a: a.repositories, b: b.repositories, format: grouped },
  ];
}

const LANGUAGES = 5;

function Languages({ p, side, shared }: { p: VersusPerson; side: Side; shared: Set<string> }) {
  const tip = useTip();
  const sum = p.languages.reduce((s, l) => s + l.commits, 0);
  const top = p.languages.slice(0, LANGUAGES).filter((l) => l.commits * 100 >= sum);
  const rest = sum - top.reduce((s, l) => s + l.commits, 0);
  const parts = [...top, ...(rest > 0 ? [{ name: "Other", colour: null, commits: rest }] : [])];
  return (
    <>
      <Who p={p} side={side} />
      {sum === 0 ? (
        <p className="m-0 type-caption">No commits on GitHub to tell their languages from.</p>
      ) : (
        <>
          <span className="flex h-3 gap-0.5 overflow-hidden rounded-xs">
            {parts.map((l) => (
              <span
                key={l.name}
                className="block h-full min-w-0.75"
                style={{ width: `${(l.commits * 100) / sum}%`, background: l.colour ?? "var(--other)" }}
                {...tip(
                  <>
                    <strong>{l.name}</strong>
                    <div className="note">{`${Math.round((l.commits * 100) / sum)}%, ${many(l.commits, "commit", "commits")}`}</div>
                  </>,
                )}
              />
            ))}
          </span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs">
            {parts.map((l) => (
              <li key={l.name} className="flex items-center gap-2">
                <LangDot colour={l.colour} />
                <span className="min-w-0 flex-1 truncate">
                  {l.name}
                  {shared.has(l.name) && <span className="ms-2 rounded-full border border-line px-1.5 py-px type-micro">both</span>}
                </span>
                <span className="type-micro tnum">{(l.commits * 100) / sum < 1 ? "<1%" : `${Math.round((l.commits * 100) / sum)}%`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Hours({ p, side }: { p: VersusPerson; side: Side }) {
  const tip = useTip();
  const clock = p.clock;
  if (!clock)
    return (
      <div className="flex flex-col gap-2">
        <Who p={p} side={side} size={20} />
        <p className="m-0 type-caption">GitHub gave no commit times to read for @{p.identity.login}.</p>
      </div>
    );
  const most = Math.max(1, ...clock.hours);
  const peak = clock.hours.indexOf(Math.max(...clock.hours));
  const night = clock.hours.reduce((s, n, h) => (h >= 22 || h < 5 ? s + n : s), 0);
  return (
    <div className="flex flex-col gap-2" style={toneOf(side)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Who p={p} side={side} size={20} />
        <span className="type-micro">
          busiest at <strong className="text-primary">{at(peak)}</strong> · {Math.round((night * 100) / clock.sampled)}% at night
        </span>
      </div>
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.75" role="img" aria-label={`@${p.identity.login} commits most at ${at(peak)}`}>
        {clock.hours.map((n, h) => (
          <span
            key={h}
            className="h-8 rounded-cell"
            style={{ background: n > 0 ? `color-mix(in oklab, var(--side) ${Math.round(18 + (n / most) * 82)}%, var(--empty))` : "var(--empty)" }}
            {...tip(
              <>
                <strong>
                  {at(h)} to {at((h + 1) % 24)}
                </strong>
                <div className="note">{`${many(n, "commit", "commits")} of their newest ${grouped(clock.sampled)}`}</div>
              </>,
            )}
          />
        ))}
      </div>
    </div>
  );
}

function HourScale() {
  return (
    <div className="grid grid-cols-4 type-micro tnum">
      {[0, 6, 12, 18].map((h) => (
        <span key={h}>{at(h)}</span>
      ))}
    </div>
  );
}

function workWords(w: SharedWork): string {
  const n = (v: number, one: string, more: string) => `${v >= 10_000 ? compact(v) : grouped(v)} ${v === 1 ? one : more}`;
  return [w.prsMerged > 0 && n(w.prsMerged, "merged", "merged"), w.commits > 0 && n(w.commits, "commit", "commits"), w.reviews > 0 && n(w.reviews, "review", "reviews")].filter(Boolean).join(" · ") || "—";
}

const weight = (w: SharedWork) => w.prsMerged * 4 + w.commits + w.reviews;

function SharedRow({ r, a, b }: { r: SharedRepo; a: string; b: string }) {
  const most = Math.max(1, weight(r.a), weight(r.b));
  const side = (s: Side) => {
    const w = s === "a" ? r.a : r.b;
    const login = s === "a" ? a : b;
    return (
      <div className={`flex min-w-0 flex-col gap-1.5 ${s === "a" ? "md:items-end md:text-end" : ""}`}>
        <div className={`flex w-full items-center justify-between gap-2 md:justify-start ${s === "a" ? "md:flex-row-reverse" : ""}`}>
          <span className="truncate type-micro tnum">
            <span className="font-medium text-primary md:hidden">@{login} </span>
            {workWords(w)}
          </span>
          <A href={`/u/${login}/${r.owner}/${r.name}`} className="flex-none text-2xs font-medium text-brand no-underline hover:underline" aria-label={`@${login}'s Standing in ${r.owner}/${r.name}`}>
            Standing →
          </A>
        </div>
        <GrowBar value={weight(w) / most} side={s} lead={weight(w) >= weight(s === "a" ? r.b : r.a)} />
      </div>
    );
  };
  return (
    <li className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)_minmax(0,17rem)] md:items-center md:gap-6">
      <A href={`/gh/${r.owner}/${r.name}`} className="flex min-w-0 items-center gap-3 text-primary no-underline hover:underline">
        <Face login={r.owner} name={r.owner} size={32} shape="rounded" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">
            <span className="text-secondary">{r.owner}/</span>
            {r.name}
          </span>
          <span className="flex items-center gap-3 type-micro">
            {r.language && (
              <span className="inline-flex items-center gap-1.5">
                <LangDot colour={r.colour} />
                {r.language}
              </span>
            )}
            {r.stars > 0 && <span>★ {compact(r.stars)}</span>}
          </span>
        </span>
      </A>
      {side("a")}
      {side("b")}
    </li>
  );
}

const SHARED_SHOWN = 6;

function Shared({ v }: { v: VersusFull }) {
  const [all, setAll] = useState(false);
  const { a, b } = v.people;
  const la = a.identity.login;
  const lb = b.identity.login;
  return (
    <Panel padding={0} title="Where both work" description="Public repositories with work from each of them, by merged pull requests, commits and reviews. Open a Standing to see where each stands there.">
      {v.between && (
        <p className="m-0 mx-5 flex items-start gap-2 rounded-md bg-overlay-hover px-3 py-2 text-xs">
          <MessagesSquare size={ICON.md} className="mt-0.5 flex-none text-secondary" aria-hidden />
          <span>
            {[v.between.aReviewedB > 0 && `@${la} reviewed @${lb}'s pull requests ${many(v.between.aReviewedB, "time", "times")}`, v.between.bReviewedA > 0 && `@${lb} reviewed @${la}'s ${many(v.between.bReviewedA, "time", "times")}`].filter(Boolean).join("; ")}
            <span className="text-secondary">, as far as their newest reviews show.</span>
          </span>
        </p>
      )}
      {v.shared.length === 0 ? (
        <Nothing compact title="No repository in common yet." words={`@${la} and @${lb} have no public repository where both have merged, committed or reviewed.`} />
      ) : (
        <>
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,17rem)_minmax(0,17rem)] gap-6 border-b border-line px-5 pb-2 text-2xs font-medium text-secondary md:grid">
            <span>{many(v.shared.length, "repository", "repositories")}</span>
            <span className="text-end">@{la}</span>
            <span>@{lb}</span>
          </div>
          <ol className="m-0 list-none divide-y divide-line p-0 pb-2">
            {(all ? v.shared : v.shared.slice(0, SHARED_SHOWN)).map((r) => (
              <SharedRow key={`${r.owner}/${r.name}`} r={r} a={la} b={lb} />
            ))}
          </ol>
          {v.shared.length > SHARED_SHOWN && (
            <div className="border-t border-line px-5 py-2">
              <Button label={all ? "Show fewer" : `Show all ${v.shared.length}`} variant="ghost" size="sm" onClick={() => setAll(!all)} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Medal({ a }: { a: Achievement }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-line bg-body p-2.5">
      <span className="medal-earned grid size-8 flex-none place-items-center rounded-full">
        <Award size={ICON.md} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold">{a.title}</span>
        <span className="type-micro text-pretty">{[a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule}</span>
      </span>
    </li>
  );
}

function Archetype({ p, side }: { p: VersusPerson; side: Side }) {
  const main = p.archetypes[0];
  return (
    <>
      <Who p={p} side={side} />
      <div className="relative flex min-h-32 flex-1 flex-col justify-end gap-1.5 overflow-hidden rounded-md border border-line p-4" style={{ ...toneOf(side), background: "linear-gradient(135deg, var(--side-soft), transparent 70%), var(--color-background-body)" }}>
        <span className="type-eyebrow">{main ? "Archetype" : "No Archetype yet"}</span>
        <span className="text-2xl leading-none font-semibold tracking-snug">{main ? main.title : "Not decided"}</span>
        <span className="type-caption text-pretty">{main ? main.rule : p.totals.contributions < 50 ? "Rules start at 50 contributions." : "None of the written rules fits their numbers."}</span>
        {p.archetypes.length > 1 && <span className="type-micro">Also {p.archetypes.slice(1).map((x) => x.title).join(", ")}</span>}
      </div>
    </>
  );
}

function Only({ p, side, other }: { p: VersusPerson; side: Side; other: VersusPerson }) {
  const theirs = new Set(other.achievements.filter((x) => x.earned).map((x) => x.id));
  const only = p.achievements.filter((x) => x.earned && !theirs.has(x.id));
  return (
    <div className="flex flex-col gap-2" style={toneOf(side)}>
      <span className="text-2xs font-medium text-secondary">Only @{p.identity.login}</span>
      {only.length === 0 ? (
        <p className="m-0 flex items-center gap-2 type-caption">
          <Lock size={ICON.xs} aria-hidden /> {p.achievements.some((x) => x.earned) ? "Nothing the other has not reached too." : `No Achievement reached yet, of ${p.achievements.length}.`}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {only.map((x) => (
            <Medal key={x.id} a={x} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Traits({ a, b }: { a: VersusPerson; b: VersusPerson }) {
  const inB = new Set(b.achievements.filter((x) => x.earned).map((x) => x.id));
  const both = a.achievements.filter((x) => x.earned && inB.has(x.id));
  return (
    <Panel title="Archetypes and Achievements" description="Labels and milestones from written rules over their numbers; never a guess">
      <Pair a={<Archetype p={a} side="a" />} b={<Archetype p={b} side="b" />} />
      {both.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-2xs font-medium text-secondary">Reached by both</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {both.map((x) => (
              <li key={x.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-body py-1 ps-1 pe-3 text-sm font-medium" title={x.rule}>
                <span className="medal-earned grid size-5 place-items-center rounded-full">
                  <Award size={ICON.xs} aria-hidden />
                </span>
                {x.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Pair a={<Only p={a} side="a" other={b} />} b={<Only p={b} side="b" other={a} />} />
    </Panel>
  );
}

/** The full side-by-side of two people: the views, their last years, careers, pull requests, rhythm, languages, hours, shared repositories, Archetypes and Achievements. Sections with nothing in them are left out. */
export function VersusSections({ v }: { v: VersusFull }) {
  const { a, b } = v.people;
  const langA = new Set(a.languages.slice(0, LANGUAGES).map((l) => l.name));
  const shared = new Set(b.languages.slice(0, LANGUAGES).map((l) => l.name).filter((n) => langA.has(n)));
  const anyLanguages = a.languages.length + b.languages.length > 0;
  const anyClock = !!a.clock || !!b.clock;
  return (
    <div className="flex flex-col gap-5">
      <Reveal>
        <Panel title="The last year" description="Contributions a day on GitHub: commits, pull requests, reviews and issues">
          <Pair a={<Calendar p={a} side="a" />} b={<Calendar p={b} side="b" />} />
        </Panel>
      </Reveal>
      <Reveal>
        <Years v={v} />
      </Reveal>
      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal className="flex flex-col gap-3">
          <SectionHead title="Pull requests" words="Across all of GitHub, from the pull requests read for each" />
          <DuelRows rows={pullDuels(v)} label="Pull requests" />
        </Reveal>
        <Reveal className="flex flex-col gap-3">
          <SectionHead title="Streaks and days" words="Days in a row with a contribution, and how much they show up" />
          <DuelRows rows={rhythmDuels(v)} label="Streaks and days" />
        </Reveal>
      </div>
      {anyLanguages && (
        <Reveal>
          <Panel title="Languages" description="Each repository's main language, weighted by their commits to it, over every year">
            <Pair a={<Languages p={a} side="a" shared={shared} />} b={<Languages p={b} side="b" shared={shared} />}>
              {shared.size > 0 && <p className="m-0 type-caption">Both write {[...shared].join(", ")}.</p>}
            </Pair>
          </Panel>
        </Reveal>
      )}
      {anyClock && (
        <Reveal>
          <Panel title="When they commit" description="The hour of their newest commits, on each commit's own clock; darker is busier">
            <div className="flex flex-col gap-4">
              <Hours p={a} side="a" />
              <Hours p={b} side="b" />
              <HourScale />
            </div>
          </Panel>
        </Reveal>
      )}
      <Reveal>
        <Shared v={v} />
      </Reveal>
      <Reveal>
        <Traits a={a} b={b} />
      </Reveal>
      <p className="m-0 text-center type-micro">
        Numbers come from GitHub's public record and the repositories commitscape has read.
      </p>
    </div>
  );
}

function SectionHead({ title, words }: { title: string; words: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h2 className="m-0 type-panel">{title}</h2>
      <p className="m-0 type-caption">{words}</p>
    </div>
  );
}
