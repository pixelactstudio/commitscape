import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ordinal, placesOf, VIEWS, type Place, type StandingRow, type Standings, type View } from "@commitscape/data";
import { Face } from "../components/Face";
import { compact, date, grouped, many } from "../format";
import { A } from "../kit/A";
import { ICON, MEDAL } from "../design/tokens";
import { Panel } from "../kit/layout";
import { STAGGER } from "../motion";

const SHOWN = 20;

const SHORT: Record<View, string> = { surviving: "Still running", prsMerged: "PRs merged", reviews: "Reviews", linesAdded: "Lines added", commits: "Commits" };

function valueOf(r: StandingRow, view: View): number | null {
  return view === "surviving" ? r.surviving : r[view];
}

function placesByView(standings: Standings): Record<View, Map<string, Place>> {
  return Object.fromEntries(VIEWS.map((v) => [v.id, placesOf(standings.people, v.id)])) as Record<View, Map<string, Place>>;
}

/** The views this repository has numbers for. */
export function viewsOf(standings: Standings) {
  return VIEWS.filter((v) => standings.people.some((r) => (v.id === "surviving" ? r.survivingStatus !== null : r[v.id] !== null)));
}

function Pending({ status }: { status: StandingRow["survivingStatus"] }) {
  if (status === "counting" || status === "stale" || status === "not_asked" || status === null)
    return (
      <span className="inline-flex items-center gap-1.5 text-secondary">
        <Spinner size="sm" /> counting
      </span>
    );
  return <span className="text-secondary">not counted</span>;
}

/** One person's place in each view of a repository: where they rank, out of how many, and their number. */
export function PlaceCards({ standings, row }: { standings: Standings; row: StandingRow }) {
  const places = useMemo(() => placesByView(standings), [standings]);
  return (
    <div className="grid grid-cols-2 gap-gutter md:grid-cols-3 lg:grid-cols-[repeat(var(--views),minmax(0,1fr))]" style={{ "--views": viewsOf(standings).length } as CSSProperties}>
      {viewsOf(standings).map((v, i) => {
        const p = places[v.id].get(row.key);
        const value = valueOf(row, v.id);
        const share = p ? 1 - (p.place - 1) / Math.max(1, p.of) : 0;
        const best = p?.place === 1;
        return (
          <div key={v.id} className={`rise flex flex-col gap-2 rounded-lg border p-4 ${best ? "border-brand-line bg-brand-soft" : "border-line bg-surface"}`} style={{ animationDelay: `${i * STAGGER.tight}s` }} title={v.why}>
            <span className="type-caption font-medium">{v.label}</span>
            {p ? (
              <span className="flex items-baseline gap-1.5">
                <span className={`type-stat-lg ${best ? "text-brand" : ""}`}>{ordinal(p.place)}</span>
                <span className="type-caption">of {grouped(p.of)}</span>
              </span>
            ) : (
              <span className="type-stat-lg text-quiet">—</span>
            )}
            <span className="relative mt-1 block h-1.5 rounded-full bg-[var(--color-track)]" aria-hidden>
              {p && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-background-surface)] bg-brand" style={{ left: `${Math.max(4, Math.min(96, share * 100))}%` }} />}
            </span>
            <span className="text-sm tnum">{value !== null ? <strong className="font-semibold">{grouped(value)}</strong> : v.id === "surviving" ? <Pending status={row.survivingStatus} /> : <span className="text-secondary">none</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Who is just ahead of a person in a view and how far, and who is just behind. */
export function NextUp({ standings, row, view }: { standings: Standings; row: StandingRow; view: View }) {
  const places = useMemo(() => placesByView(standings)[view], [standings, view]);
  const mine = valueOf(row, view);
  const unit = VIEWS.find((v) => v.id === view)?.unit ?? ["", ""];
  if (mine === null || !places.get(row.key)) return null;
  const valued = standings.people.filter((r) => (valueOf(r, view) ?? 0) > 0 && r.key !== row.key);
  const ahead = valued.filter((r) => (valueOf(r, view) ?? 0) > mine).sort((a, b) => (valueOf(a, view) ?? 0) - (valueOf(b, view) ?? 0))[0];
  const behind = valued.filter((r) => (valueOf(r, view) ?? 0) < mine).sort((a, b) => (valueOf(b, view) ?? 0) - (valueOf(a, view) ?? 0))[0];
  const line = (r: StandingRow, up: boolean) => {
    const gap = Math.abs((valueOf(r, view) ?? 0) - mine);
    return (
      <div className="flex items-center gap-3">
        <span className={`grid size-7 flex-none place-items-center rounded-full ${up ? "bg-[var(--color-track)] text-primary" : "bg-brand-soft text-brand"}`}>{up ? <ArrowUp size={ICON.sm} aria-hidden /> : <ArrowDown size={ICON.sm} aria-hidden />}</span>
        <Face login={r.login} name={r.name} size={32} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{r.name}</span>
          <span className="type-caption">
            {up ? `${many(gap, ...unit)} ahead` : `${many(gap, ...unit)} behind`}
          </span>
        </span>
      </div>
    );
  };
  if (!ahead && !behind) return null;
  return (
    <div className="grid gap-gutter rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
      {ahead ? line(ahead, true) : <span className="self-center text-sm font-medium text-brand">Nobody ahead: first in this view.</span>}
      {behind ? line(behind, false) : <span className="self-center type-caption">Nobody behind in this view.</span>}
    </div>
  );
}

/** Everyone's place in a repository for the view chosen, the focused person highlighted and kept in sight; never one score. */
export function Leaderboard({ standings, focus, view, onView, link = true }: { standings: Standings; focus?: string | null; view: View; onView: (v: View) => void; link?: boolean }) {
  const [all, setAll] = useState(false);
  const places = useMemo(() => placesByView(standings), [standings]);
  const views = viewsOf(standings);
  const by = views.some((v) => v.id === view) ? view : (views[0]?.id ?? "commits");
  const sorted = useMemo(() => [...standings.people].sort((a, b) => (places[by].get(a.key)?.place ?? Infinity) - (places[by].get(b.key)?.place ?? Infinity) || (b.commits ?? 0) - (a.commits ?? 0)), [standings, places, by]);
  const focused = focus?.toLowerCase();
  const top = Math.max(1, ...sorted.map((r) => valueOf(r, by) ?? 0));
  const rows = all ? sorted : sorted.slice(0, SHOWN);
  const you = focused ? sorted.findIndex((r) => r.login?.toLowerCase() === focused || r.you) : sorted.findIndex((r) => r.you);
  const pinned = !all && you >= SHOWN ? sorted[you] : null;
  const { owner, name } = standings.repo;
  const meta = VIEWS.find((v) => v.id === by);
  const twins = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of standings.people) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([n]) => n));
  }, [standings]);
  return (
    <Panel
      padding={0}
      title="Leaderboard"
      description={`${many(standings.people.length, "person", "people")} in ${owner}/${name}. ${meta?.why ?? ""}${standings.hidden > 0 ? ` ${many(standings.hidden, "person has", "people have")} chosen to stay out.` : ""}`}
      actions={
        <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <SegmentedControl label="Rank by" size="sm" value={by} onChange={(v) => onView(v as View)}>
            {views.map((v) => (
              <SegmentedControlItem key={v.id} value={v.id} label={SHORT[v.id]} />
            ))}
          </SegmentedControl>
        </div>
      }
    >
      <ol className="m-0 list-none p-0">
        {rows.map((r) => (
          <Entry key={r.key} r={r} place={places[by].get(r.key)} value={valueOf(r, by)} top={top} view={by} you={r.login?.toLowerCase() === focused || r.you} owner={owner} name={name} link={link} alias={twins.has(r.name)} />
        ))}
        {pinned && (
          <>
            <li className="border-t border-dashed border-line px-5 py-1 text-center type-micro" aria-hidden>
              ⋯
            </li>
            <Entry r={pinned} place={places[by].get(pinned.key)} value={valueOf(pinned, by)} top={top} view={by} you owner={owner} name={name} link={link} alias={twins.has(pinned.name)} />
          </>
        )}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        {sorted.length > SHOWN ? <Button label={all ? "Show fewer" : `Show all ${grouped(sorted.length)}`} variant="ghost" size="sm" onClick={() => setAll(!all)} /> : <span />}
        <span className="type-micro">{standings.repo.pullsReadAt ? `Read ${date(standings.repo.builtAt)}; pull requests and reviews from GitHub.` : "GitHub's pull requests for this repository are still being read."}</span>
      </div>
    </Panel>
  );
}

function Entry({ r, place, value, top, view, you, owner, name, link, alias }: { r: StandingRow; place: Place | undefined; value: number | null; top: number; view: View; you: boolean; owner: string; name: string; link: boolean; alias: boolean }) {
  const medal = place && place.place <= 3 ? MEDAL[place.place - 1] : null;
  const body = (
    <>
      <span className="w-8 flex-none text-end text-xs text-secondary tnum">{medal ? <span className="inline-grid size-6 place-items-center rounded-full text-2xs font-bold text-on-medal" style={{ background: medal }}>{place?.place}</span> : (place?.place ?? "—")}</span>
      <Face login={r.login} name={r.name} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 truncate text-sm font-medium">
          <span className="truncate">{r.name}</span>
          {alias && r.login && <span className="truncate type-micro font-normal">@{r.login}</span>}
          {r.you && <span className="rounded-full bg-brand px-1.5 py-px text-2xs font-semibold text-on-brand">you</span>}
        </span>
        <span className="block h-1 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
          <span className={`block h-full rounded-full ${you ? "bg-brand" : "bg-tertiary"}`} style={{ width: `${((value ?? 0) * 100) / top}%` }} />
        </span>
      </span>
      <span className="w-20 flex-none text-end text-sm tnum sm:w-28">{value !== null ? <span className="font-medium">{view === "linesAdded" || value >= 100_000 ? compact(value) : grouped(value)}</span> : view === "surviving" ? <Pending status={r.survivingStatus} /> : <span className="text-quiet">—</span>}</span>
    </>
  );
  return (
    <li className={`border-t border-line ${you ? "bg-brand-soft" : ""}`} aria-current={you || undefined}>
      {link && r.login ? (
        <A href={`/u/${r.login}/${owner}/${name}`} className="flex items-center gap-3 px-5 py-2.5 text-primary no-underline transition-colors hover:bg-hover">
          {body}
        </A>
      ) : (
        <div className="flex items-center gap-3 px-5 py-2.5">{body}</div>
      )}
    </li>
  );
}
