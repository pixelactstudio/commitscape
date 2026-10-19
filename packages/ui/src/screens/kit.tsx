import { Children, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { RotateCw, Tag, TriangleAlert } from "lucide-react";
import { AreaTrend, StackedColumns, type Point } from "../charts/Trend";
import { buckets, sum } from "../charts/buckets";
import { ChartFrame, TableAction, TableView } from "../charts/common";
import { useTip } from "../charts/tip";
import { TipCard } from "../charts/Tip";
import { ICON } from "../design/tokens";
import { Nothing } from "../motion/Nothing";
import type { Go } from "../route";
import { day, many, within } from "../format";

/** A screen's column of Panels, faded while a new Window's numbers are on their way. */
export function ScreenFrame({ stale = false, children, label }: { stale?: boolean; children: ReactNode; label?: string }) {
  return (
    <div className={`@container flex min-w-0 flex-col gap-gutter pt-5 transition-opacity duration-(--duration-instant) ${stale ? "opacity-60" : ""}`} aria-busy={stale || undefined} aria-label={label}>
      {children}
    </div>
  );
}

export { Quiet } from "../kit/primitives";

/** What a screen says when the Window holds no commits: the mascot, what is missing, and a way to a longer Window. */
export function EmptyWindow({ window, what, go }: { window: string; what: string; go: Go }) {
  return (
    <Nothing
      compact
      title={`No commits ${within(window)}`}
      words={what}
      action={window === "all" ? undefined : <Button label="Show all time" variant="secondary" size="sm" onClick={() => go({ window: "all", from: undefined, to: undefined })} />}
    />
  );
}

/** What a list says when its filters leave nothing: what was searched for, a hint at what to change, and a button that takes the filters off. */
export function NoMatch({ what, query, words, onClear, clear = "Clear filters" }: { what: string; query?: string; words?: string; onClear: () => void; clear?: string }) {
  return <Nothing compact title={query ? `No ${what} match “${query}”` : `No ${what} match these filters`} words={words} action={<Button label={clear} variant="secondary" size="sm" onClick={onClear} />} />;
}

/** What went wrong reading an answer, in place of the screen: what failed, the reason when there is one, and a way to ask again unless the Report simply does not hold it. */
export function Failed({ words, title = "This part of the Report could not be read", action, retry }: { words: string | null; title?: string; action?: ReactNode; retry?: () => void }) {
  return (
    <ScreenFrame>
      <div role="alert" className="flex flex-col items-center gap-3 surface px-5 py-10 text-center">
        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-removed-soft text-removed">
          <TriangleAlert size={ICON.lg} />
        </span>
        <p className="m-0 type-heading">{title}</p>
        {words && <p className="m-0 max-w-prose type-description text-pretty">{words}</p>}
        {retry && <p className="m-0 type-caption">Check your connection, then try again.</p>}
        {(retry || action) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {retry && <Button label="Try again" variant="secondary" size="sm" icon={<Icon icon={RotateCw} size="sm" />} onClick={retry} />}
            {action}
          </div>
        )}
      </div>
    </ScreenFrame>
  );
}

const SHEET: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @min-[40rem]:grid-cols-3 [&>:last-child]:col-span-2 @min-[40rem]:[&>:last-child]:col-span-1",
  4: "grid-cols-2 @min-[40rem]:grid-cols-4",
  5: "grid-cols-2 @min-[48rem]:grid-cols-5 [&>:last-child]:col-span-2 @min-[48rem]:[&>:last-child]:col-span-1",
  6: "grid-cols-2 @min-[30rem]:grid-cols-3 @min-[64rem]:grid-cols-6",
  7: "grid-cols-2 @min-[30rem]:grid-cols-4 @min-[72rem]:grid-cols-7 [&>:last-child]:col-span-2 @min-[30rem]:[&>:last-child]:col-span-1",
};

/** A row of numbers in one bordered strip, each saying what it counts: as many columns as there are numbers when the screen is wide, two when it is narrow, and an odd one out at the end takes the width of its row. */
export function NumberStrip({ children }: { children: ReactNode }) {
  const count = Math.min(7, Math.max(1, Children.toArray(children).length));
  return <div className={`grid overflow-hidden surface ${SHEET[count]}`}>{children}</div>;
}

/** One number of a NumberStrip: the number, what it counts, and a line of what it leaves out. */
export function NumberCell({ id, value, label, note, tone }: { id: string; value: ReactNode; label: string; note?: ReactNode; tone?: "brand" }) {
  return (
    <div data-stat={id} className="flex min-w-0 flex-col gap-0.5 px-4 py-4 shadow-[-1px_0_0_0_var(--line),0_-1px_0_0_var(--line)] sm:px-5">
      <span data-value className={`type-stat ${tone === "brand" ? "text-brand" : "text-primary"}`}>
        {value}
      </span>
      <span className="type-label">{label}</span>
      <span className="min-h-5 type-caption text-pretty">{note ?? " "}</span>
    </div>
  );
}

export type BarItem = {
  key: string;
  label: ReactNode;
  value: number;
  shown: ReactNode;
  colour?: string;
  lead?: ReactNode;
  onClick?: () => void;
  title?: string;
};

/** Ranked bars, each with what it is and its number; rows that can be entered are buttons. */
export function BarList({ items, label, max }: { items: BarItem[]; label: string; max?: number }) {
  const most = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label={label}>
      {items.map((i) => {
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {i.lead}
              <span className="min-w-0 truncate type-ui text-primary">{i.label}</span>
            </span>
            <span className="text-end type-caption whitespace-nowrap tnum">{i.shown}</span>
            <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(i.value > 0 ? 1.5 : 0, (i.value * 100) / most)}%`,
                  background: i.colour ?? "var(--heat-3)",
                }}
              />
            </span>
          </>
        );
        const grid = "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-2 text-start";
        return (
          <li key={i.key}>
            {i.onClick ? (
              <button type="button" onClick={i.onClick} title={i.title} className={`${grid} plain-button row-hover`}>
                {body}
              </button>
            ) : (
              <div className={grid} title={i.title}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type Release = { day: number; label: string };

export type Span = { since: number; until: number };

const TREND_SUMMARY = (unit: string, total: number, from: string, to: string) => `${many(total, unit.replace(/s$/, ""), unit)} from ${from} to ${to}, in the periods listed in the table beneath`;

/** Commits over time as one soft area, in periods that suit the span, with its releases as ticks beneath; a click on a period picks its days, and so does its row in the table beneath. */
export function TrendOverTime({
  firstDay,
  days,
  unit,
  height = 240,
  releases,
  onPick,
  label = "Commits over time",
}: {
  firstDay: number;
  days: number[];
  unit: string;
  height?: number;
  releases?: Release[];
  onPick?: (span: Span) => void;
  label?: string;
}) {
  const list = buckets(firstDay, days.length, true);
  const sums = sum(days, firstDay, list);
  const points: Point[] = list.map((b, i) => ({
    key: b.key,
    label: b.label,
    tick: b.tick,
    value: sums[i] ?? 0,
    from: b.from,
    to: b.to,
  }));
  const inside = (releases ?? []).filter((r) => r.day >= firstDay && r.day < firstDay + days.length);
  const total = sums.reduce((a, b) => a + b, 0);
  return (
    <ChartFrame
      label={label}
      summary={TREND_SUMMARY(unit, total, day(firstDay), day(firstDay + Math.max(0, days.length - 1)))}
      table={
        <TableView
          title={label}
          head={["Period", unit, ...(onPick ? ["Open"] : [])]}
          rows={list.map((b, i) => [
            b.label,
            sums[i] ?? 0,
            ...(onPick
              ? [
                  (sums[i] ?? 0) > 0 ? (
                    <TableAction key={b.key} onClick={() => onPick({ since: b.from, until: b.to - 1 })}>
                      Show these {unit}
                    </TableAction>
                  ) : (
                    ""
                  ),
                ]
              : []),
          ])}
        >
          {inside.length > 0 && (
            <ul aria-label="Releases in this span" className="m-0 flex list-none flex-col gap-1 p-0 type-caption">
              {inside.map((r) => (
                <li key={`${r.label}${r.day}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="tnum">{day(r.day)}</span>
                </li>
              ))}
            </ul>
          )}
        </TableView>
      }
    >
      <div className="flex flex-col gap-1">
        <AreaTrend
          plain
          points={points}
          series={{ key: "value", label: unit, colour: "var(--brand)" }}
          unit={unit}
          height={height}
          onPick={onPick ? (p) => onPick({ since: Number(p.from), until: Number(p.to) - 1 }) : undefined}
        />
        {releases && <ReleaseRug firstDay={firstDay} days={days.length} releases={releases} buckets={list.map((b) => b.from)} />}
      </div>
    </ChartFrame>
  );
}

function ReleaseRug({ releases, buckets: starts, firstDay, days, bands = false }: { releases: Release[]; buckets: number[]; firstDay: number; days: number; bands?: boolean }) {
  const tip = useTip();
  const inside = releases.filter((r) => r.day >= firstDay && r.day < firstDay + days);
  const n = starts.length;
  if (n < 2) return <div className="h-5" />;
  const at = (d: number) => {
    let i = 0;
    while (i + 1 < n && (starts[i + 1] ?? Infinity) <= d) i++;
    const from = starts[i] ?? 0;
    const to = starts[i + 1] ?? firstDay + days;
    const frac = (d - from) / Math.max(1, to - from);
    return Math.max(0, Math.min(1, bands ? (i + frac) / n : (i + frac - 0.5) / (n - 1)));
  };
  return (
    <div className="relative ms-[38px] me-1 h-5" aria-hidden>
      {inside.length > 0 && <span className="absolute inset-x-0 top-2 h-px bg-line" />}
      {inside.map((r) => (
        <span
          key={`${r.label}${r.day}`}
          className="absolute top-0.5 h-3.5 w-2 -translate-x-1/2 cursor-default before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-secondary hover:before:bg-brand"
          style={{ left: `${at(r.day) * 100}%` }}
          {...tip(<TipCard icon={<Tag size={ICON.sm} aria-hidden />} kicker="Release" title={r.label} rows={[{ label: "Released", value: day(r.day) }]} />)}
        />
      ))}
    </div>
  );
}

export type Stack = {
  key: string;
  label: string;
  colour: string;
  days: number[];
};

/** Several day-by-day series stacked into columns, in calendar periods that suit the span; one can be brought forward, and a click picks a period. */
export function StacksOverTime({
  firstDay,
  stacks,
  unit,
  height = 260,
  focus = null,
  releases,
  onPick,
  label = "Commits over time, by person",
}: {
  firstDay: number;
  stacks: Stack[];
  unit: string;
  height?: number;
  focus?: string | null;
  releases?: Release[];
  onPick?: (span: Span, stack: string | null) => void;
  label?: string;
}) {
  const length = Math.max(0, ...stacks.map((s) => s.days.length));
  const list = buckets(firstDay, length, false);
  const sums = stacks.map((s) => sum(s.days, firstDay, list));
  const points: Point[] = list.map((b, i) => {
    const p: Point = {
      key: b.key,
      label: b.short,
      title: b.label,
      ...(b.tick === undefined ? {} : { tick: b.tick }),
      from: b.from,
      to: b.to,
    };
    stacks.forEach((s, j) => {
      p[s.key] = sums[j]?.[i] ?? 0;
    });
    return p;
  });
  const total = sums.reduce((n, s) => n + s.reduce((a, b) => a + b, 0), 0);
  return (
    <ChartFrame
      label={label}
      summary={TREND_SUMMARY(unit, total, day(firstDay), day(firstDay + Math.max(0, length - 1)))}
      table={
        <TableView
          title={label}
          head={["Period", ...stacks.map((s) => s.label), ...(onPick ? ["Open"] : [])]}
          rows={list.map((b, i) => [
            b.label,
            ...stacks.map((_, j) => sums[j]?.[i] ?? 0),
            ...(onPick
              ? [
                  stacks.some((_, j) => (sums[j]?.[i] ?? 0) > 0) ? (
                    <TableAction key={b.key} onClick={() => onPick({ since: b.from, until: b.to - 1 }, null)}>
                      Show these {unit}
                    </TableAction>
                  ) : (
                    ""
                  ),
                ]
              : []),
          ])}
        />
      }
    >
      <div className="flex flex-col gap-1">
        <StackedColumns
          plain
          points={points}
          series={stacks.map((s) => ({
            key: s.key,
            label: s.label,
            colour: s.colour,
          }))}
          unit={unit}
          height={height}
          focus={focus}
          onPick={onPick ? (p, stack) => onPick({ since: Number(p.from), until: Number(p.to) - 1 }, stack) : undefined}
        />
        {releases && <ReleaseRug bands firstDay={firstDay} days={length} releases={releases} buckets={list.map((b) => b.from)} />}
      </div>
    </ChartFrame>
  );
}
