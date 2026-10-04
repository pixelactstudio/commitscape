import { useState } from "react";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Link } from "@tanstack/react-router";
import { ArrowDown, Crown } from "lucide-react";
import { leadersOf, WINDOW_VIEWS, type RaceState, type WindowStandings, type WindowView } from "@commitscape/data";
import { Face, grouped } from "@commitscape/ui";

/** A Race's state as a badge: running pulses, upcoming and finished are quiet. */
export function StateBadge({ state }: { state: RaceState }) {
  const label = { running: "Running", upcoming: "Upcoming", finished: "Finished" }[state];
  return (
    <span className="inline-flex flex-none items-center gap-2 rounded-full border border-line bg-surface py-0.5 ps-2 pe-2.5 text-xs font-medium whitespace-nowrap">
      <StatusDot variant={state === "running" ? "success" : state === "upcoming" ? "accent" : "neutral"} label={label} isPulsing={state === "running"} />
      {label}
    </span>
  );
}

/** Who leads each view, side by side: never one winner overall. */
export function Leaders({ standings }: { standings: WindowStandings }) {
  const leaders = leadersOf(standings.rows);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {WINDOW_VIEWS.map((v) => {
        const who = standings.rows.filter((r) => leaders[v.id].includes(r.login));
        const top = who[0];
        return (
          <div key={v.id} className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-container)] border p-4 ${top ? "border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-brand-soft" : "border-line bg-surface"}`}>
            <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
              {top && <Crown size={13} className="text-brand" aria-hidden />}
              {v.label}
            </span>
            {top ? (
              <>
                <span className="flex items-center gap-2.5">
                  <span className="flex -space-x-2">
                    {who.slice(0, 3).map((r) => (
                      <span key={r.login} className="rounded-full ring-2 ring-[var(--color-background-surface)]">
                        <Face login={r.login} name={r.name ?? r.login} size={32} />
                      </span>
                    ))}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">{who.length === 1 ? (top.name ?? top.login) : `${who.length} tied`}</span>
                    <span className="truncate text-xs text-secondary">{who.length === 1 ? `@${top.login}` : who.map((r) => `@${r.login}`).join(", ")}</span>
                  </span>
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-[1.6rem] leading-none font-semibold tracking-[-0.03em] tnum">{grouped(top[v.id])}</span>
                  <span className="text-xs text-secondary">{top[v.id] === 1 ? v.unit[0] : v.unit[1]}</span>
                </span>
              </>
            ) : (
              <span className="flex flex-1 flex-col justify-end gap-1">
                <span className="text-sm font-medium">No one yet</span>
                <span className="text-xs text-secondary">The first to make one leads.</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** People in a window, a column a view, the leaders of each marked; never one winner. Sorted by the view chosen. */
export function WindowTable({ standings, label = "Standings" }: { standings: WindowStandings; label?: string }) {
  const [by, setBy] = useState<WindowView>("prsMerged");
  const leaders = leadersOf(standings.rows);
  const most = Object.fromEntries(WINDOW_VIEWS.map((v) => [v.id, Math.max(1, ...standings.rows.map((r) => r[v.id]))])) as Record<WindowView, number>;
  const rows = [...standings.rows].sort((a, b) => b[by] - a[by] || b.contributions - a.contributions || a.login.localeCompare(b.login));
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="text-xs text-secondary">
            <th scope="col" className="sticky start-0 bg-surface py-2 ps-5 pe-3 text-start font-medium">
              Person
            </th>
            {WINDOW_VIEWS.map((v) => (
              <th key={v.id} scope="col" aria-sort={by === v.id ? "descending" : "none"} className="px-3 py-2 text-end font-medium last:pe-5">
                <button type="button" onClick={() => setBy(v.id)} className={`inline-flex cursor-pointer items-center gap-1 border-0 whitespace-nowrap bg-transparent p-0 text-xs font-medium ${by === v.id ? "text-primary" : "text-secondary hover:text-primary"}`}>
                  {by === v.id && <ArrowDown size={12} aria-hidden />}
                  {v.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.login} className="border-t border-line">
              <th scope="row" className="sticky start-0 bg-surface py-2.5 ps-5 pe-3 text-start font-normal">
                <Link to="/u/$login" params={{ login: r.login }} className="flex min-w-0 items-center gap-2.5 text-primary no-underline hover:underline">
                  <Face login={r.login} name={r.name ?? r.login} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{r.name ?? r.login}</span>
                    {r.name && <span className="truncate text-xs text-secondary">@{r.login}</span>}
                  </span>
                </Link>
              </th>
              {WINDOW_VIEWS.map((v) => {
                const lead = leaders[v.id].includes(r.login);
                return (
                  <td key={v.id} data-leads={lead ? "true" : undefined} className="px-3 py-2.5 text-end last:pe-5">
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className={`inline-flex items-center gap-1 tnum ${lead ? "font-semibold text-brand" : ""}`}>
                        {lead && <Crown size={12} aria-label={`leads ${v.label.toLowerCase()}`} />}
                        {r[v.id].toLocaleString("en-US")}
                      </span>
                      <span className="block h-1 w-16 overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
                        <span className={`block h-full rounded-full ${lead ? "bg-brand" : "bg-[var(--color-text-secondary)] opacity-50"}`} style={{ width: `${(r[v.id] / most[v.id]) * 100}%` }} />
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
