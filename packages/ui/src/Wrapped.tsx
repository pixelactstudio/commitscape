/**
 * The Wrapped page (`commitscape wrapped`): one person's year across the
 * repositories in a folder, written into one file with its card.
 */
import { useState } from "react";
import type { WrappedYear } from "@commitscape/data";
import { Bars } from "./charts/Bars";
import { Columns } from "./charts/Columns";
import { Figure } from "./charts/common";
import { Calendar } from "./charts/Grid";
import { Hours } from "./charts/Hours";
import { TipLayer } from "./charts/Tip";
import { SaveCard } from "./components/SaveCard";
import { Tile } from "./components/Tile";
import { Explain } from "./explain";
import { compact, day, grouped, many, share } from "./format";
import { HelpContext } from "./help";
import { Selector } from "@astryxdesign/core/Selector";
import { Theme } from "@astryxdesign/core/theme";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { Button } from "@astryxdesign/core/Button";
import { commitscapeTheme, MODES, useMode, type Mode } from "./theme";

export default function Wrapped({ y }: { y: WrappedYear }) {
  const [mode, setMode] = useMode();
  const [help, setHelp] = useState(false);
  const total = y.hours.reduce((a, b) => a + b, 0);
  const tiles: [string, string, string][] = [
    [grouped(y.commits), "commits", `in ${many(y.repositories.length, "repository", "repositories")}`],
    [grouped(y.active_days), "days with a commit", `of ${grouped(y.days.length)} so far`],
    [
      y.lines_added === null ? "—" : compact(y.lines_added),
      y.lines_added === null ? "lines not counted" : "lines added",
      y.lines_removed === null ? "run it without --no-lines" : `${compact(y.lines_removed)} removed`,
    ],
    [
      many(y.streak_days, "day", "days"),
      "longest streak",
      y.streak_from === null ? "" : `from ${day(y.streak_from)}`,
    ],
    [
      y.busiest_day === null ? "—" : day(y.busiest_day),
      "busiest day",
      many(y.busiest_commits, "commit", "commits"),
    ],
    [share(y.night, total), "at night", "between 22:00 and 05:00"],
  ];
  return (
    <Theme theme={commitscapeTheme} mode={mode}>
    <ToastViewport>
    <HelpContext value={help}>
      <TipLayer>
        <div className="app wrapped">
          <header className="wrapped-head">
            <h1>{y.title}</h1>
            <div className="tools">
              <Button
                label="Help"
                variant={help ? "primary" : "ghost"}
                size="sm"
                aria-pressed={help}
                onClick={() => setHelp(!help)}
                tooltip="What the numbers mean"
              />
              <Selector
                label="Theme"
                isLabelHidden
                variant="ghost"
                size="sm"
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                options={MODES.map(([value, label]) => ({ value, label }))}
              />
              <SaveCard load={async () => y.card} file={`wrapped-${y.year}.png`} />
            </div>
          </header>
          <p className="note">
            Your own commits, under every address you commit with, across the {grouped(y.looked_in)} repositories in the
            folder. Nothing was uploaded.
          </p>
          <div className="screen">
            <section className="tiles">
              {tiles.map(([value, label, note]) => (
                <Tile key={label} value={value} label={label} note={note} />
              ))}
            </section>
            <Explain>
              Commits that are not merges, from 1 January to the end of the year or today. A streak is days in a row
              with at least one commit, across all the repositories together; days and hours are on your own clock. Lines
              leave out lockfiles and generated files.
            </Explain>
            <Figure title="Your year, day by day">
              <Calendar firstDay={y.first_day} days={y.days} />
            </Figure>
            <Figure title="Commits over the year">
              <Columns firstDay={y.first_day} series={[{ label: "Commits", colour: "var(--s1)", values: y.days }]} />
            </Figure>
            <div className="two">
              <Figure title="Where" note="Commits by repository">
                <Bars
                  unit="commits"
                  bars={y.repositories.slice(0, 10).map((r) => ({
                    key: r.name,
                    label: r.name,
                    value: r.commits,
                    shown: `${grouped(r.commits)} · ${share(r.commits, y.commits)}`,
                  }))}
                />
              </Figure>
              <Figure title="In what" note="Lines added by language">
                {y.languages.length === 0 ? (
                  <p className="note">Lines were not counted.</p>
                ) : (
                  <Bars
                    unit="lines"
                    bars={y.languages.slice(0, 8).map((l) => ({
                      key: l.name,
                      label: l.name,
                      value: l.lines,
                      shown: compact(l.lines),
                    }))}
                  />
                )}
              </Figure>
            </div>
            <Figure title="When" note="Commits by hour of the day, on your clock">
              <Hours hours={y.hours} />
            </Figure>
            <Figure title="The card" note="Saved as a PNG with the button above">
              <img className="card" alt={`${y.title}, as a card`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(y.card)}`} />
            </Figure>
          </div>
          <footer className="note small">Written by commitscape wrapped.</footer>
        </div>
      </TipLayer>
    </HelpContext>
    </ToastViewport>
    </Theme>
  );
}
