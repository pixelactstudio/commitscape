import type { Activity, Fact, File, MapBlock, MapLevel, Overview, People, Person, PersonRef, PersonRow, Stats, TimelineMoment } from "../types";
import { Analysis, type Contributor, type MapNode } from "./analysis";
import { authorOf, DAY, isCode, TRAIT, type IndexView, type ViewWindow } from "./view";

const FIRST_PROFILES = 30;

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part * 100) / whole));

/** The person a Stored Index knows by `id`, as the screens show them. */
export function personRef(v: IndexView, id: number): PersonRef {
  const p = v.persons.get(id);
  return { id, name: p?.name ?? "", colour: p?.colour ?? null, login: p?.login ?? null };
}

const fact = (kind: string, value: number, more: Partial<Fact> = {}): Fact => ({ kind, value, other: null, subject: null, time: null, ...more });

export function overview(a: Analysis, label: string): Overview {
  const v = a.v;
  const pulse = a.pulse(null);
  const facts: Fact[] = [];
  const total = pulse.commits;
  if (total >= 20) {
    let night = 0;
    let weekend = 0;
    pulse.week.forEach((hours, day) => {
      hours.forEach((n, hour) => {
        if (hour < 5 || hour >= 22) night += n;
        if (day >= 5) weekend += n;
      });
    });
    if (night * 4 >= total) facts.push(fact("night", percent(night, total)));
    if (weekend * 10 >= total * 3) facts.push(fact("weekend", percent(weekend, total)));
    if (pulse.busiest_day) {
      const [day, n] = pulse.busiest_day;
      const usual = total / Math.max(1, pulse.active_days);
      if (n >= 10 && n >= 5 * usual) facts.push(fact("busiest_day", n, { other: Math.round(usual * 10) / 10, time: day * DAY }));
    }
    const streak = pulse.longest_streak;
    if (streak && streak.days >= 21) facts.push(fact("streak", streak.days, { time: streak.first_day * DAY }));
    const of = (w: string) => pulse.work.find((x) => x.work === w)?.commits ?? 0;
    const fixes = of("fixes");
    const features = of("features");
    if (fixes >= 10 && fixes >= 2 * features) facts.push(fact("fixes", fixes, { other: features }));
    const hottest = a.churnRanking()[0];
    if (hottest && hottest.commits * 5 >= total) facts.push(fact("hottest_file", hottest.commits, { subject: v.paths[hottest.file] ?? "", other: total }));
  }
  const biggest = a.largest()[0];
  if (biggest && biggest.loc >= 5000) facts.push(fact("biggest_file", biggest.loc, { subject: v.paths[biggest.file] ?? "" }));
  const stalest = a.stalest()[0];
  if (stalest && stalest.days >= 3 * 365) facts.push(fact("untouched", stalest.days, { subject: v.paths[stalest.file] ?? "" }));

  return {
    window: label,
    totals: a.totals(),
    languages: v.snapshot.languages,
    commits: pulse.commits,
    active_days: pulse.active_days,
    first_day: pulse.first_day,
    days: pulse.days,
    people: a.contributors().map((c) => ({ person: personRef(v, c.author), commits: c.commits })),
    timeline: a.timeline(v.snapshot.releases).map((m) => moment(v, m)),
    facts,
    code_age: v.snapshot.code_age,
  };
}

function moment(v: IndexView, m: ReturnType<Analysis["timeline"]>[number]): TimelineMoment {
  const out: TimelineMoment = { kind: m.kind, time: m.time, person: null, name: null, count: null, until: null, from: null, to: null };
  const who = (id: number | null) => (id === null ? null : personRef(v, id));
  switch (m.kind) {
    case "first_commit":
      return { ...out, person: who(m.author) };
    case "release":
      return { ...out, name: m.name };
    case "joined":
    case "left":
      return { ...out, person: who(m.author) };
    case "busiest_day":
      return { ...out, count: m.commits };
    case "cleanup":
      return { ...out, person: who(m.author), count: m.removed };
    case "quiet":
      return { ...out, until: m.until };
    case "language_shift":
      return { ...out, from: m.from, to: m.to };
  }
}

export function activity(a: Analysis, label: string): Activity {
  const v = a.v;
  const pulse = a.pulse(null);
  const split = a.commitsByPerson(pulse, a.contributors(), 5);
  const releases = v.snapshot.releases
    .filter(([, time]) => (a.window.from === null || a.window.from <= time) && time <= a.window.to)
    .map(([name, time]) => ({ name, time }))
    .sort((x, y) => x.time - y.time);
  const total = pulse.commits;
  const unclassified = pulse.work.find((w) => w.work === "unclassified")?.commits ?? 0;
  const kinds =
    total === 0 || unclassified * 2 > total
      ? []
      : pulse.work
          .filter((w) => w.commits > 0 && w.work !== "unclassified")
          .map((w) => ({ kind: w.work, commits: w.commits }))
          .sort((x, y) => y.commits - x.commits);
  return {
    window: label,
    first_day: split.first_day,
    people: split.people.map((p) => personRef(v, p)),
    days: split.days,
    releases,
    week: pulse.week,
    kinds,
    unclassified,
  };
}

function row(a: Analysis, c: Contributor): PersonRow {
  const v = a.v;
  const lines = a.linesByPerson().get(c.author);
  return {
    person: personRef(v, c.author),
    commits: c.commits,
    active_days: c.active_days,
    first: c.first,
    last: c.last,
    lines_added: v.lines ? (lines?.added ?? 0) : null,
    lines_removed: v.lines ? (lines?.removed ?? 0) : null,
    areas: a.areas().get(c.author) ?? 0,
    identities: Math.max(1, v.persons.get(c.author)?.identities ?? 1),
  };
}

export function people(a: Analysis, label: string): People {
  const v = a.v;
  return {
    window: label,
    people: a.contributors().map((c) => row(a, c)),
    bots: a.bots().map((b) => ({ person: personRef(v, b.author), commits: b.commits })),
    suspects: v.snapshot.suspects.map((g) => g.map((p) => personRef(v, p))),
  };
}

export function person(a: Analysis, id: number): Person | null {
  const v = a.v;
  const known = v.persons.get(id);
  if (!known) return null;
  const pulse = a.pulse(id);
  const contributor = a.contributors().find((c) => c.author === id);
  const traits = (
    [
      [TRAIT.sameName, "same_name"],
      [TRAIT.sameAccount, "same_account"],
      [TRAIT.keptApart, "kept_apart"],
      [TRAIT.bot, "bot"],
    ] as const
  )
    .filter(([bit]) => (known.traits & bit) !== 0)
    .map(([, word]) => word);
  return {
    person: personRef(v, id),
    email: "",
    row: contributor ? row(a, contributor) : null,
    addresses: [],
    traits,
    mailmap: "",
    first_day: pulse.first_day,
    days: pulse.days,
    week: pulse.week,
    longest_streak: pulse.longest_streak?.days ?? null,
    work: a
      .workOf(id)
      .slice(0, 20)
      .map((w) => ({ path: v.paths[w.file] ?? "", commits: w.commits })),
    areas: a.heldAlone().flatMap((d) => {
      const first = d.owners[0];
      return first && first.author === id ? [{ folder: d.dir === "" ? "(root)" : d.dir, theirs: first.commits, all: d.commits }] : [];
    }),
  };
}

export function mapLevel(a: Analysis, path: string): MapLevel | null {
  const v = a.v;
  const nodes = a.codeMap();
  const at = nodes.findIndex((n) => n.path === path);
  const here = nodes[at];
  if (!here) return null;
  const block = (n: MapNode, depth: number): MapBlock => ({
    name: n.name,
    path: n.path,
    file: n.file !== null,
    lines: n.lines,
    files: n.files,
    churn: n.churn,
    last_touched: n.last_touched,
    owner: n.owner ? personRef(v, n.owner.author) : null,
    inside:
      depth === 0
        ? []
        : n.children
            .slice(0, 40)
            .flatMap((c) => (nodes[c] ? [block(nodes[c], depth - 1)] : [])),
  });
  return {
    path,
    children: here.children.slice(0, 200).flatMap((c) => (nodes[c] ? [block(nodes[c], 1)] : [])),
  };
}

/** The top folders of the Map, which the Report wrote a level for. */
export function mapFolders(a: Analysis): string[] {
  const nodes = a.codeMap();
  const root = nodes.find((n) => n.path === "");
  return (root?.children ?? []).flatMap((c) => {
    const n = nodes[c];
    return n && n.file === null ? [n.path] : [];
  });
}

export function file(a: Analysis, path: string): File | null {
  const v = a.v;
  const id = v.byPath.get(path);
  if (id === undefined) return null;
  const head = v.headOf.get(id);
  const coupled = a
    .coupling()
    .flatMap((p) => {
      const other = p.first === id ? p.second : p.second === id ? p.first : null;
      return other === null ? [] : [{ path: v.paths[other] ?? "", together: p.both, degree: Math.round(p.jaccard * 100) / 100 }];
    })
    .sort((x, y) => y.degree - x.degree)
    .slice(0, 12);
  return {
    path,
    lines: head ? head.loc : null,
    class: head ? head.class : null,
    churn: a.churnOf(id),
    first_seen: v.known[id] ? (v.born[id] ?? null) : null,
    last_touched: v.known[id] ? (v.last[id] ?? null) : null,
    owners: a.ownersOf(id).map((o) => ({ person: personRef(v, o.author), commits: o.commits })),
    coupled,
    commits: a
      .commitsTouching(id)
      .slice(0, 30)
      .map((c) => {
        const who = authorOf(v, c);
        return { id: v.ids[c] ?? "", time: v.time[c] ?? 0, person: who === null ? null : personRef(v, who) };
      }),
  };
}

export function stats(v: IndexView): Stats {
  const all = new Analysis(v, { from: null, to: v.anchor });
  const totals = all.totals();
  const health = all.health();
  const [commits30d, people30d] = new Analysis(v, { from: v.anchor - 30 * DAY, to: v.anchor }).activity();
  const cutoff = v.anchor - 5 * 365 * DAY;
  let untouched = 0;
  for (const h of v.head) if (isCode(h.class) && v.known[h.file] && (v.last[h.file] ?? 0) < cutoff) untouched += h.loc;
  return {
    commits: totals.commits - totals.merges,
    people: totals.people,
    bus_factor: health.bus_factor,
    maintainers: health.maintainers.length,
    commits_30d: commits30d,
    people_30d: people30d,
    code_lines: totals.code_lines,
    untouched_5y: untouched,
  };
}

export function profiled(a: Analysis): number[] {
  return a
    .contributors()
    .slice(0, FIRST_PROFILES)
    .map((c) => c.author);
}

export type Span = { label: string; window: ViewWindow };
