import type { ReactNode } from "react";
import { date, grouped } from "../format";
import { ROLE_NAMES, STALE_NAMES, type Look } from "./look";
import type { Who } from "./Panels";

import type { LensName } from "./lenses";

function Swatch({ colour }: { colour: string }) {
  return <span className="inline-block size-2.5 flex-none rounded-full ring-1 ring-line-strong ring-inset" style={{ background: colour }} aria-hidden />;
}

function Chip({ colour, children, onClick, active = false, title }: { colour: string; children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  const body = (
    <>
      <Swatch colour={colour} />
      <span className="min-w-0 max-w-40 truncate">{children}</span>
    </>
  );
  const shape = "flex h-6 min-w-0 flex-none items-center gap-1.5 rounded-full px-2 text-start type-caption whitespace-nowrap text-primary";
  if (!onClick)
    return (
      <li className={shape} title={title}>
        {body}
      </li>
    );
  return (
    <li className="min-w-0 flex-none">
      <button type="button" aria-pressed={active} title={title} className={`plain-button ${shape} max-w-full hover:bg-hover ${active ? "bg-active ring-1 ring-line-strong" : ""}`} onClick={onClick}>
        {body}
      </button>
    </li>
  );
}

/** The colours of the lens on view as one row of chips, the same colours the timeline below is stacked in; people can be clicked to show only what they hold. */
export function LegendRow({ lens, look, slots, who, at, range, languages, solo, onPerson, narrow }: { lens: LensName; look: Look; slots: number[]; who: (p: number) => Who; at: number; range: [number, number] | null; languages: string[]; solo: number | null; onPerson: (p: number) => void; narrow: boolean }) {
  const over = range ? `${date(range[0])} – ${date(range[1])}` : `the year to ${date(at)}`;
  const frost = (k: number) => `color-mix(in oklch, ${look.css.sand}, ${look.css.snow} ${k}%)`;
  return (
    <div className="-mx-1 flex min-w-0 items-center gap-x-1 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] pe-6 [scrollbar-width:none]">
      {lens === "holder" && (
        <>
          <span className={narrow ? "sr-only" : "flex-none pe-1 type-caption text-secondary"}>Most commits in {over}</span>
          <ul className="m-0 flex list-none items-center gap-0.5 p-0" aria-label="Who holds which colour">
            {slots.map((p, k) =>
              p >= 0 ? (
                <Chip key={`${k}-${p}`} colour={look.css.slots[k] ?? look.css.other} onClick={() => onPerson(p)} active={solo === p} title={`${who(p).name}: show only the files they hold`}>
                  {who(p).name}
                </Chip>
              ) : null,
            )}
            <Chip colour={look.css.other}>Someone else</Chip>
            <Chip colour={look.css.sand}>Nobody</Chip>
            <li className="flex h-6 flex-none items-center gap-1.5 ps-2 type-caption whitespace-nowrap text-secondary" title="Frost is Staleness: the longer since the last commit, the whiter">
              <span>Frost, untouched</span>
              <span className="flex items-center gap-1.5">
                <Swatch colour={frost(25)} />
                90 d
                <Swatch colour={frost(55)} />1 y
                <Swatch colour={frost(90)} />2 y+
              </span>
            </li>
          </ul>
        </>
      )}
      {lens === "role" && (
        <ul className="m-0 flex list-none flex-wrap items-center gap-0.5 p-0" aria-label="Roles">
          {ROLE_NAMES.map((name, i) => (
            <Chip key={name} colour={look.css.roles[i] ?? look.css.other}>
              {name}
            </Chip>
          ))}
        </ul>
      )}
      {lens === "stale" && (
        <>
          <span className={narrow ? "sr-only" : "flex-none pe-1 type-caption text-secondary"}>Last commit before {date(at)}</span>
          <ul className="m-0 flex list-none flex-wrap items-center gap-0.5 p-0" aria-label="Staleness">
            {STALE_NAMES.map((name, i) => (
              <Chip key={name} colour={look.css.stale[i] ?? look.css.other}>
                {name}
              </Chip>
            ))}
          </ul>
        </>
      )}
      {lens === "language" && (
        <ul className="m-0 flex list-none flex-wrap items-center gap-0.5 p-0" aria-label="Languages">
          {languages.map((name, i) => (
            <Chip key={name} colour={look.css.languages[i] ?? look.css.other}>
              {name}
            </Chip>
          ))}
          <Chip colour={look.css.languages[8] ?? look.css.other}>Other</Chip>
          <Chip colour={look.css.languages[9] ?? look.css.sand}>None</Chip>
        </ul>
      )}
    </div>
  );
}

/** Everything the map's shapes and colours stand for, said once and exactly. */
export function Reading({ tallest, range, mainline, commits, files }: { tallest: number; range: [number, number] | null; mainline: boolean; commits: number; files: number }) {
  return (
    <div className="flex w-80 flex-col gap-2 p-3.5 type-caption text-secondary">
      <p className="m-0 type-label">How to read the Universe</p>
      <p className="m-0">
        <span className="font-semibold text-primary">One hex is one file</span> the default branch ever had: {grouped(files)} of them, laid out by folder along a Gosper curve, so every folder is one region and each top-level folder an island. Nearness means only "in the same folder". Files sit where their last path puts them; a file moved and changed in one commit is a new file.
      </p>
      <p className="m-0">
        <span className="font-semibold text-primary">Height</span> is {range ? "the commits in the range" : "the commits so far"}, on a log scale; the tallest has {grouped(tallest)}. Merge and Bulk Commits are left out.
      </p>
      <p className="m-0">
        <span className="font-semibold text-primary">Who holds it</span>: whoever made the most of its commits in the year before the playhead, ties to the latest. Eight colours go to the eight people with the most commits in that year, and a person keeps theirs while they stay among them. Bots never hold a file.
      </p>
      <p className="m-0">
        <span className="font-semibold text-primary">Frost</span> is Staleness: time since the file's last commit, Bulk Commits counted.
      </p>
      <p className="m-0">
        <span className="font-semibold text-primary">Time</span>: {mainline ? `the ${grouped(commits)} commits that reached the default branch, each at the moment it arrived there (its Main Arrival)` : `all ${grouped(commits)} commits on every branch, by commit time, as the default branch is not worked out yet`}. A file rises when it is first added and sinks to the seabed when it is deleted. Beacons are people who hold a colour and made a commit in the 28 days before; they stand over the folder that holds most of those changes.
      </p>
    </div>
  );
}
