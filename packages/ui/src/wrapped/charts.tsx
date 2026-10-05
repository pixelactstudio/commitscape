import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { squarify } from "../charts/treemap";
import { useTip } from "../charts/tip";
import { CountUp } from "../motion";
import { grouped, many } from "../format";

export type Slice = { key: string; label: string; value: number; colour: string };

const TAU = Math.PI * 2;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);
const pctText = (part: number, whole: number) => (part > 0 && whole > 0 && (part * 100) / whole < 0.5 ? "<1%" : `${pct(part, whole)}%`);

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const f = (n: number) => n.toFixed(2);
  const a = [f(cx + r * Math.sin(from)), f(cy - r * Math.cos(from))];
  const b = [f(cx + r * Math.sin(to)), f(cy - r * Math.cos(to))];
  return `M ${a[0]} ${a[1]} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${b[0]} ${b[1]}`;
}

/** A ring cut into slices, the biggest share in its middle and a legend beside it with each slice's number and share. */
export function Donut({ slices, unit, centre }: { slices: Slice[]; unit: string; centre?: ReactNode }) {
  const tip = useTip();
  const [on, setOn] = useState<string | null>(null);
  const list = slices.filter((s) => s.value > 0);
  const total = list.reduce((n, s) => n + s.value, 0);
  const size = 176;
  const r = 70;
  const gap = list.length > 1 ? 0.025 : 0;
  const starts = list.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + (s.value / total) * TAU], [0]);
  const top = list[0];
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={list.map((s) => `${s.label} ${pct(s.value, total)}%`).join(", ")}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--empty)" strokeWidth={22} />
          {list.map((s, i) => {
            const from = starts[i] ?? 0;
            const to = starts[i + 1] ?? TAU;
            const d = list.length === 1 ? null : arc(size / 2, size / 2, r, from + gap / 2, Math.max(from + gap / 2 + 0.001, to - gap / 2));
            const style = { opacity: on && on !== s.key ? 0.35 : 1, transition: "opacity 160ms, stroke-width 160ms" };
            const hover = {
              ...tip(
                <>
                  <strong>{s.label}</strong>
                  <div className="note">
                    {grouped(s.value)} {unit} · {pctText(s.value, total)}
                  </div>
                </>,
              ),
              onMouseEnter: () => setOn(s.key),
              onMouseOut: () => setOn(null),
            };
            return d ? (
              <path key={s.key} d={d} fill="none" stroke={s.colour} strokeWidth={on === s.key ? 26 : 22} style={style} {...hover} />
            ) : (
              <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.colour} strokeWidth={22} {...hover} />
            );
          })}
        </svg>
        {top && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centre ?? (
              <>
                <span className="text-[1.7rem] leading-none font-semibold tracking-[-0.03em]">
                  <CountUp value={pct(top.value, total)} format={(n) => `${Math.round(n)}%`} />
                </span>
                <span className="mt-1 max-w-[6.5rem] truncate text-xs text-secondary">{top.label}</span>
              </>
            )}
          </div>
        )}
      </div>
      <ul className="m-0 flex w-full min-w-0 list-none flex-col gap-1 p-0">
        {list.map((s) => (
          <li key={s.key} className={`flex items-center gap-2.5 rounded-[var(--radius-element)] px-2 py-1.5 text-sm transition-colors ${on === s.key ? "bg-[var(--color-overlay-hover)]" : ""}`} onMouseEnter={() => setOn(s.key)} onMouseLeave={() => setOn(null)}>
            <span className="size-2.5 flex-none rounded-full" style={{ background: s.colour }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="text-secondary tnum">{grouped(s.value)}</span>
            <span className="w-10 text-end font-medium tnum">{pctText(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK_LONG = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/** Contributions on each day of the week, Monday first, the busiest day marked. */
export function WeekBars({ days, unit = "contributions" }: { days: number[]; unit?: string }) {
  const tip = useTip();
  const most = Math.max(1, ...days);
  const total = days.reduce((a, b) => a + b, 0);
  const best = days.indexOf(Math.max(...days));
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-secondary">
        Most on <span className="font-medium text-primary">{WEEK_LONG[best]}</span>: {pct(days[best] ?? 0, total)}% of the year. Weekends hold {pct((days[5] ?? 0) + (days[6] ?? 0), total)}%.
      </p>
      <div className="grid h-[180px] grid-cols-7 items-end gap-2 sm:gap-3" role="img" aria-label={WEEK.map((d, i) => `${d} ${grouped(days[i] ?? 0)}`).join(", ")}>
        {days.map((n, i) => (
          <div key={WEEK[i]} className="group flex h-full flex-col items-center justify-end gap-1.5" {...tip(
            <>
              <strong>
                {grouped(n)} {unit}
              </strong>
              <div className="note">on {WEEK_LONG[i]}</div>
            </>,
          )}>
            <span className={`text-[11px] tnum ${i === best ? "font-semibold text-primary" : "text-secondary opacity-0 transition-opacity group-hover:opacity-100"}`}>{grouped(n)}</span>
            <span className="w-full origin-bottom rounded-t-[5px] rounded-b-[2px] transition-[filter] group-hover:brightness-110" style={{ height: `${Math.max(2, (n / most) * 100)}%`, background: i === best ? "var(--brand)" : "color-mix(in srgb, var(--brand) 38%, transparent)" }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2 text-center text-xs text-secondary sm:gap-3">
        {WEEK.map((d, i) => (
          <span key={d} className={i === best ? "font-medium text-primary" : ""}>
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

/** What became of the pull requests opened in a year: merged, closed without merging, or still open. */
export function Outcomes({ merged, closed, open }: { merged: number; closed: number; open: number }) {
  const tip = useTip();
  const total = merged + closed + open;
  const parts = [
    { key: "merged", label: "Merged", value: merged, colour: "var(--s7)" },
    { key: "open", label: "Still open", value: open, colour: "var(--s3)" },
    { key: "closed", label: "Closed unmerged", value: closed, colour: "var(--s8)" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[2.6rem] leading-none font-semibold tracking-[-0.04em]">
          <CountUp value={pct(merged, total)} format={(n) => `${Math.round(n)}%`} />
        </span>
        <span className="text-sm text-secondary">of the {many(total, "pull request", "pull requests")} opened were merged</span>
      </div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} className="h-full" style={{ flexGrow: p.value, background: p.colour }} {...tip(
              <>
                <strong>{p.label}</strong>
                <div className="note">
                  {grouped(p.value)} · {pctText(p.value, total)}
                </div>
              </>,
            )} />
          ))}
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3">
        {parts.map((p) => (
          <div key={p.key} className="flex flex-col gap-0.5">
            <dt className="flex items-center gap-1.5 text-xs text-secondary">
              <span className="size-2 rounded-full" style={{ background: p.colour }} aria-hidden />
              {p.label}
            </dt>
            <dd className="m-0 text-lg font-semibold tnum">{grouped(p.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const TILES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s7)", "var(--s6)", "var(--s8)"];

/** Repositories as tiles sized by their commits (or another count), the biggest first, each named when it has room. */
export function RepoTiles({ repositories, link, unit = ["commit", "commits"] }: { repositories: { repo: string; commits: number; private: boolean }[]; link: (repo: string) => string; unit?: [string, string] }) {
  const tip = useTip();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(([e]) => e && setWidth(Math.round(e.contentRect.width)));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const top = repositories.slice(0, 8);
  const rest = repositories.slice(8).reduce((n, r) => n + r.commits, 0);
  const items = [...top.map((r, i) => ({ ...r, colour: TILES[i] ?? "var(--s1)" })), ...(rest > 0 ? [{ repo: "", commits: rest, private: false, colour: "light-dark(#c9c8c0, #4d4c48)" }] : [])];
  const height = width < 640 ? 360 : 280;
  const total = items.reduce((n, r) => n + r.commits, 0);
  const tiles = squarify(items, (r) => r.commits, { x: 0, y: 0, w: width, h: height });
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-[var(--radius-element)]" style={{ height }}>
      {tiles.map((t) => {
        const r = t.item;
        const label = r.repo ? (r.private ? "A private repository" : r.repo) : `${many(repositories.length - 8, "more repository", "more repositories")}`;
        const roomy = t.w > 90 && t.h > 46;
        const body = (
          <>
            {roomy && (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1 truncate text-[0.8rem] font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">
                  {r.private && <Lock size={11} aria-hidden />}
                  <span className="truncate">{r.repo ? (r.private ? "Private" : (r.repo.split("/")[1] ?? r.repo)) : "Others"}</span>
                </span>
                <span className="truncate text-[0.72rem] text-white/85 tnum">{many(r.commits, unit[0], unit[1])}</span>
              </span>
            )}
          </>
        );
        const style = { left: t.x + 1, top: t.y + 1, width: Math.max(0, t.w - 2), height: Math.max(0, t.h - 2), background: r.colour };
        const hover = tip(
          <>
            <strong>{label}</strong>
            <div className="note">
              {many(r.commits, unit[0], unit[1])} · {pctText(r.commits, total)}
            </div>
          </>,
        );
        const cls = "absolute flex items-start overflow-hidden rounded-[6px] p-2.5 no-underline transition-[filter] duration-150 hover:brightness-110";
        return r.repo && !r.private ? (
          <a key={r.repo} href={link(r.repo)} className={cls} style={style} aria-label={`${label}, ${many(r.commits, unit[0], unit[1])}`} {...hover}>
            {body}
          </a>
        ) : (
          <div key={r.repo || "rest"} className={cls} style={style} {...hover}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
