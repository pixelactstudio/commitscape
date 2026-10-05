import type { Profile } from "@commitscape/data";
import { useTip } from "../charts/tip";
import { grouped, many, share as percent } from "../format";
import { Panel } from "../kit/layout";
import { Nothing } from "../motion";

const LANGUAGE_COLOURS = 6;
const SHORT = 4;

function languagesOf(profile: Profile) {
  const totals = new Map<string, number>();
  for (const y of profile.years) for (const l of y.languages) totals.set(l.name, (totals.get(l.name) ?? 0) + l.commits);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const named = ranked.slice(0, LANGUAGE_COLOURS).map(([n]) => n);
  const colour = (name: string) => (named.includes(name) ? `var(--s${named.indexOf(name) + 1})` : "var(--other)");
  const years = profile.years.filter((y) => y.languages.length > 0);
  return { totals, ranked, named, colour, years };
}

/** The languages of the repositories a person committed to, year by year, weighted by their commits: a row a year for long careers, a ring and a year-by-year trend for short ones. */
export function LanguagesOverTime({ profile }: { profile: Profile }) {
  const data = languagesOf(profile);
  return (
    <Panel title="Languages over the years" description="Each repository's main language, weighted by their commits to it" className="h-full [&>*]:h-full">
      {data.years.length === 0 ? <Nothing title="No languages to tell yet" words="Commits to a repository with a main language show up here." compact /> : data.years.length < SHORT ? <Short data={data} /> : <Long data={data} />}
    </Panel>
  );
}

type Data = ReturnType<typeof languagesOf>;

function Legend({ data }: { data: Data }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-secondary">
      {[...data.named, ...(data.ranked.length > data.named.length ? ["Other"] : [])].map((n) => (
        <li key={n} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: n === "Other" ? "var(--other)" : data.colour(n) }} />
          {n}
        </li>
      ))}
    </ul>
  );
}

function partsOf(data: Data, y: Data["years"][number]) {
  const sum = y.languages.reduce((n, l) => n + l.commits, 0);
  const other = y.languages.filter((l) => !data.named.includes(l.name)).reduce((n, l) => n + l.commits, 0);
  return { sum, parts: [...y.languages.filter((l) => data.named.includes(l.name)).map((l) => ({ name: l.name, commits: l.commits })), ...(other > 0 ? [{ name: "Other", commits: other }] : [])] };
}

function Long({ data }: { data: Data }) {
  const tip = useTip();
  const years = data.years.slice(-16);
  return (
    <div className="flex flex-col gap-3">
      <Legend data={data} />
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {years.map((y) => {
          const { sum, parts } = partsOf(data, y);
          return (
            <li key={y.year} className="grid grid-cols-[2.6rem_1fr] items-center gap-3">
              <span className="text-xs text-secondary tnum">{y.year}</span>
              <span className="flex h-3 gap-0.5">
                {parts.map((p, i) => (
                  <span
                    key={p.name}
                    className={`block h-full min-w-[3px] ${i === 0 ? "rounded-s-[4px]" : ""} ${i === parts.length - 1 ? "rounded-e-[4px]" : ""}`}
                    style={{ width: `${(p.commits * 100) / Math.max(1, sum)}%`, background: p.name === "Other" ? "var(--other)" : data.colour(p.name) }}
                    {...tip(
                      <>
                        <strong>{p.name}</strong>
                        <div className="note">
                          {y.year}: {percent(p.commits, sum)}, {many(p.commits, "commit", "commits")}
                        </div>
                      </>,
                    )}
                  />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Lead({ name, years }: { name: string; years: Data["years"] }) {
  const led = years.filter((y) => [...y.languages].sort((a, b) => b.commits - a.commits)[0]?.name === name).length;
  return (
    <p className="m-0 text-sm text-pretty">
      <strong>{name}</strong> {led === years.length ? (years.length === 1 ? "leads their only year so far." : `leads every one of their ${years.length} years.`) : `leads ${led} of their ${years.length} years.`}
    </p>
  );
}

const R = 52;
const STROKE = 16;
const CIRC = 2 * Math.PI * R;

function Short({ data }: { data: Data }) {
  const tip = useTip();
  const all = [...data.totals.values()].reduce((a, b) => a + b, 0);
  const rows = [...data.named.map((n) => ({ name: n, commits: data.totals.get(n) ?? 0 })), ...(data.ranked.length > data.named.length ? [{ name: "Other", commits: data.ranked.slice(data.named.length).reduce((s, [, v]) => s + v, 0) }] : [])];
  const colour = (n: string) => (n === "Other" ? "var(--other)" : data.colour(n));
  const top = rows[0];
  const share = (y: Data["years"][number], name: string) => {
    const { sum, parts } = partsOf(data, y);
    return (parts.find((p) => p.name === name)?.commits ?? 0) / Math.max(1, sum);
  };
  let at = 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-5">
      <div className="relative size-[136px] flex-none">
        <svg viewBox="0 0 136 136" className="block size-full -rotate-90" role="img" aria-label={rows.map((r) => `${r.name} ${Math.round((r.commits * 100) / Math.max(1, all))}%`).join(", ")}>
          <circle cx={68} cy={68} r={R} fill="none" stroke="var(--color-track)" strokeWidth={STROKE} />
          {rows.map((r) => {
            const len = (r.commits / Math.max(1, all)) * CIRC;
            const gap = rows.length > 1 ? Math.min(2, len / 2) : 0;
            const seg = (
              <circle
                key={r.name}
                cx={68}
                cy={68}
                r={R}
                fill="none"
                stroke={colour(r.name)}
                strokeWidth={STROKE}
                strokeDasharray={`${Math.max(0, len - gap)} ${CIRC}`}
                strokeDashoffset={-at}
                {...tip(
                  <>
                    <strong>{r.name}</strong>
                    <div className="note">
                      {percent(r.commits, all)}, {many(r.commits, "commit", "commits")}
                    </div>
                  </>,
                )}
              />
            );
            at += len;
            return seg;
          })}
        </svg>
        {top && (
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[1.35rem] leading-none font-semibold tracking-[-0.03em] tnum">{Math.round((top.commits * 100) / Math.max(1, all))}%</span>
            <span className="mt-1 max-w-[5.5rem] truncate text-xs text-secondary">{top.name}</span>
          </span>
        )}
      </div>
        <div className="flex min-w-0 flex-col gap-2">
          {top && <Lead name={top.name} years={data.years} />}
          <p className="m-0 text-xs text-secondary">
            {grouped(all)} commits in repositories with a main language, {many(data.ranked.length, "language", "languages")} in all.
          </p>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[0.7rem] text-secondary">
            <th className="pb-1.5 text-start font-medium">Language</th>
            {data.years.map((y) => (
              <th key={y.year} className="w-10 pb-1.5 sm:w-14 text-center font-medium tnum">
                {y.year}
              </th>
            ))}
            <th className="w-10 pb-1.5 text-end font-medium">All</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <td className="max-w-0 py-2 pe-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 flex-none rounded-[3px]" style={{ background: colour(r.name) }} />
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              {data.years.map((y) => {
                const s = share(y, r.name);
                return (
                  <td key={y.year} className="py-2">
                    <span className="mx-auto flex h-5 w-6 items-end sm:w-7 overflow-hidden rounded-[3px] bg-[var(--color-track)]" title={`${y.year}: ${Math.round(s * 100)}%`} aria-label={`${r.name} in ${y.year}: ${Math.round(s * 100)}%`} role="img">
                      <span className="block w-full" style={{ height: `${s > 0 ? Math.max(8, s * 100) : 0}%`, background: colour(r.name) }} />
                    </span>
                  </td>
                );
              })}
              <td className="py-2 text-end text-xs text-secondary tnum" title={many(r.commits, "commit", "commits")}>
                {percent(r.commits, all)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
