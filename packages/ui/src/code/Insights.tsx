import { useMemo, type ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, GitCommitHorizontal } from "lucide-react";
import type { CodeStory, GitTree, PersonRef } from "@commitscape/data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { ICON, SERIES } from "../design/tokens";
import { A } from "../kit/A";
import { Meter } from "../kit/layout";
import { date, duration, grouped, many, share } from "../format";
import { NO_DRILL } from "../route";
import { bytes, folderStats, type Ranked } from "../git/insights";
import { indexOfPath } from "../git/tree";
import { useCode } from "./context";
import { couplingQuery } from "./data";

function Block({ id, title, note, children, actions }: { id: string; title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={id} className="m-0 type-label">
            {title}
          </h3>
          {note && <p className="m-0 type-micro text-pretty">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Person({ p, colour }: { p: PersonRef; colour?: string }) {
  const login = useLogin(p);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {colour && <span className="size-2 flex-none rounded-full" style={{ background: colour }} aria-hidden />}
      <Face login={login} name={p.name} size={16} />
      <span className="truncate">{p.name}</span>
    </span>
  );
}

function OwnersOverTime({ story }: { story: CodeStory }) {
  const people = useMemo(() => {
    const total = new Map<number, { p: PersonRef; n: number }>();
    for (const y of story.years) for (const o of y.owners) total.set(o.person.id, { p: o.person, n: (total.get(o.person.id)?.n ?? 0) + o.commits });
    return [...total.values()].sort((a, b) => b.n - a.n || a.p.id - b.p.id);
  }, [story]);
  const colourOf = new Map(people.slice(0, SERIES.length - 1).map((e, i) => [e.p.id, SERIES[i] as string]));
  const most = Math.max(1, ...story.years.map((y) => y.owners.reduce((n, o) => n + o.commits, 0) + y.others));
  const years = [...story.years].reverse().filter((y) => y.owners.length > 0 || y.others > 0);
  if (years.length === 0) return <p className="m-0 type-caption">No commit that counts touched it.</p>;
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs" aria-label="Who the colours are">
        {people.slice(0, SERIES.length - 1).map((e) => (
          <li key={e.p.id} className="min-w-0">
            <Person p={e.p} colour={colourOf.get(e.p.id)} />
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-secondary">
          <span className="size-2 rounded-full bg-other" aria-hidden />
          everyone else
        </li>
      </ul>
      <table className="w-full border-collapse text-sm tnum">
        <caption className="sr-only">Commits that count each year, by who made them</caption>
        <tbody>
          {years.map((y) => {
            const all = y.owners.reduce((n, o) => n + o.commits, 0) + y.others;
            const parts = [...y.owners.map((o) => ({ key: String(o.person.id), n: o.commits, colour: colourOf.get(o.person.id) ?? "var(--other)", words: `${o.person.name}: ${many(o.commits, "commit", "commits")}` })), ...(y.others > 0 ? [{ key: "other", n: y.others, colour: "var(--other)", words: `everyone else: ${many(y.others, "commit", "commits")}` }] : [])];
            return (
              <tr key={y.year} className="h-7">
                <th scope="row" className="w-12 pe-3 text-start font-normal text-secondary">
                  {y.year}
                </th>
                <td>
                  <span className="flex h-2.5 gap-0.5" style={{ width: `${Math.max(3, (all * 100) / most)}%` }}>
                    {parts.map((part) => (
                      <span key={part.key} title={`${y.year}, ${part.words}`} className="block h-full min-w-0.5 first:rounded-s-full last:rounded-e-full" style={{ flexGrow: part.n, background: part.colour }} />
                    ))}
                  </span>
                  <span className="sr-only">{parts.map((p) => p.words).join("; ")}</span>
                </td>
                <td className="w-24 ps-3 text-end text-xs text-secondary">{many(all, "commit", "commits")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Holders({ story }: { story: CodeStory }) {
  if (story.holders.length === 0) return <p className="m-0 type-caption">No commit that counts touched it.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {story.holders.map((h, i) => (
        <li key={h.person.id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <Person p={h.person} />
            <span className="flex flex-none items-center gap-2 text-xs text-secondary tnum">
              {h.maintainer && <span className="rounded-full border border-brand-line bg-brand-soft px-1.5 text-brand">Maintainer</span>}
              {many(h.commits, "commit", "commits")} · {share(h.commits, story.counted)}
            </span>
          </div>
          <Meter value={h.share} label={`${h.person.name}'s share of its commits`} tone={i === 0 ? "brand" : "neutral"} />
        </li>
      ))}
    </ol>
  );
}

function FileLink({ path, value }: { path: string; value: ReactNode }) {
  const { open, href } = useCode();
  const cut = path.lastIndexOf("/");
  return (
    <A
      href={href(path)}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(path);
      }}
      title={path}
      className="row-hover -mx-1.5 flex items-center gap-3 rounded-sm px-1.5 py-1 text-sm no-underline"
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="text-primary type-id">{path.slice(cut + 1)}</span>
        {cut > 0 && <span className="ms-2 text-xs text-tertiary">{path.slice(0, cut)}</span>}
      </span>
      <span className="flex-none text-xs text-secondary tnum">{value}</span>
    </A>
  );
}

function Coupled({ tree, path }: { tree: GitTree; path: string }) {
  const { git } = useCode();
  const coupling = useQuery(couplingQuery(git));
  const index = indexOfPath(tree, path);
  if (coupling.isPending) return <Skeleton height={96} />;
  if (coupling.isError) return <p className="m-0 type-caption">Change Coupling could not be read.</p>;
  const flat = coupling.data.of[String(index)] ?? [];
  const rows: { path: string; together: number; degree: number }[] = [];
  for (let k = 0; k + 2 < flat.length; k += 3) rows.push({ path: tree.paths[flat[k] as number] ?? "", together: flat[k + 1] as number, degree: flat[k + 2] as number });
  if (rows.length === 0) return <p className="m-0 type-caption">It does not change with any one file often enough to say.</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li key={r.path}>
          <FileLink path={r.path} value={`${Math.round(r.degree / 10)}% · ${many(r.together, "commit", "commits")}`} />
        </li>
      ))}
    </ul>
  );
}

function Ranking({ id, title, note, items, tree, show }: { id: string; title: string; note: string; items: Ranked[]; tree: GitTree; show: (r: Ranked) => string }) {
  return (
    <Block id={id} title={title} note={note}>
      {items.length === 0 ? (
        <p className="m-0 type-caption">Nothing here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((r) => (
            <li key={r.index}>
              <FileLink path={tree.paths[r.index] ?? ""} value={show(r)} />
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function FolderRankings({ tree, folder }: { tree: GitTree; folder: string }) {
  const stats = useMemo(() => folderStats(tree, folder, new Map(tree.dirs.map((d) => [d.path, d]))), [tree, folder]);
  const days = (at: number) => Math.max(0, (tree.builtAt - at) / 86_400);
  return (
    <>
      <Ranking id="code-hot" title="Changes most" note="Commits that touched the file, merges and Bulk Commits left out" items={stats.hot} tree={tree} show={(r) => many(r.value, "commit", "commits")} />
      <Ranking id="code-cold" title="Untouched the longest" note="Time from its last commit to the Build" items={stats.cold} tree={tree} show={(r) => duration(days(r.value))} />
      <Ranking id="code-large" title="Largest" note="By bytes at HEAD" items={stats.largest} tree={tree} show={(r) => bytes(r.value)} />
    </>
  );
}

/** What the history says of a file or folder beyond its story: who held it year by year, who holds it now, the files that change with it, and for a folder the files that change most, least and are largest. */
export function Insights({ story, path }: { story: CodeStory | undefined; path: string }) {
  const { tree, route, link } = useCode();
  if (!story)
    return (
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-hidden p-4 md:p-5" role="status" aria-busy="true" aria-label="Loading">
        <Skeleton height={220} />
        <Skeleton height={160} index={1} />
      </div>
    );
  const folder = story.kind === "folder";
  const actions = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <A href={link({ ...route, screen: "commits", ...NO_DRILL, under: path, q: undefined, id: undefined, file: undefined })} className="inline-flex items-center gap-1.5 inline-link">
        <GitCommitHorizontal size={ICON.sm} aria-hidden />
        Its commits on the Commits screen
      </A>
      <A href={link({ ...route, screen: "map", path: folder ? path : path.slice(0, path.lastIndexOf("/") + 1), file: folder ? undefined : path, id: undefined })} className="inline-flex items-center gap-1.5 inline-link">
        <FolderTree size={ICON.sm} aria-hidden />
        {folder ? "This folder" : "This file"} on the Map
      </A>
    </div>
  );
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto grid max-w-5xl gap-4 p-4 @md:p-5 @3xl:grid-cols-2">
        <div className="@3xl:col-span-2">{actions}</div>
        <div className="@3xl:col-span-2">
          <Block id="code-owners-years" title="Who held it, year by year" note={`Commits that count each year, by the ${story.years.some((y) => y.others > 0) ? "three people who made most, and everyone else with bots" : "people who made them"}; merges and Bulk Commits left out`}>
            <OwnersOverTime story={story} />
          </Block>
        </div>
        <Block id="code-holders" title="Who holds it" note={`Ownership over its whole history: shares of the ${grouped(story.counted)} commits that count, bots left out. A Maintainer made 3 or more commits in the 90 days before the Build.`}>
          <Holders story={story} />
        </Block>
        {!folder &&
          (tree ? (
            <Block id="code-coupled" title="Changes together with" note="Change Coupling: files in the same commits, as a share of the commits touching either">
              <Coupled tree={tree} path={path} />
            </Block>
          ) : (
            <Skeleton height={160} />
          ))}
        {folder && tree && <FolderRankings tree={tree} folder={path} />}
        {story.born && (
          <p className="m-0 type-micro @3xl:col-span-2">
            Read from the history up to the Build: born {date(story.born.at)}, {many(story.commits, "commit", "commits")} in all.
          </p>
        )}
      </div>
    </div>
  );
}
