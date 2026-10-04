import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ordinal, placesOf, VIEWS, type Place, type StandingRow, type Standings, type View } from "@commitscape/data";
import { Figure } from "../charts/common";
import { placesFor, topLine } from "./places";
import { Face } from "../components/Face";
import { Tile } from "../components/Tile";
import { compact, date, grouped, many } from "../format";

const SHOWN = 25;

const STATUS: Record<NonNullable<StandingRow["survivingStatus"]>, string> = {
  counting: "counting…",
  counted: "",
  over_budget: "not counted",
  not_counted: "not counted",
  failed: "not counted",
  stale: "counting…",
  not_asked: "—",
};

function valueOf(r: StandingRow, view: View): string {
  if (view === "surviving") return r.surviving !== null ? grouped(r.surviving) : r.survivingStatus ? STATUS[r.survivingStatus] : "—";
  const v = r[view];
  return v === null ? "—" : grouped(v);
}



/** One person's numbers in a repository, and where they stand in each view. */
export function YourStanding({ standings, row }: { standings: Standings; row: StandingRow }) {
  const places = placesFor(standings, row.key);
  const top = topLine(standings, places);
  const place = (view: View) => {
    const p = places.find((x) => x.view === view);
    return p ? `${ordinal(p.place)} of ${grouped(p.of)}` : "no place in this view";
  };
  return (
    <section className="flex flex-col gap-3">
      {top && <p className="standing-top">{top}</p>}
      <div className="tiles profile-tiles">
        <Tile value={row.surviving !== null ? compact(row.surviving) : row.survivingStatus ? STATUS[row.survivingStatus] || "—" : "—"} label="lines that still run" note={place("surviving")} />
        <Tile value={row.prsMerged === null ? "—" : grouped(row.prsMerged)} label="pull requests merged" note={place("prsMerged")} />
        <Tile value={row.reviews === null ? "—" : grouped(row.reviews)} label="pull requests reviewed" note={place("reviews")} />
        <Tile value={row.commits === null ? "—" : grouped(row.commits)} label="commits" note={place("commits")} />
        <Tile value={row.linesAdded === null ? "—" : `+${compact(row.linesAdded)}`} label="lines added" note={`${row.linesRemoved === null ? "" : `−${compact(row.linesRemoved)} removed · `}${place("linesAdded")}`} />
        <Tile value={row.first ? date(row.first) : "—"} label="first commit" note={row.last ? `last ${date(row.last)}` : "no commits read"} />
      </div>
    </section>
  );
}

/** Everyone's Standings in a repository, a column a view, sorted by the view chosen; never one score. */
export function StandingsTable({ standings, focus }: { standings: Standings; focus?: string | null }) {
  const [by, setBy] = useState<View>("surviving");
  const [all, setAll] = useState(false);
  const places = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, placesOf(standings.people, v.id)])) as Record<View, Map<string, Place>>, [standings]);
  const shownViews = VIEWS.filter((v) => standings.people.some((r) => (v.id === "surviving" ? r.survivingStatus !== null : r[v.id] !== null)));
  const sorted = [...standings.people].sort((a, b) => (places[by].get(a.key)?.place ?? Infinity) - (places[by].get(b.key)?.place ?? Infinity) || (b.commits ?? 0) - (a.commits ?? 0));
  const focused = focus?.toLowerCase();
  const rows = all ? sorted : sorted.slice(0, SHOWN);
  const you = focused ? sorted.findIndex((r) => r.login?.toLowerCase() === focused) : -1;
  if (!all && you >= SHOWN && sorted[you]) rows.push(sorted[you]);
  const { owner, name } = standings.repo;
  return (
    <Figure title="Standings" note={`${many(standings.people.length, "person", "people")} in ${owner}/${name}, a column a view. Choose a heading to rank by it.${standings.hidden > 0 ? ` ${many(standings.hidden, "person has", "people have")} chosen to stay out.` : ""}`}>
      <div className="standings-wrap">
        <table className="standings">
          <thead>
            <tr>
              <th className="place">#</th>
              <th>Person</th>
              {shownViews.map((v) => (
                <th key={v.id} className="num" aria-sort={by === v.id ? "descending" : undefined}>
                  <button type="button" className={by === v.id ? "sorter on" : "sorter"} title={v.why} onClick={() => setBy(v.id)}>
                    {v.label}
                  </button>
                </th>
              ))}
              <th className="hide-narrow">Works on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = places[by].get(r.key);
              return (
                <tr key={r.key} className={r.login?.toLowerCase() === focused || r.you ? "standing-you" : undefined}>
                  <td className="place">{p ? p.place : "—"}</td>
                  <td>
                    <span className="name">
                      <Face login={r.login} name={r.name} size={24} />
                      {r.login ? <a href={`/u/${r.login}/${owner}/${name}`}>{r.name}</a> : <span>{r.name}</span>}
                    </span>
                  </td>
                  {shownViews.map((v) => (
                    <td key={v.id} className={by === v.id ? "num on" : "num"}>
                      {valueOf(r, v.id)}
                    </td>
                  ))}
                  <td className="hide-narrow note small works-on">{r.worksOn ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > SHOWN && <Button label={all ? "Fewer" : `All ${many(sorted.length, "person", "people")}`} variant="ghost" size="sm" onClick={() => setAll(!all)} />}
      <p className="note small">
        Lines that still run are counted for the {grouped(Math.min(30, standings.people.length))} people with most commits, and anyone whose page is opened. {standings.repo.pullsReadAt ? "Pull requests and reviews from GitHub." : "GitHub's pull requests for this repository are still being read."}
      </p>
    </Figure>
  );
}
