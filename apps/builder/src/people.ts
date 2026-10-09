import { gunzipSync } from "node:zlib";

export type RepoPerson = {
  personId: number;
  name: string;
  login: string | null;
  commits: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  first: number;
  last: number;
};

type Ref = { id: number; name: string; login: string | null };
type Row = { person: Ref; commits: number; lines_added: number | null; lines_removed: number | null; first: number; last: number };
type Written = { data: Record<string, unknown> };

/** The people of a Report over all of history, each with the GitHub login the Report gives them. */
export function peopleOf(gzipped: Uint8Array): RepoPerson[] {
  const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as Written;
  return ((report.data["/api/people?window=all"] as { people?: Row[] } | undefined)?.people ?? []).map((r) => ({
    personId: r.person.id,
    name: r.person.name,
    login: r.person.login,
    commits: r.commits,
    linesAdded: r.lines_added,
    linesRemoved: r.lines_removed,
    first: r.first,
    last: r.last,
  }));
}
