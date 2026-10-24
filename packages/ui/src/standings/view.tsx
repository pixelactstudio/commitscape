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
import { ScrollRow } from "../kit/scroll";
import { STAGGER } from "../motion";
import { useCounting } from "../data";
import { Counting } from "../kit/pending";

const SHOWN = 20;

const SHORT: Record<View, string> = { surviving: "Still running", prsMerged: "PRs merged", reviews: "Reviews", linesAdded: "Lines added", commits: "Commits" };

function valueOf(r: StandingRow, view: View): number | null {
  return view === "surviving" ? r.surviving : r[view];
}

function placesByView(standings: Standings): Record<View, Map<string, Place>> {
  const given = standings.places;
  if (!given) return Object.fromEntries(VIEWS.map((v) => [v.id, placesOf(standings.people, v.id)])) as Record<View, Map<string, Place>>;
  const out = Object.fromEntries(VIEWS.map((v) => [v.id, new Map<string, Place>()])) as Record<View, Map<string, Place>>;
  for (const [key, list] of Object.entries(given)) for (const p of list) out[p.view].set(key, p);
  return out;
}

/** The views this repository has numbers for. */
export function viewsOf(standings: Standings) {
  return VIEWS.filter((v) => standings.people.some((r) => (v.id === "surviving" ? r.survivingStatus !== null : r[v.id] !== null)));
}

function Pending({ status }: { status: StandingRow["survivingStatus"] }) {
  if (status === "counting" || status === "stale")
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
    <div className="grid grid-cols-2 gap-gutter md:grid-cols-6 lg:grid-cols-[repeat(var(--views),minmax(0,1fr))]" style={{ "--views": viewsOf(standings).length } as CSSProperties}>
      {viewsOf(standings).map((v, i, all) => {
        const rest = all.length % 3;
        const span = `${all.length % 2 === 1 && i === all.length - 1 ? "max-md:col-span-2" : ""} ${rest === 1 && i === all.length - 1 ? "md:col-span-6" : rest === 2 && i >= all.length - 2 ? "md:col-span-3" : "md:col-span-2"} lg:col-span-1`;
        const p = places[v.id].get(row.key);
        const value = valueOf(row, v.id);
        const share = p ? 1 - (p.place - 1) / Math.max(1, p.of) : 0;
        const best = p?.place === 1;
        return (
          <div key={v.id} className={`rise flex flex-col gap-2 rounded-lg border p-4 ${span} ${best ? "border-brand-line bg-brand-soft" : "border-line bg-surface"}`} style={{ animationDelay: `${i * STAGGER.tight}s` }} title={v.why}>
            <span className="type-caption font-medium">{v.label}</span>
            {p ? (
              <span className="flex items-baseline gap-1.5">
                <span className={`type-stat-lg ${best ? "text-brand" : ""}`}>{ordinal(p.place)}</span>
                <span className="type-caption">of {grouped(p.of)}</span>
              </span>
            ) : (
              <span className="type-stat-lg text-tertiary">—</span>
            )}
            <span className="relative mt-1 block h-1.5 rounded-full bg-(--color-track)" aria-hidden>
              {p && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--color-background-surface) bg-brand" style={{ left: `${Math.max(4, Math.min(96, share * 100))}%` }} />}
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
        <span className={`grid size-7 flex-none place-items-center rounded-full ${up ? "bg-(--color-track) text-primary" : "bg-brand-soft text-brand"}`}>{up ? <ArrowUp size={ICON.sm} aria-hidden /> : <ArrowDown size={ICON.sm} aria-hidden />}</span>
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
    <div className="grid gap-gutter surface p-4 sm:grid-cols-2">
      {ahead ? line(ahead, true) : <span className="self-center text-sm font-medium text-brand">Nobody ahead: first in this view.</span>}
      {behind ? line(behind, false) : <span className="self-center type-caption">Nobody behind in this view.</span>}
    </div>
  );
}

const shown = (view: View, value: number) => (view === "linesAdded" || view === "surviving" || value >= 100_000 ? compact(value) : grouped(value));

function Value({ r, value, view, big = false }: { r: StandingRow; value: number | null; view: View; big?: boolean }) {
  const counting = useCounting();
  if (value !== null) return <span className={big ? "type-stat-sm" : "text-sm font-semibold"}>{shown(view, value)}</span>;
  if (counting && (view === "surviving" || view === "linesAdded")) return <Counting width={big ? 64 : 40} height={big ? 20 : 12} />;
  if (view === "surviving") return <Pending status={r.survivingStatus} />;
  return <span className="text-tertiary">—</span>;
}

/** Everyone's place in a repository for the view chosen: the first three on a podium, the rest in a dense list with a bar each, the focused person highlighted and kept in sight; never one score. */
export function Leaderboard({ standings, focus, view, onView, link = true, onAll, loadingAll = false }: { standings: Standings; focus?: string | null; view: View; onView: (v: View) => void; link?: boolean; onAll?: (all: boolean) => void; loadingAll?: boolean }) {
  const [all, setAll] = useState(false);
  const everyone = standings.total ?? standings.people.length;
  const partial = everyone > standings.people.length;
  const counting = useCounting();
  const places = useMemo(() => placesByView(standings), [standings]);
  const known = viewsOf(standings);
  const views = counting ? VIEWS.filter((v) => v.id === "surviving" || v.id === "linesAdded" || known.some((k) => k.id === v.id)) : known;
  const by = views.some((v) => v.id === view) ? view : (views[0]?.id ?? "commits");
  const sorted = useMemo(() => [...standings.people].sort((a, b) => (places[by].get(a.key)?.place ?? Infinity) - (places[by].get(b.key)?.place ?? Infinity) || (b.commits ?? 0) - (a.commits ?? 0)), [standings, places, by]);
  const focused = focus?.toLowerCase();
    const isYou = (r: StandingRow) => (!!focused && r.login?.toLowerCase() === focused) || r.you;
  const podium = sorted.filter((r) => (places[by].get(r.key)?.place ?? Infinity) <= 3).slice(0, 3);
  const raised = podium.length === 3 ? podium : [];
  const rest = sorted.slice(raised.length);
  const rows = all && !partial ? rest : rest.slice(0, SHOWN - raised.length);
  const most = Math.max(1, ...rest.map((r) => valueOf(r, by) ?? 0));
  const you = sorted.findIndex(isYou);
  const pinned = (!all || partial) && you >= SHOWN ? sorted[you] : null;
  const { owner, name } = standings.repo;
  const meta = VIEWS.find((v) => v.id === by);
  const twins = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of standings.people) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([n]) => n));
  }, [standings]);
  const entry = (r: StandingRow) => <Entry key={r.key} r={r} place={places[by].get(r.key)} value={valueOf(r, by)} top={most} view={by} you={isYou(r)} owner={owner} name={name} link={link} alias={twins.has(r.name)} />;
  return (
    <Panel
      padding={0}
      title="Leaderboard"
      description={`${many(everyone, "person", "people")} in ${owner}/${name}, ranked by ${meta?.label.toLowerCase() ?? "commits"}. ${meta?.why ?? ""}${standings.hidden > 0 ? ` ${many(standings.hidden, "person has", "people have")} chosen to stay out.` : ""}`}
    >
      <div className="px-5">
        <ScrollRow>
          <div className="w-max">
            <SegmentedControl label="Rank by" size="md" value={by} onChange={(v) => onView(v as View)}>
              {views.map((v) => (
                <SegmentedControlItem key={v.id} value={v.id} label={SHORT[v.id]} />
              ))}
            </SegmentedControl>
          </div>
        </ScrollRow>
      </div>
      {raised.length === 3 && (
        <ol className="m-0 grid list-none grid-cols-3 items-end gap-2 px-4 pb-5 sm:gap-3 sm:px-5" aria-label={`The first three by ${meta?.label.toLowerCase()}`}>
          {raised.map((r, i) => (
            <Podium key={r.key} r={r} place={places[by].get(r.key)?.place ?? i + 1} value={valueOf(r, by)} view={by} unit={meta?.unit ?? ["", ""]} you={isYou(r)} owner={owner} name={name} link={link} order={i} />
          ))}
        </ol>
      )}
      <ol className="m-0 list-none p-0">
        {rows.map(entry)}
        {pinned && (
          <>
            <li className="border-t border-dashed border-line px-5 py-1 text-center type-micro" aria-hidden>
              ⋯
            </li>
            {entry(pinned)}
          </>
        )}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        {everyone > SHOWN ? (
          <Button
            label={all && !partial ? "Show fewer" : `Show all ${grouped(everyone)}`}
            variant="ghost"
            size="sm"
            isLoading={loadingAll}
            onClick={() => {
              setAll(!all);
              onAll?.(!all);
            }}
          />
        ) : (
          <span />
        )}
        <span className="type-micro">{standings.repo.pullsReadAt ? `Read ${date(standings.repo.builtAt)}; pull requests and reviews from GitHub.` : "GitHub’s pull requests for this repository are still being read."}</span>
      </div>
    </Panel>
  );
}

const PODIUM_ORDER = ["sm:order-2", "sm:order-1", "sm:order-3"];

function Podium({ r, place, value, view, unit, you, owner, name, link, order }: { r: StandingRow; place: number; value: number | null; view: View; unit: [string, string]; you: boolean; owner: string; name: string; link: boolean; order: number }) {
  const medal = MEDAL[Math.min(2, place - 1)];
  const first = place === 1;
  const body = (
    <>
      <span className="relative">
        <Face login={r.login} name={r.name} size={first ? 64 : 48} ring={medal} tint={medal} />
        <span className="absolute -end-1 -bottom-1 grid size-6 place-items-center rounded-full border-2 border-(--color-background-surface) text-2xs font-bold text-on-medal" style={{ background: medal }}>
          {place}
        </span>
      </span>
      <span className="flex w-full min-w-0 flex-col items-center gap-0.5">
        <span className="w-full text-center text-xs font-semibold text-balance [overflow-wrap:break-word] sm:text-sm">{r.name}</span>
        {r.you && <span className="rounded-full bg-brand px-1.5 py-px text-2xs font-semibold text-on-brand">you</span>}
      </span>
      <span className="flex flex-col items-center gap-0.5 tnum">
        <Value r={r} value={value} view={view} big />
        <span className="text-center type-micro">{value === 1 ? unit[0] : unit[1]}</span>
      </span>
    </>
  );
  const cls = `flex flex-col items-center gap-3 rounded-lg border px-2 text-primary no-underline transition-colors ${first ? "pt-5 pb-5 sm:pt-6" : "pt-4 pb-4"} ${you ? "border-brand-line bg-brand-soft" : first ? "border-line-strong bg-raised" : "border-line bg-sunken"}`;
  return (
    <li className={`min-w-0 ${PODIUM_ORDER[order] ?? ""}`} aria-current={you || undefined}>
      {link && r.login ? (
        <A href={`/u/${r.login}/${owner}/${name}`} className={`${cls} hover:border-line-strong hover:bg-hover`}>
          {body}
        </A>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Entry({ r, place, value, top, view, you, owner, name, link, alias }: { r: StandingRow; place: Place | undefined; value: number | null; top: number; view: View; you: boolean; owner: string; name: string; link: boolean; alias: boolean }) {
  const medal = place && place.place <= 3 ? MEDAL[place.place - 1] : null;
  const body = (
    <>
      <span className="w-7 flex-none text-end text-xs font-medium text-secondary tnum">{medal ? <span className="inline-grid size-5 place-items-center rounded-full text-2xs font-bold text-on-medal" style={{ background: medal }}>{place?.place}</span> : (place?.place ?? "—")}</span>
      <Face login={r.login} name={r.name} size={24} tint="var(--color-text-secondary)" />
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
        <span className="min-w-0 leading-tight [overflow-wrap:anywhere]">{r.name}</span>
        {alias && r.login && <span className="min-w-0 type-micro font-normal [overflow-wrap:anywhere]">@{r.login}</span>}
        {r.you && <span className="rounded-full bg-brand px-1.5 py-px text-2xs font-semibold text-on-brand">you</span>}
      </span>
      <span className="hidden w-36 flex-none sm:block md:w-56" aria-hidden>
        <span className="block h-2 w-full overflow-hidden rounded-full bg-(--color-track)">
          <span className={`block h-full rounded-full ${you ? "bg-brand" : "bg-tertiary"}`} style={{ width: `${value ? Math.min(100, Math.max(2, (value * 100) / top)) : 0}%` }} />
        </span>
      </span>
      <span className="w-16 flex-none text-end tnum sm:w-20">
        <Value r={r} value={value} view={view} />
      </span>
    </>
  );
  return (
    <li className={`border-t border-line ${you ? "bg-brand-soft" : ""}`} aria-current={you || undefined}>
      {link && r.login ? (
        <A href={`/u/${r.login}/${owner}/${name}`} className="flex h-11 items-center gap-3 px-5 text-primary no-underline transition-colors hover:bg-hover">
          {body}
        </A>
      ) : (
        <div className="flex h-11 items-center gap-3 px-5">{body}</div>
      )}
    </li>
  );
}
