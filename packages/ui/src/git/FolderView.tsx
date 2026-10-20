import { useMemo, type MouseEvent } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileCode, FileText, Folder } from "lucide-react";
import { pullOf, rangeOf, type FolderEntryLast, type GitTree } from "@commitscape/data";
import { A } from "../kit/A";
import { ICON } from "../design/tokens";
import { date, many } from "../format";
import { useCode } from "../code/context";
import { lastQuery, textQuery } from "../code/data";
import { Prose } from "../code/Prose";
import { Heat } from "./FileTree";
import { heatOf } from "./insights";

type Entry = { name: string; dir: boolean; path: string; churn: number; index: number; last: FolderEntryLast | undefined };

const README = /^readme(\.(md|markdown|mdx|txt|rst))?$/i;

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

function entriesOf(tree: GitTree | undefined, folder: string, last: readonly FolderEntryLast[]): Entry[] {
  const byName = new Map(last.map((e) => [`${e.name}${e.dir ? "/" : ""}`, e]));
  const seen = new Map<string, Entry>();
  if (tree) {
    const dirs = new Map(tree.dirs.map((d) => [d.path, d]));
    const [lo, hi] = folder === "" ? [0, tree.paths.length] : rangeOf(tree.paths, folder);
    for (let i = lo; i < hi; i++) {
      const p = tree.paths[i] ?? "";
      const rest = p.slice(folder.length);
      const cut = rest.indexOf("/");
      if (cut < 0) seen.set(rest, { name: rest, dir: false, path: p, churn: tree.churn[i] ?? 0, index: i, last: byName.get(rest) });
      else {
        const name = rest.slice(0, cut);
        if (!seen.has(`${name}/`)) seen.set(`${name}/`, { name, dir: true, path: `${folder}${name}/`, churn: dirs.get(`${folder}${name}/`)?.commits ?? 0, index: -1, last: byName.get(`${name}/`) });
      }
    }
  } else for (const e of last) seen.set(`${e.name}${e.dir ? "/" : ""}`, { name: e.name, dir: e.dir, path: `${folder}${e.name}${e.dir ? "/" : ""}`, churn: 0, index: -1, last: e });
  return [...seen.values()].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function Subject({ entry }: { entry: Entry }) {
  const { git, link, route } = useCode();
  const last = entry.last;
  if (!last) return <span />;
  const pr = pullOf(last.subject);
  const words = pr === null ? last.subject : last.subject.replace(new RegExp(`\\s*\\(#${pr}\\)\\s*$`), "");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <a href={`${git.github}/commit/${last.sha}`} target="_blank" rel="noopener noreferrer" title={`${last.subject} (on GitHub)`} className="min-w-0 truncate text-secondary no-underline hover:text-primary hover:underline">
        {words || "(no subject)"}
      </a>
      {pr !== null && (
        <A href={link({ ...route, screen: "pulls", pr })} className="mono flex-none rounded-sm px-1 text-xs text-tertiary no-underline hover:bg-hover hover:text-primary" title={`Pull request #${pr}`}>
          #{pr}
        </A>
      )}
    </span>
  );
}

function Listing({ folder, entries, loading }: { folder: string; entries: Entry[]; loading: boolean }) {
  const { open, href, tree } = useCode();
  const most = entries.reduce((m, e) => Math.max(m, e.churn), 0);
  if (loading)
    return (
      <div className="flex flex-col divide-y divide-separator overflow-hidden rounded-lg border border-line" role="status" aria-busy="true" aria-label="Loading the folder">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-9 items-center gap-3 px-3">
            <Skeleton height={14} width={14} radius={1} index={i} />
            <Skeleton height={12} width={`${18 + ((i * 23) % 20)}%`} radius={1} index={i} />
            <span className="flex-1" />
            <Skeleton height={12} width={`${20 + ((i * 31) % 25)}%`} radius={1} index={i} />
          </div>
        ))}
      </div>
    );
  return (
    <section aria-label={folder === "" ? "Files at the top of the repository" : `Files in ${folder}`} className="@container overflow-hidden rounded-lg border border-line">
      <ul className="m-0 list-none divide-y divide-separator p-0">
        {entries.map((e) => (
          <li key={e.path} className="row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-3 py-2 text-sm @lg:grid-cols-[minmax(9rem,16rem)_minmax(0,1fr)_auto_auto] @lg:py-1.5">
            <A
              href={href(e.path)}
              onClick={(ev) => {
                if (modified(ev)) return;
                ev.preventDefault();
                open(e.path);
              }}
              className="flex min-w-0 items-center gap-2 text-primary no-underline hover:underline"
            >
              {e.dir ? <Folder size={ICON.sm} className="flex-none text-secondary" aria-hidden /> : e.name.match(README) ? <BookOpen size={ICON.sm} className="flex-none text-secondary" aria-hidden /> : <FileCode size={ICON.sm} className="flex-none text-secondary" aria-hidden />}
              <span className="truncate type-id">{e.name}</span>
            </A>
            <span className="order-last col-span-2 min-w-0 type-micro @lg:order-none @lg:col-span-1 @lg:text-sm">
              <Subject entry={e} />
            </span>
            <span className="type-micro whitespace-nowrap tnum" title={e.last ? `Last changed ${date(e.last.at)}` : undefined}>
              {e.last ? date(e.last.at) : ""}
            </span>
            <span className="hidden @lg:flex">{tree ? <Heat level={heatOf(e.churn, most)} commits={e.churn} /> : <span className="w-4" />}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Readme({ folder }: { folder: string }) {
  const { git, tree, raw } = useCode();
  const index = useMemo(() => {
    if (!tree) return -1;
    const [lo, hi] = folder === "" ? [0, tree.paths.length] : rangeOf(tree.paths, folder);
    let found = -1;
    for (let i = lo; i < hi; i++) {
      const rest = (tree.paths[i] ?? "").slice(folder.length);
      if (!rest.includes("/") && README.test(rest) && (found < 0 || rest.toLowerCase() === "readme.md")) found = i;
    }
    return found;
  }, [tree, folder]);
  const path = index < 0 ? "" : (tree?.paths[index] ?? "");
  const text = useQuery({ ...textQuery(git, raw, path, index < 0 ? "" : (tree?.sha[index] ?? "")) });
  if (index < 0 || !tree) return null;
  const lang = tree.langs[tree.lang[index] ?? 0] ?? "text";
  return (
    <section aria-labelledby="code-readme" className="overflow-hidden rounded-lg border border-line">
      <h3 id="code-readme" className="m-0 flex h-10 items-center gap-2 border-b border-line bg-sunken px-3 text-sm font-medium">
        <FileText size={ICON.sm} className="text-secondary" aria-hidden />
        <span className="type-id">{path.slice(folder.length)}</span>
      </h3>
      <div className="px-5 py-5 md:px-8 md:py-6">
        {text.data === undefined ? (
          text.isError ? (
            <p className="m-0 type-caption">Its text could not be read.</p>
          ) : (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton height={24} width="40%" radius={1} />
              <Skeleton height={14} width="90%" radius={1} index={1} />
              <Skeleton height={14} width="75%" radius={1} index={2} />
            </div>
          )
        ) : lang === "markdown" || lang === "mdx" ? (
          <Prose text={text.data} from={path} />
        ) : (
          <pre className="m-0 type-code whitespace-pre-wrap">{text.data}</pre>
        )}
      </div>
    </section>
  );
}

/** A folder as the Code window lists it: each file and folder in it with the newest commit that touched it, when, and how often it changes; then its read-me as prose. */
export function FolderView({ folder }: { folder: string }) {
  const { git, tree } = useCode();
  const last = useQuery(lastQuery(git, folder));
  const entries = useMemo(() => entriesOf(tree, folder, last.data?.entries ?? []), [tree, folder, last.data]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-5">
        <Listing folder={folder} entries={entries} loading={entries.length === 0 && (last.isPending || (!tree && !last.isError))} />
        {entries.length === 0 && !last.isPending && <p className="m-0 type-caption">{last.isError ? "The newest commits in this folder could not be read." : "Nothing is in this folder at HEAD."}</p>}
        <p className="m-0 -mt-3 type-micro tnum">{entries.length > 0 ? `${many(entries.filter((e) => e.dir).length, "folder", "folders")} and ${many(entries.filter((e) => !e.dir).length, "file", "files")} here; dates are each one's newest commit.` : ""}</p>
        <Readme folder={folder} />
      </div>
    </div>
  );
}
