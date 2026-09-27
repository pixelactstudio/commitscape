import type { CommitList } from "@commitscape/data";

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

export function prepare(list: Pick<CommitList, "subjects" | "people" | "person" | "times" | "kind">): Prepared {
  const who = list.people.map((p) =>
    [p.person.name, p.person.login ?? "", ...p.emails].join(" ").toLowerCase(),
  );
  return {
    subjects: list.subjects.map((s) => s.toLowerCase()),
    who,
    person: list.person,
    times: list.times,
    kind: list.kind,
  };
}

export function search(p: Prepared, q: Query): Int32Array {
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
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
