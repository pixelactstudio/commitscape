import { placesOf, VIEWS, type Place, type Standings } from "@commitscape/data";
import { grouped } from "../format";

/** Every view's place for one person, in the order the views lead. */
export function placesFor(standings: Standings, key: string): Place[] {
  return VIEWS.flatMap((v) => {
    const p = placesOf(standings.people, v.id).get(key);
    return p ? [p] : [];
  });
}

/** The best of a person's places, as "Top 3% of facebook/react's contributors by …", when it is in the top tenth of twenty or more. */
export function topLine(standings: Standings, places: Place[]): string | null {
  const best = [...places].sort((a, b) => a.place / a.of - b.place / b.of)[0];
  if (!best || best.of < 20) return null;
  const share = Math.max(1, Math.ceil((best.place * 100) / best.of));
  if (share > 10) return null;
  const view = VIEWS.find((v) => v.id === best.view);
  return `Top ${share}% of ${standings.repo.owner}/${standings.repo.name}'s ${grouped(best.of)} contributors by ${view?.label.toLowerCase()}`;
}
