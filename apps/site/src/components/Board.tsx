import { useState, type ReactNode } from "react";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Link } from "@tanstack/react-router";
import { ArrowDown, Crown } from "lucide-react";
import { leadersOf, WINDOW_VIEWS, type RaceState, type WindowStandings, type WindowView } from "@commitscape/data";
import { FaceStack, grouped, Person, Surface } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";

/** A Race's state as a pill: running pulses, upcoming and finished are quiet. */
export function StateBadge({ state }: { state: RaceState }) {
  const label = { running: "Running", upcoming: "Upcoming", finished: "Finished" }[state];
  return (
    <span className="inline-flex h-6 flex-none items-center gap-2 rounded-full border border-line bg-surface ps-2 pe-2.5 type-caption font-medium whitespace-nowrap text-primary">
      <StatusDot variant={state === "running" ? "success" : state === "upcoming" ? "accent" : "neutral"} label={label} isPulsing={state === "running"} />
      {label}
    </span>
  );
}

/** Who leads each view, side by side: never one winner overall. A view nobody has made a mark in yet says so once, not four times. */
export function Leaders({ standings }: { standings: WindowStandings }) {
  const leaders = leadersOf(standings.rows);
  const any = WINDOW_VIEWS.some((v) => leaders[v.id].length > 0);
  if (!any)
    return (
      <p className="m-0 surface px-panel py-4 type-description" role="status">
        Nobody has made a mark yet. The first pull request merged, review given, commit or contribution makes its leader.
      </p>
    );
  return (
    <ul aria-label="Who leads each view" className="m-0 grid list-none grid-cols-2 gap-gutter p-0 lg:grid-cols-4">
      {WINDOW_VIEWS.map((v) => {
        const who = standings.rows.filter((r) => leaders[v.id].includes(r.login));
        const top = who[0];
        return (
          <li key={v.id}>
            <Surface className={`flex h-full min-w-0 flex-col gap-3 p-4 ${top ? "border-brand-line!" : ""}`}>
              <span className="flex items-center gap-1.5 type-caption font-medium">
                {top && <Crown size={ICON.xs} className="text-brand" aria-hidden />}
                {v.label}
              </span>
              {top ? (
                <>
                  <span className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-2.5">
                    <FaceStack people={who.slice(0, 3)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="type-ui font-semibold [overflow-wrap:break-word]">{who.length === 1 ? (top.name ?? top.login) : `${who.length} tied`}</span>
                      <span className="type-caption [overflow-wrap:break-word]">{who.length === 1 ? `@${top.login}` : who.map((r) => `@${r.login}`).join(", ")}</span>
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="type-stat">{grouped(top[v.id])}</span>
                    <span className="type-caption">{top[v.id] === 1 ? v.unit[0] : v.unit[1]}</span>
                  </span>
                </>
              ) : (
                <span className="flex flex-1 flex-col justify-end gap-0.5">
                  <span className="type-ui font-medium">No one yet</span>
                  <span className="type-caption">The first to make one leads.</span>
                </span>
              )}
            </Surface>
          </li>
        );
      })}
    </ul>
  );
}

/** People in a window, a column a view, the leaders of each marked; never one winner. Sorted by the view chosen; a table when there is room, a list of people with their four counts when there is not. */
export function StandingsTable({ standings, label = "Standings" }: { standings: WindowStandings; label?: string }) {
  const [by, setBy] = useState<WindowView>("prsMerged");
  const leaders = leadersOf(standings.rows);
  const most = Object.fromEntries(WINDOW_VIEWS.map((v) => [v.id, Math.max(1, ...standings.rows.map((r) => r[v.id]))])) as Record<WindowView, number>;
  const rows = [...standings.rows].sort((a, b) => b[by] - a[by] || b.contributions - a.contributions || a.login.localeCompare(b.login));
  const sortedBy = WINDOW_VIEWS.find((v) => v.id === by)?.label ?? "";
  return (
    <div className="@container">
      <div className="hidden overflow-x-auto @[34rem]:block">
        <table aria-label={label} className="w-full min-w-136 border-collapse type-ui">
          <thead>
            <tr className="type-caption">
              <th scope="col" className="sticky start-0 z-(--z-raised) bg-surface py-2 ps-5 pe-3 text-start font-medium">
                Person
              </th>
              {WINDOW_VIEWS.map((v) => (
                <th key={v.id} scope="col" aria-sort={by === v.id ? "descending" : "none"} className="px-3 py-2 text-end font-medium last:pe-5">
                  <button type="button" onClick={() => setBy(v.id)} className={`plain-button inline-flex items-center gap-1 rounded-sm whitespace-nowrap ${by === v.id ? "font-semibold text-primary" : "text-secondary hover:text-primary"}`}>
                    {by === v.id && <ArrowDown size={ICON.xs} aria-hidden />}
                    {v.label}
                    {by === v.id && <span className="sr-only">, sorted most first</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.login} className="border-t border-line">
                <th scope="row" className="sticky start-0 z-(--z-raised) bg-surface py-2.5 ps-5 pe-3 text-start font-normal">
                  <Link to="/u/$login" params={{ login: r.login }} className="flex min-w-0 text-primary no-underline hover:underline">
                    <Person login={r.login} name={r.name} />
                  </Link>
                </th>
                {WINDOW_VIEWS.map((v) => {
                  const lead = leaders[v.id].includes(r.login);
                  return (
                    <td key={v.id} data-leads={lead ? "true" : undefined} className="px-3 py-2.5 text-end last:pe-5">
                      <span className="inline-flex flex-col items-end gap-1">
                        <span className={`inline-flex items-center gap-1 tnum ${lead ? "font-semibold text-brand" : ""}`}>
                          {lead && <Crown size={ICON.xs} aria-label={`leads ${v.label.toLowerCase()}`} />}
                          {grouped(r[v.id])}
                        </span>
                        <span className="block h-1 w-16 overflow-hidden rounded-full bg-track" aria-hidden>
                          <span className={`block h-full rounded-full ${lead ? "bg-brand" : "bg-secondary opacity-50"}`} style={{ width: `${(r[v.id] / most[v.id]) * 100}%` }} />
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
      <div className="@[34rem]:hidden">
        <p className="m-0 px-5 pb-2 type-caption">Sorted by {sortedBy.toLowerCase()}, most first. Choose a count to sort by it.</p>
        <ol aria-label={label} className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {rows.map((r) => (
            <li key={r.login} className="flex flex-col gap-3 px-5 py-3">
              <Link to="/u/$login" params={{ login: r.login }} className="flex min-w-0 text-primary no-underline hover:underline">
                <Person login={r.login} name={r.name} />
              </Link>
              <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-3">
                {WINDOW_VIEWS.map((v) => {
                  const lead = leaders[v.id].includes(r.login);
                  return (
                    <div key={v.id} data-leads={lead ? "true" : undefined} className="flex min-w-0 flex-col justify-end gap-1">
                      <dt className="m-0 type-caption">
                        <button type="button" onClick={() => setBy(v.id)} aria-pressed={by === v.id} className={`plain-button inline-flex items-center gap-1 rounded-sm text-start ${by === v.id ? "font-semibold text-primary" : "text-secondary"}`}>
                          {by === v.id && <ArrowDown size={ICON.xs} aria-hidden />}
                          {v.label}
                        </button>
                      </dt>
                      <dd className={`m-0 inline-flex items-center gap-1 tnum ${lead ? "font-semibold text-brand" : ""}`}>
                        {lead && <Crown size={ICON.xs} aria-label={`leads ${v.label.toLowerCase()}`} />}
                        {grouped(r[v.id])}
                      </dd>
                      <span className="block h-1 overflow-hidden rounded-full bg-track" aria-hidden>
                        <span className={`block h-full rounded-full ${lead ? "bg-brand" : "bg-secondary opacity-50"}`} style={{ width: `${(r[v.id] / most[v.id]) * 100}%` }} />
                      </span>
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Where a Race or a Season stands today: its name for the moment, how far through it is, and which day of how many. */
export function Clock({ label, headline, day, total, finished = false, note }: { label: string; headline: ReactNode; day: number; total: number; finished?: boolean; note: ReactNode }) {
  return (
    <Surface className="flex flex-col gap-3 px-panel py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex flex-none flex-col gap-1">
        <span className="type-caption font-medium">{label}</span>
        <span className="type-stat">{headline}</span>
      </div>
      <div className="min-w-0 flex-1">
        <ProgressBar label={`How far through the ${label.replace(/^This /, "")}`} isLabelHidden value={day} max={total} variant={finished ? "neutral" : "success"} />
      </div>
      <span className="flex-none type-caption tnum">{note}</span>
    </Surface>
  );
}
