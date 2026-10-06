import { gunzipSync } from "node:zlib";
import { graphql, type GitHubApi } from "./github";

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
type CommitList = { people: { person: Ref }[]; ids: string[]; person: number[] };
type Written = { data: Record<string, unknown> };

export const PEOPLE_RESOLVED = 500;
const BATCH = 50;
const OID = /^[0-9a-f]{40}$/;

/** The people of a Report over all of history, and each one's newest commit. */
export function peopleOf(gzipped: Uint8Array): { people: RepoPerson[]; newest: Map<number, string> } {
  const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as Written;
  const rows = ((report.data["/api/people?window=all"] as { people?: Row[] } | undefined)?.people ?? []).map((r) => ({
    personId: r.person.id,
    name: r.person.name,
    login: r.person.login,
    commits: r.commits,
    linesAdded: r.lines_added,
    linesRemoved: r.lines_removed,
    first: r.first,
    last: r.last,
  }));
  const list = report.data["/api/commits?"] as CommitList | undefined;
  const newest = new Map<number, string>();
  if (list?.ids && list.person && list.people) {
    for (let i = 0; i < list.ids.length; i++) {
      const who = list.people[list.person[i] ?? -1]?.person.id;
      const id = list.ids[i];
      if (who !== undefined && id && !newest.has(who)) newest.set(who, id);
    }
  }
  return { people: rows, newest };
}

/** GitHub logins for the people with most commits who have none yet, from the account GitHub links to one of their commits. */
export async function resolveLogins(gh: GitHubApi, owner: string, name: string, people: RepoPerson[], newest: Map<number, string>): Promise<{ found: Map<number, string>; requests: number }> {
  const wanted = people
    .filter((p) => !p.login)
    .sort((a, b) => b.commits - a.commits)
    .slice(0, PEOPLE_RESOLVED)
    .flatMap((p) => {
      const oid = newest.get(p.personId);
      return oid && OID.test(oid) ? [{ id: p.personId, oid }] : [];
    });
  const found = new Map<number, string>();
  let requests = 0;
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    const fields = batch.map((w, k) => `c${k}: object(oid: "${w.oid}") { ... on Commit { author { user { login } } } }`).join("\n");
    requests++;
    const data = await graphql<{ repository: Record<string, { author?: { user?: { login?: string } | null } | null } | null> | null }>(
      gh,
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      { owner, name },
    );
    batch.forEach((w, k) => {
      const login = data.repository?.[`c${k}`]?.author?.user?.login;
      if (login) found.set(w.id, login);
    });
  }
  return { found, requests };
}
