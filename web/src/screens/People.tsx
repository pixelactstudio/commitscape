import { useState } from "react";
import { changePerson } from "../api/client";
import type { People as Data, Person, PersonRow } from "../api/types";
import { useData } from "../api/useData";
import { Bars } from "../charts/Bars";
import { Figure } from "../charts/common";
import { Calendar, WeekGrid } from "../charts/Grid";
import { Name, Path } from "../components/Name";
import { Explain } from "../explain";
import { compact, date, githubWhy, grouped, many, WINDOW_WORDS } from "../format";
import { openers, type ScreenProps } from "./props";

type Column = {
  key: string;
  label: string;
  value: (r: PersonRow) => number | null;
  shown: (r: PersonRow) => string;
  why: string;
};

/** Hours to merge, in the unit that reads best. */
function hoursWords(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** A number that may not be known yet: never 0 when it is not known. */
function known(n: number | null, words: (n: number) => string = grouped): string {
  return n === null ? "—" : words(n);
}

const COLUMNS: Column[] = [
  { key: "commits", label: "Commits", value: (r) => r.commits, shown: (r) => grouped(r.commits), why: "Commits that are not merges." },
  { key: "days", label: "Active days", value: (r) => r.active_days, shown: (r) => grouped(r.active_days), why: "Days with at least one of their commits, on their own clock." },
  { key: "added", label: "Lines added", value: (r) => r.lines_added, shown: (r) => known(r.lines_added, compact), why: "Lines their commits added, lockfiles and generated files left out. — until the line pass has counted them." },
  { key: "removed", label: "Lines removed", value: (r) => r.lines_removed, shown: (r) => known(r.lines_removed, compact), why: "Lines their commits removed, counted the same way." },
  { key: "areas", label: "Folders held", value: (r) => r.areas, shown: (r) => grouped(r.areas), why: "Folders where they made most of the commits: those that depend on them." },
  { key: "prs", label: "PRs merged", value: (r) => r.prs_merged, shown: (r) => known(r.prs_merged), why: "Their pull requests merged in the Window. — until GitHub's history is read." },
  { key: "reviews", label: "Reviews", value: (r) => r.reviews, shown: (r) => known(r.reviews), why: "Reviews they gave on others' pull requests." },
  { key: "hours", label: "Time to merge", value: (r) => r.hours_to_merge, shown: (r) => known(r.hours_to_merge, hoursWords), why: "From opening to merging, the middle of their merged pull requests." },
];

export function People(props: ScreenProps) {
  if (props.route.id !== undefined) return <Profile {...props} id={props.route.id} />;
  return <PeopleTable {...props} />;
}

function PeopleTable({ meta, params, go }: ScreenProps) {
  const { data, error, stale } = useData<Data>("/api/people", params, meta.generation);
  const [sort, setSort] = useState("commits");
  const open = openers(go);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="waiting">Reading…</p>;
  const column = COLUMNS.find((c) => c.key === sort) ?? COLUMNS[0];
  const rows = [...data.people].sort((a, b) => (column?.value(b) ?? -1) - (column?.value(a) ?? -1));
  return (
    <main className={stale ? "stale" : undefined}>
      <Figure
        title="People"
        note={`${many(data.people.length, "person", "people")} in ${WINDOW_WORDS[data.window] ?? data.window}. No single score: each column is its own measure. Click a heading to sort, a name for their profile.`}
      >
        <div className="scroll">
          <table className="people-table">
            <thead>
              <tr>
                <th>Person</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="num" aria-sort={c.key === sort ? "descending" : undefined}>
                    <button type="button" className="link" onClick={() => setSort(c.key)} title={c.why}>
                      {c.label}
                      {c.key === sort ? " ▼" : ""}
                    </button>
                  </th>
                ))}
                <th>First and last commit</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.person.id}>
                  <td>
                    <Name p={r.person} onOpen={open.person} />
                    {r.identities > 1 && <span className="note small"> {r.identities} addresses</span>}
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="num">
                      {c.shown(r)}
                    </td>
                  ))}
                  <td className="note">
                    {date(r.first)} – {date(r.last)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && <p className="note">The 300 with the most in this column are shown.</p>}
        <Explain>
          <ul>
            {COLUMNS.map((c) => (
              <li key={c.key}>
                <strong>{c.label}:</strong> {c.why}
              </li>
            ))}
          </ul>
          {meta.lines !== "counted" && <p>Lines are {meta.lines === "counting" ? "being counted" : "not counted here"}.</p>}
          {meta.github_history === "complete" ? (
            <p>— under pull requests means GitHub knows no account for the person.</p>
          ) : (
            <p>{githubWhy(meta.github, meta.github_history)}</p>
          )}
        </Explain>
      </Figure>

      {data.suspects.length > 0 && (
        <Figure title="May be one person" note="Names that look alike but were not merged: nothing strong enough joins them.">
          <ul className="suspects">
            {data.suspects.map((g, i) => (
              <li key={i}>
                {g.map((p, j) => (
                  <span key={p.id}>
                    {j > 0 && " · "}
                    <Name p={p} onOpen={open.person} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <Explain>To join them for good, add their lines to the repository's .mailmap: each profile shows them.</Explain>
        </Figure>
      )}

      {data.bots.length > 0 && (
        <Figure title="Bots" note="Automation accounts, kept out of everyone else's numbers">
          <Bars
            unit="commits"
            bars={botsByName(data.bots).map((b) => ({
              key: b.name,
              label: b.accounts > 1 ? `${b.name} (${b.accounts} addresses)` : b.name,
              value: b.commits,
              colour: "var(--other)",
              onClick: () => open.person(b.id),
            }))}
          />
        </Figure>
      )}
    </main>
  );
}

/** Bots by name: one bot commits under several addresses. */
function botsByName(bots: Data["bots"]): { name: string; id: number; commits: number; accounts: number }[] {
  const by = new Map<string, { name: string; id: number; commits: number; accounts: number }>();
  for (const b of bots) {
    const seen = by.get(b.person.name);
    if (seen) {
      seen.commits += b.commits;
      seen.accounts += 1;
    } else {
      by.set(b.person.name, { name: b.person.name, id: b.person.id, commits: b.commits, accounts: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.commits - a.commits);
}

const TRAITS: Record<string, string> = {
  same_name: "Joined because the addresses share a name.",
  same_account: "Joined because GitHub links the addresses to one account.",
  kept_apart: "A merge was undone here: these addresses are kept apart.",
  bot: "An automation account.",
};

function Profile({ meta, params, go, id }: ScreenProps & { id: number }) {
  const { data: p, error, stale } = useData<Person>("/api/person", { ...params, id }, meta.generation);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const open = openers(go);
  if (error) return <p className="error">{error}</p>;
  if (!p) return <p className="waiting">Reading…</p>;
  const r = p.row;
  const change = (undo: boolean) => {
    setChanging(undo ? "Undoing…" : "Joining again…");
    changePerson(p.person.id, undo)
      .then(() => {
        setChanging(null);
        go({ id: undefined });
      })
      .catch((e: Error) => setChanging(e.message));
  };
  const copy = () => {
    void navigator.clipboard?.writeText(p.mailmap).then(() => setCopied(true));
  };
  return (
    <main className={stale ? "stale" : undefined}>
      <p>
        <button type="button" className="link" onClick={() => go({ id: undefined })}>
          ← Everyone
        </button>
      </p>
      <h2 className="profile-name">
        <Name p={p.person} />
      </h2>
      <p className="note">{p.email}</p>
      {r ? (
        <section className="tiles">
          {[
            [grouped(r.commits), "commits"],
            [grouped(r.active_days), "active days"],
            [p.longest_streak === null ? "—" : `${p.longest_streak} days`, "longest streak"],
            [known(r.lines_added, compact), "lines added"],
            [known(r.lines_removed, compact), "lines removed"],
            [known(r.prs_merged), "pull requests merged"],
            [known(r.reviews), "reviews given"],
          ].map(([v, l]) => (
            <div className="tile" key={l}>
              <strong>{v}</strong>
              <span>{l}</span>
            </div>
          ))}
        </section>
      ) : (
        <p className="note">No commits in this window.</p>
      )}
      <Explain>
        The same measures as the People table, for this person alone; the longest streak is the most days in a row with a
        commit. — means not known yet: lines before they are counted, GitHub before it is read.
      </Explain>

      <Figure title="Their days">
        <Calendar firstDay={p.first_day} days={p.days} />
      </Figure>
      <div className="two">
        <Figure title="Their week" note="By weekday and hour, on their own clock">
          <WeekGrid week={p.week} />
        </Figure>
        <Figure title="What they work on" note="The files they changed most">
          <Bars
            unit="commits"
            bars={p.work.slice(0, 12).map((w) => ({
              key: w.path,
              label: <Path path={w.path} />,
              value: w.commits,
              onClick: () => open.file(w.path),
            }))}
          />
        </Figure>
      </div>
      {p.areas.length > 0 && (
        <Figure title="Folders that depend on them" note="Where they made most of the commits">
          <ul className="facts">
            {p.areas.map((a) => (
              <li key={a.folder}>
                <Path path={a.folder} onOpen={(f) => open.folder(f === "(root)" ? "" : f)} />: {grouped(a.theirs)} of{" "}
                {many(a.all, "commit", "commits")}
              </li>
            ))}
          </ul>
        </Figure>
      )}

      <Figure title="Who they are" note="The addresses joined into this person, and why">
        <ul className="facts">
          {p.addresses.map((a) => (
            <li key={a.email}>
              <code>{a.email}</code> <span className="note">{many(a.commits, "commit", "commits")}</span>
            </li>
          ))}
        </ul>
        {p.traits.map((t) => (
          <p key={t} className="note">
            {TRAITS[t] ?? t}
          </p>
        ))}
        <div className="actions">
          {meta.can_change_people && p.addresses.length > 1 && (
            <button type="button" onClick={() => change(true)}>
              These are different people: undo the merge
            </button>
          )}
          {meta.can_change_people && p.traits.includes("kept_apart") && (
            <button type="button" onClick={() => change(false)}>
              Join them again
            </button>
          )}
          {changing && <span className="note">{changing}</span>}
        </div>
        {p.mailmap && (
          <>
            <p className="note">To make this merge permanent for everyone, add these lines to the repository's .mailmap:</p>
            <pre className="mailmap">{p.mailmap}</pre>
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy the .mailmap lines"}
            </button>
          </>
        )}
        <Explain>
          Addresses are joined only on strong evidence: a .mailmap, the same GitHub account, or the same full name. An
          undo is kept in commitscape's cache directory, never in the repository.
        </Explain>
      </Figure>
    </main>
  );
}
