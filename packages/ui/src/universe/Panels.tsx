import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { FileCode, FolderTree, GitCommitHorizontal, Users, X } from "lucide-react";
import type { FolderFacts, Holder, PersonFacts } from "@commitscape/data/universe";
import { Face } from "../components/Face";
import { date, grouped, share } from "../format";
import { ROLE_NAMES } from "./look";
import type { FileAnswer } from "./protocol";

export type Who = { name: string; login: string | null; colour: string | null };

const STALE_WORDS = ["under 90 days", "90 days to a year", "1 to 2 years", "over 2 years"];

function staleWords(last: number | null, at: number): string {
  if (last === null) return "never touched";
  const days = (at - last) / 86_400;
  return STALE_WORDS[days < 90 ? 0 : days < 365 ? 1 : days < 730 ? 2 : 3] ?? "";
}

function Dot({ colour }: { colour: string | null }) {
  return <span className="inline-block size-2 flex-none rounded-full" style={{ background: colour ?? "var(--other)" }} aria-hidden />;
}

/** The small card that follows the pointer over a hex: the file's path, who holds it and its counts at the playhead. */
export function HoverCard({ facts, at, range, who, x, y, width, height }: { facts: FileAnswer | null; at: number; range: [number, number] | null; who: (p: number) => Who; x: number; y: number; width: number; height: number }) {
  const left = Math.min(Math.max(8, x + 16), width - 296);
  const top = y + 16 + 150 > height ? Math.max(8, y - 150) : y + 16;
  return (
    <div className="pointer-events-none absolute z-20 w-72 rounded-md bg-surface p-2.5 shadow-(--shadow-lg)" style={{ left, top }} role="tooltip">
      {!facts ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton width="80%" height={14} />
          <Skeleton width="60%" height={12} />
        </div>
      ) : (
        <FileLines facts={facts} at={at} range={range} who={who} compact />
      )}
    </div>
  );
}

function FileLines({ facts, at, range, who, compact = false, path = true }: { facts: FileAnswer; at: number; range: [number, number] | null; who: (p: number) => Who; compact?: boolean; path?: boolean }) {
  const holder = facts.holder ? who(facts.holder.person) : null;
  const yearTo = range ? `${date(range[0])} – ${date(range[1])}` : `the year to ${date(at)}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {path && <p className={`m-0 mono type-caption break-all text-primary ${compact ? "line-clamp-2" : ""}`}>{facts.path || facts.name}</p>}
      {!facts.alive && facts.died !== null && at >= facts.died ? (
        <p className="m-0 type-caption text-secondary">{facts.dated ? `Deleted ${date(facts.died)}: on the seabed now` : `Gone by HEAD, last changed ${date(facts.died)} (removed by a Merge Commit or a move)`}</p>
      ) : facts.holder && holder ? (
        <p className="m-0 flex items-center gap-1.5 type-caption text-secondary">
          <Dot colour={holder.colour} />
          <span className="min-w-0">
            Held by <span className="font-semibold text-primary">{holder.name}</span>: {grouped(facts.holder.commits)} of {grouped(facts.inYear)} commits in {yearTo}
          </span>
        </p>
      ) : (
        <p className="m-0 type-caption text-secondary">Nobody holds it: no commits in {yearTo}</p>
      )}
      <p className="m-0 type-caption text-secondary">
        <span className="font-semibold text-primary tabular-nums">{grouped(facts.commits)}</span> commits so far
        {facts.lastTouch !== null && (
          <>
            {" "}
            · last touched {date(facts.lastTouch)} ({staleWords(facts.lastTouch, at)})
          </>
        )}
      </p>
    </div>
  );
}

function Panel({ title, label, sub, onClose, children, actions }: { title: ReactNode; label: string; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-surface shadow-(--shadow-lg)" aria-label={label}>
      <header className="flex items-start gap-2 border-b border-line px-3.5 pt-3 pb-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 type-heading break-all text-primary">{title}</h2>
          {sub && <p className="m-0 type-caption text-secondary">{sub}</p>}
        </div>
        <IconButton label="Close (Esc)" size="sm" variant="ghost" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3 [&>*]:shrink-0">{children}</div>
      {actions && <footer className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5">{actions}</footer>}
    </section>
  );
}

function Numbers({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col gap-0.5 bg-surface px-2.5 py-2">
          <dt className="order-2 type-caption text-secondary">{i.label}</dt>
          <dd className="order-1 m-0 truncate type-stat-sm text-primary tabular-nums">{i.value}</dd>
          {i.note && <dd className="order-3 m-0 type-caption text-tertiary">{i.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function People({ title, list, who, onPerson, total }: { title: string; list: Holder[]; who: (p: number) => Who; onPerson: (p: number) => void; total?: number }) {
  if (list.length === 0) return null;
  const most = Math.max(1, ...list.map((h) => h.commits));
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 type-label text-secondary">{title}</h3>
      <ol className="m-0 flex list-none flex-col p-0">
        {list.map((h) => {
          const w = who(h.person);
          return (
            <li key={h.person}>
              <button type="button" className="plain-button grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-start hover:bg-hover" onClick={() => onPerson(h.person)}>
                <Face login={w.login} name={w.name} size={20} ring={w.colour ?? undefined} />
                <span className="truncate type-ui text-primary">{w.name}</span>
                <span className="type-caption text-secondary tabular-nums">
                  {grouped(h.commits)}
                  {total ? ` · ${share(h.commits, total)}` : ""}
                </span>
                <span className="col-span-3 col-start-1 block h-1 overflow-hidden rounded-full bg-track" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${(h.commits * 100) / most}%`, background: w.colour ?? "var(--other)" }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Years({ list }: { list: { year: number; commits: number }[] }) {
  if (list.length === 0) return null;
  const first = list[0]?.year ?? 0;
  const last = list.at(-1)?.year ?? first;
  const by = new Map(list.map((y) => [y.year, y.commits]));
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const most = Math.max(1, ...list.map((y) => y.commits));
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 type-label text-secondary">Commits a year</h3>
      <div className="flex h-12 items-end gap-px" role="img" aria-label={list.map((y) => `${y.year}: ${y.commits}`).join(", ")}>
        {years.map((y) => (
          <span key={y} className="min-w-0 flex-1 rounded-t-xs bg-brand" style={{ height: `${Math.max((by.get(y) ?? 0) > 0 ? 6 : 0, ((by.get(y) ?? 0) * 100) / most)}%` }} title={`${y}: ${by.get(y) ?? 0} commits`} />
        ))}
      </div>
      <div className="flex justify-between type-caption text-tertiary tabular-nums">
        <span>{first}</span>
        {last !== first && <span>{last}</span>}
      </div>
    </div>
  );
}

/** A file's panel: its story at the playhead, who holds it, and the ways out to the Code window, Commits and the Map. */
export function FilePanel({ facts, at, range, who, onClose, onPerson, onCode, onCommits, onMap }: { facts: FileAnswer | null; at: number; range: [number, number] | null; who: (p: number) => Who; onClose: () => void; onPerson: (p: number) => void; onCode: () => void; onCommits: () => void; onMap: () => void }) {
  if (!facts) return <PanelSkeleton onClose={onClose} />;
  const folder = facts.path.slice(0, Math.max(0, facts.path.lastIndexOf("/")));
  const status = facts.aliveAtHead ? "At HEAD" : facts.died !== null ? (facts.dated ? `Deleted ${date(facts.died)}` : "Gone by HEAD") : "Not at HEAD";
  return (
    <Panel
      label={`File ${facts.path}`}
      title={<span className="mono type-label break-all">{facts.name || facts.path}</span>}
      sub={
        <>
          <span className="mono">{folder ? `${folder}/` : "the top folder"}</span> · {status} · {ROLE_NAMES[facts.role] ?? "Code"}
          {facts.language ? ` · ${facts.language}` : ""}
        </>
      }
      onClose={onClose}
      actions={
        <>
          {facts.aliveAtHead && <Button label="Open in Code" size="sm" variant="primary" icon={<Icon icon={FileCode} size="sm" />} onClick={onCode} />}
          <Button label="Its commits" size="sm" variant="secondary" icon={<Icon icon={GitCommitHorizontal} size="sm" />} onClick={onCommits} />
          {facts.aliveAtHead && <Button label="On the Map" size="sm" variant="ghost" icon={<Icon icon={FolderTree} size="sm" />} onClick={onMap} />}
        </>
      }
    >
      <FileLines facts={facts} at={at} range={range} who={who} path={false} />
      <Numbers
        items={[
          { label: "commits so far on the default branch", value: grouped(facts.commits) },
          { label: range ? "commits in the range" : "in the year to the playhead", value: grouped(facts.inYear) },
          { label: "last touched", value: facts.lastTouch === null ? "never" : date(facts.lastTouch), note: staleWords(facts.lastTouch, at) },
          { label: "lines at HEAD", value: facts.lines === null ? (facts.aliveAtHead ? "not counted" : "gone") : grouped(facts.lines), note: `on the default branch since ${date(facts.born)}` },
        ]}
      />
      <People title={range ? "Who made its commits in the range" : "Who made its commits in the year"} list={facts.year} who={who} onPerson={onPerson} total={facts.inYear} />
      <People title="Who made its commits, all time" list={facts.ever} who={who} onPerson={onPerson} total={facts.commits} />
      <Years list={facts.perYear} />
    </Panel>
  );
}

/** A folder's panel at the playhead: files alive and frozen, its commits in the year and who made them, its Bus Factor. */
export function FolderPanel({ facts, at, who, onClose, onPerson, onMap, onCommits, onFocus, focused }: { facts: FolderFacts | null; at: number; who: (p: number) => Who; onClose: () => void; onPerson: (p: number) => void; onMap: () => void; onCommits: () => void; onFocus: () => void; focused: boolean }) {
  if (!facts) return <PanelSkeleton onClose={onClose} />;
  return (
    <Panel
      label={`Folder ${facts.path || "the whole repository"}`}
      title={<span className="mono">{facts.path ? `${facts.path}/` : "The whole repository"}</span>}
      sub={`${grouped(facts.files)} files ever · first commit ${date(facts.first)}`}
      onClose={onClose}
      actions={
        <>
          <Button label={focused ? "Show everything" : "Show only this folder"} size="sm" variant="secondary" onClick={onFocus} />
          <Button label="On the Map" size="sm" variant="ghost" icon={<Icon icon={FolderTree} size="sm" />} onClick={onMap} />
          <Button label="Its commits" size="sm" variant="ghost" icon={<Icon icon={GitCommitHorizontal} size="sm" />} onClick={onCommits} />
        </>
      }
    >
      <Numbers
        items={[
          { label: "files alive", value: grouped(facts.alive), note: `at ${date(at)}` },
          { label: "frozen: no commit in a year", value: grouped(facts.frozen), note: facts.alive ? `${share(facts.frozen, facts.alive)} of those alive` : undefined },
          { label: "commits in the year to the playhead", value: grouped(facts.commits) },
          { label: "Bus Factor in that year", value: facts.busFactor === null ? "none" : grouped(facts.busFactor), note: "people holding over 80% of its commits" },
        ]}
      />
      <People title="Who made its commits in the year" list={facts.holders} who={who} onPerson={onPerson} total={facts.commits} />
      {facts.holders.length === 0 && <p className="m-0 type-caption text-secondary">Nobody made a commit here in the year to {date(at)}.</p>}
    </Panel>
  );
}

/** A person's panel: their commits on the default branch, the year to the playhead, and the folders they worked in by when they first did. */
export function PersonPanel({ facts, at, who, colour, solo, onClose, onSolo, onPeople, onFolder }: { facts: PersonFacts | null; at: number; who: Who; colour: string | null; solo: boolean; onClose: () => void; onSolo: () => void; onPeople: (() => void) | null; onFolder: (folder: number) => void }) {
  if (!facts) return <PanelSkeleton onClose={onClose} />;
  return (
    <Panel
      label={`Person ${who.name}`}
      title={
        <span className="flex items-center gap-2">
          <Face login={who.login} name={who.name} size={24} ring={colour ?? undefined} />
          <span className="min-w-0 truncate">{who.name}</span>
        </span>
      }
      sub={who.login ? `@${who.login}` : undefined}
      onClose={onClose}
      actions={
        <>
          <Button label={solo ? "Show everyone" : "Show only what they hold"} size="sm" variant="secondary" onClick={onSolo} />
          {onPeople && <Button label="In People" size="sm" variant="ghost" icon={<Icon icon={Users} size="sm" />} onClick={onPeople} />}
        </>
      }
    >
      <Numbers
        items={[
          { label: "commits on the default branch", value: grouped(facts.commits) },
          { label: "in the year to the playhead", value: grouped(facts.inYear), note: date(at) },
          { label: "first commit", value: facts.first === null ? "none" : date(facts.first) },
          { label: "last commit", value: facts.last === null ? "none" : date(facts.last) },
        ]}
      />
      {facts.folders.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 type-label text-secondary">Where they worked, by first commit</h3>
          <ol className="m-0 flex list-none flex-col p-0">
            {facts.folders.slice(0, 14).map((f) => (
              <li key={f.folder}>
                <button type="button" className="plain-button grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 rounded-md px-1.5 py-1 text-start hover:bg-hover" onClick={() => onFolder(f.folder)}>
                  <span className="type-caption text-tertiary tabular-nums">{new Date(f.first * 1000).getUTCFullYear()}</span>
                  <span className="truncate mono type-caption text-primary">{f.path ? `${f.path}/` : "top folder"}</span>
                  <span className="type-caption text-secondary tabular-nums">{grouped(f.commits)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function PanelSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <Panel label="Loading the details" title={<Skeleton width={180} height={18} />} onClose={onClose}>
      <Skeleton height={112} radius={3} />
      <Skeleton height={14} width="70%" />
      <Skeleton height={14} width="55%" />
      <Skeleton height={14} width="62%" />
    </Panel>
  );
}

