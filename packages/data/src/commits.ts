import { base64url, unbase64url } from "./share";
import type { CommitList, PersonRef } from "./types";

export const UNKNOWN_PERSON = 0xffffffff;
export const COMMIT_PAGE = 50;
export const COMMIT_PAGE_MAX = 200;

export type CommitQuery = {
  q?: string;
  person?: number;
  kind?: number;
  from?: number;
  to?: number;
  limit?: number;
};

export type CommitRow = {
  sha: string;
  at: number;
  offset: number;
  personId: number;
  subject: string;
  kind: number;
  merge: boolean;
  files: number;
  added: number | null;
  removed: number | null;
};

export type CommitPage = {
  link: string | null;
  lines: boolean;
  kinds: string[];
  all: number;
  people: Record<string, PersonRef>;
  rows: CommitRow[];
  next: string | null;
  total: number | null;
};

export type Query = {
  text: string;
  person?: number;
  from?: number;
  to?: number;
  kind?: number;
};

export type Prepared = {
  subjects: string[];
  who: string[];
  person: number[];
  times: number[];
  kind: number[];
};

export type Finder = { run(q: Query): Promise<Int32Array> };

export const wordsOf = (text: string | undefined): string[] => (text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

export const pageLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit) ? COMMIT_PAGE : Math.min(COMMIT_PAGE_MAX, Math.max(1, Math.floor(limit)));

export const cursorOf = (seq: number): string => base64url(new TextEncoder().encode(String(seq)));

/** The position a cursor stands for, or null when there is none or it is not one. */
export function seqOf(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const bytes = unbase64url(cursor);
  const text = bytes ? new TextDecoder().decode(bytes) : "";
  return /^\d{1,10}$/.test(text) ? Number(text) : null;
}

export function prepare(list: Pick<CommitList, "subjects" | "people" | "person" | "times" | "kind">): Prepared {
  const who = list.people.map((p) => [p.person.name, p.person.login ?? "", ...p.emails].join(" ").toLowerCase());
  return {
    subjects: list.subjects.map((s) => s.toLowerCase()),
    who,
    person: list.person,
    times: list.times,
    kind: list.kind,
  };
}

/** The positions of the commits that match: every word in the subject or in who made it, and every filter. */
export function search(p: Prepared, q: Query): Int32Array {
  const words = wordsOf(q.text);
  const out = new Int32Array(p.subjects.length);
  let n = 0;
  for (let i = 0; i < p.subjects.length; i++) {
    if (q.person !== undefined && p.person[i] !== q.person) continue;
    if (q.kind !== undefined && p.kind[i] !== q.kind) continue;
    const t = p.times[i] ?? 0;
    if (q.from !== undefined && t < q.from) continue;
    if (q.to !== undefined && t > q.to) continue;
    if (words.length > 0) {
      const subject = p.subjects[i] ?? "";
      const who = p.who[p.person[i] ?? -1] ?? "";
      let all = true;
      for (const w of words) {
        if (!subject.includes(w) && !who.includes(w)) {
          all = false;
          break;
        }
      }
      if (!all) continue;
    }
    out[n++] = i;
  }
  return out.slice(0, n);
}

function after(found: Int32Array, seq: number): number {
  let lo = 0;
  let hi = found.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((found[mid] ?? 0) <= seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Pages through a Commit List held in memory, the way the Site pages through its rows. */
export function listPager(list: CommitList, finder?: Finder): (query: CommitQuery, cursor?: string) => Promise<CommitPage> {
  let own = finder ?? null;
  const found = new Map<string, Promise<Int32Array>>();
  return async (query, cursor) => {
    const person = query.person === undefined ? undefined : list.people.findIndex((p) => p.person.id === query.person);
    const q: Query = { text: wordsOf(query.q).join(" "), person: person === -1 ? -2 : person, kind: query.kind, from: query.from, to: query.to };
    const k = JSON.stringify(q);
    let rows = found.get(k);
    if (!rows) {
      if (!own) {
        const prepared = prepare(list);
        own = { run: async (x) => search(prepared, x) };
      }
      rows = own.run(q);
      if (found.size >= 8) found.delete(found.keys().next().value ?? "");
      found.set(k, rows);
    }
    const matched = await rows;
    const seq = seqOf(cursor);
    const start = seq === null ? 0 : after(matched, seq);
    const limit = pageLimit(query.limit);
    const page = Array.from(matched.subarray(start, start + limit));
    const people: Record<string, PersonRef> = {};
    const out = page.map((i): CommitRow => {
      const who = list.people[list.person[i] ?? 0]?.person;
      if (who) people[who.id] = who;
      return {
        sha: list.ids[i] ?? "",
        at: list.times[i] ?? 0,
        offset: list.offsets[i] ?? 0,
        personId: who?.id ?? UNKNOWN_PERSON,
        subject: list.subjects[i] ?? "",
        kind: list.kind[i] ?? 0,
        merge: list.merge[i] ?? false,
        files: list.files[i] ?? 0,
        added: list.added[i] ?? null,
        removed: list.removed[i] ?? null,
      };
    });
    const last = page.at(-1);
    return {
      link: list.link,
      lines: list.lines,
      kinds: list.kinds,
      all: list.ids.length,
      people,
      rows: out,
      next: last !== undefined && start + limit < matched.length ? cursorOf(last) : null,
      total: seq === null ? matched.length : null,
    };
  };
}
