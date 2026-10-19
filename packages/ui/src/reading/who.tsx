import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ChevronRight, Trophy } from "lucide-react";
import type { PersonRow } from "@commitscape/data";
import { useTip } from "../charts/tip";
import { TipCard } from "../charts/Tip";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { useStanding } from "../components/Name";
import { useCounting } from "../data";
import { ICON } from "../design/tokens";
import { compact, date, grouped, many, share } from "../format";
import { A } from "../kit/A";
import { Panel } from "../kit/layout";
import { FILL_PANEL } from "./classes";
import { Counting } from "../kit/pending";
import { personColour } from "../theme";

export const ROW_HEIGHT = "h-14";

/** The people who made most of a repository's commits, as a bar of their shares and a row each; the names open what they did here, the numbers their commits. */
export function WhoBuiltIt({ rows, listed, everyone, commits, span, empty, onPerson, onCommits, onAll }: { rows: PersonRow[]; listed: number; everyone: number | null; commits: number; span: string; empty: ReactNode; onPerson: (id: number) => void; onCommits: (id: number) => void; onAll: () => void }) {
  const counting = useCounting();
  const people = everyone !== null && everyone > listed ? grouped(everyone) : grouped(listed);
  const lines = counting || rows.some((r) => r.lines_added !== null);
  const description = listed === 0 ? `Nobody committed ${span}` : listed === 1 ? `One person ${span}` : `${people} people ${span}, most commits first`;
  return (
    <Panel padding={0} title="Who built it" description={description} className={FILL_PANEL}>
      {rows.length === 0 ? (
        <div className="px-5 pb-5">{empty}</div>
      ) : (
        <>
          <ShareStrip rows={rows} commits={commits} span={span} />
          <ol className="@container m-0 list-none p-0" aria-label="Contributors">
            {rows.map((r) => (
              <Contributor key={r.person.id} r={r} commits={commits} lines={lines} onPerson={onPerson} onCommits={onCommits} />
            ))}
          </ol>
        </>
      )}
      {rows.length > 0 && (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-separator px-5 py-2.5">
          <span className="hidden type-caption sm:inline">{lines ? "Lines leave out lockfiles and generated files" : "Select a name for what they did here"}</span>
          {listed > 0 && (
            <span className="ms-auto">
              <Button label={listed > rows.length ? `All ${people} people` : "People"} variant="ghost" size="sm" onClick={onAll} endContent={<ChevronRight size={ICON.sm} aria-hidden />} />
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

function ShareStrip({ rows, commits, span }: { rows: PersonRow[]; commits: number; span: string }) {
  const tip = useTip();
  const whole = Math.max(1, commits);
  const theirs = rows.reduce((n, r) => n + r.commits, 0);
  const rest = Math.max(0, commits - theirs);
  return (
    <div className="flex flex-col gap-2 px-5 pb-4">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`The ${rows.length} people listed made ${share(theirs, whole)} of the commits ${span}`}>
        {rows.map((r) => (
          <span
            key={r.person.id}
            className="block h-full min-w-0.75 hover:opacity-80"
            style={{ flexGrow: r.commits, flexBasis: 0, background: personColour(r.person.colour) }}
            {...tip(<TipCard swatch={personColour(r.person.colour)} title={r.person.name} value={grouped(r.commits)} unit={r.commits === 1 ? "commit" : "commits"} note={`${share(r.commits, whole)} of all`} />)}
          />
        ))}
        {rest > 0 && <span className="block h-full min-w-0.75 bg-track" style={{ flexGrow: rest, flexBasis: 0 }} {...tip(<TipCard swatch="var(--color-track)" title="Everyone else" value={grouped(rest)} unit={rest === 1 ? "commit" : "commits"} note={`${share(rest, whole)} of all`} />)} />}
      </div>
      <span className="type-caption">
        {rows.length === 1 ? "They made" : `These ${rows.length} made`} <strong className="font-semibold text-primary tnum">{share(theirs, whole)}</strong> of the {many(commits, "commit", "commits")} {span}
      </span>
    </div>
  );
}

function Contributor({ r, commits, lines, onPerson, onCommits }: { r: PersonRow; commits: number; lines: boolean; onPerson: (id: number) => void; onCommits: (id: number) => void }) {
  const login = useLogin(r.person);
  const standing = useStanding(login);
  const counting = useCounting();
  const colour = personColour(r.person.colour);
  return (
    <li className={`row-hover relative flex ${ROW_HEIGHT} items-center gap-3 border-t border-separator px-5`}>
      <Face login={login} name={r.person.name} size={32} ring={colour} tint={colour} decorative />
      <span className="flex min-w-0 flex-1 flex-col">
        <button type="button" onClick={() => onPerson(r.person.id)} className="plain-button w-fit max-w-full truncate type-ui font-medium text-primary after:absolute after:inset-0 hover:underline hover:decoration-line-strong hover:underline-offset-4">
          <bdi>{r.person.name}</bdi>
        </button>
        <span className="truncate type-caption">{login ? <bdi className="type-id">@{login}</bdi> : `${date(r.first)} – ${date(r.last)}`}</span>
      </span>
      <span className="relative flex flex-none flex-col items-end tnum">
        <button type="button" onClick={() => onCommits(r.person.id)} aria-label={`${many(r.commits, "commit", "commits")} by ${r.person.name}`} title={`${r.person.name}’s commits`} className="plain-button hit type-ui font-semibold text-primary hover:underline hover:decoration-line-strong hover:underline-offset-4">
          {grouped(r.commits)}
        </button>
        <span className="type-caption">{share(r.commits, commits)} of commits</span>
      </span>
      {lines && (
        <span className="hidden w-16 flex-none flex-col items-end type-caption tnum @min-[26rem]:flex">
          {r.lines_added === null ? (
            counting ? (
              <>
                <Counting width={44} height={12} />
                <Counting width={36} height={12} index={1} />
              </>
            ) : (
              <span title="Not counted in this Report" className="text-tertiary">
                —<span className="sr-only">not counted</span>
              </span>
            )
          ) : (
            <>
              <span className="text-added">+{compact(r.lines_added)}</span>
              <span className="text-removed">−{compact(r.lines_removed ?? 0)}</span>
            </>
          )}
        </span>
      )}
      <span className="relative hidden w-7 flex-none @min-[26rem]:block">
        {standing && (
          <A href={standing} aria-label={`Where ${r.person.name} stands here`} title={`Where ${r.person.name} stands here`} className="hit grid size-7 place-items-center rounded-md text-secondary no-underline hover:bg-hover hover:text-primary">
            <Trophy size={ICON.sm} aria-hidden />
          </A>
        )}
      </span>
    </li>
  );
}
