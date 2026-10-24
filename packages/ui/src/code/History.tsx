import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CODE_LOG_PAGE, type CodeCommit, type CodePull, type CodeStory } from "@commitscape/data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { A } from "../kit/A";
import { compact, date, grouped, many } from "../format";
import { useCode } from "./context";
import { logQuery } from "./data";

const KINDS = ["feature", "fix", "docs", "refactor", "test", "performance", "style", "build", "chore", "revert"];

const STATE_DOT: Record<string, string> = { merged: "bg-(--s6)", open: "bg-added-solid", closed: "bg-removed-solid" };

function Years({ story }: { story: CodeStory }) {
  if (story.years.length === 0) return null;
  const most = Math.max(1, ...story.years.map((y) => y.commits));
  const lines = story.years.some((y) => y.added !== null);
  return (
    <section aria-labelledby="code-years" className="flex flex-col gap-2">
      <h3 id="code-years" className="m-0 type-label">
        Year by year
      </h3>
      <table className="w-full border-collapse text-sm tnum">
        <caption className="sr-only">Commits that touched it each year{lines ? ", and the lines they added and removed there" : ""}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Commits</th>
            {lines && <th scope="col">Lines added and removed</th>}
          </tr>
        </thead>
        <tbody>
          {[...story.years].reverse().map((y) => (
            <tr key={y.year} className="h-7">
              <th scope="row" className="w-12 pe-3 text-start font-normal text-secondary">
                {y.year}
              </th>
              <td className="w-full pe-3">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (y.commits * 100) / most)}%` }} aria-hidden />
              </td>
              <td className="pe-3 text-end text-xs whitespace-nowrap text-secondary">{many(y.commits, "commit", "commits")}</td>
              {lines && (
                <td className="text-end text-xs whitespace-nowrap">
                  <span className="text-added">+{compact(y.added ?? 0)}</span> <span className="text-removed">−{compact(y.removed ?? 0)}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Paths({ story }: { story: CodeStory }) {
  if (story.paths.length === 0) return null;
  return (
    <section aria-labelledby="code-paths" className="flex flex-col gap-2">
      <h3 id="code-paths" className="m-0 type-label">
        Other paths it had
      </h3>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {story.paths.map((p) => (
          <li key={p} className="mono rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-xs break-all text-secondary">
            {p}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PullTag({ pull }: { pull: CodePull }) {
  const { route, link } = useCode();
  const state = pull.state ?? "unknown";
  return (
    <A
      href={link({ ...route, screen: "pulls", pr: pull.number })}
      title={pull.title ? `#${pull.number} ${pull.title} (${state})` : `Pull request #${pull.number}`}
      className="inline-flex h-5 flex-none items-center gap-1 rounded-full border border-line px-1.5 text-xs text-secondary no-underline hover:border-line-strong hover:text-primary"
    >
      {pull.state && <span className={`size-1.5 rounded-full ${STATE_DOT[pull.state] ?? "bg-other"}`} aria-hidden />}
      <span className="mono">#{pull.number}</span>
      {pull.state && <span className="sr-only">, {pull.state}</span>}
    </A>
  );
}

function Row({ c }: { c: CodeCommit }) {
  const { git } = useCode();
  const login = useLogin(c.person);
  const kind = c.kind >= 0 && c.kind < KINDS.length ? KINDS[c.kind] : null;
  const subject = c.pull ? c.subject.replace(new RegExp(`\\s*\\(#${c.pull.number}\\)\\s*$`), "") : c.subject;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5">
      <span className="pt-0.5">
        <Face login={login} name={c.person?.name ?? "someone unknown"} size={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-primary" title={c.subject}>
            {subject || "(no subject)"}
          </span>
          {c.pull && <PullTag pull={c.pull} />}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 type-micro">
          <span className="max-w-48 truncate">{c.person?.name ?? "someone unknown"}</span>
          <span aria-hidden>·</span>
          <span className="tnum">{date(c.at + c.offset * 60)}</span>
          <span aria-hidden>·</span>
          <a href={`${git.github}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="mono text-secondary no-underline hover:text-primary hover:underline" title="Open the commit on GitHub">
            {c.sha.slice(0, 7)}
          </a>
          {kind && <span className="rounded-xs bg-sunken px-1 text-tertiary">{kind}</span>}
          {c.bulk && (
            <span className="rounded-xs bg-sunken px-1 text-tertiary" title="A Bulk Commit: it touched too many files to count toward Churn and Ownership">
              bulk
            </span>
          )}
        </span>
      </div>
      {c.added !== null && (
        <span className="pt-0.5 text-end text-xs whitespace-nowrap tnum" title="Lines it added and removed here">
          <span className="text-added">+{grouped(c.added)}</span> <span className="text-removed">−{grouped(c.removed ?? 0)}</span>
        </span>
      )}
    </li>
  );
}

function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="m-0 list-none divide-y divide-separator p-0" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5">
          <Skeleton height={20} width={20} radius="rounded" index={i} />
          <span className="flex flex-col gap-1.5 pt-0.5">
            <Skeleton height={13} width={`${40 + ((i * 29) % 45)}%`} radius={1} index={i} />
            <Skeleton height={10} width="30%" radius={1} index={i} />
          </span>
          <Skeleton height={12} width={56} radius={1} index={i} />
        </li>
      ))}
    </ul>
  );
}

/** Every commit that touched a file or folder, newest first and paged, with its pull request and its lines there; above them its years and the paths it had. */
export function History({ story, path }: { story: CodeStory | undefined; path: string }) {
  const { git } = useCode();
  const log = useInfiniteQuery(logQuery(git, path));
  const commits = log.data?.pages.flatMap((p) => p.commits) ?? [];
  const total = log.data?.pages[0]?.total ?? story?.commits ?? 0;
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto grid max-w-5xl gap-6 p-4 @md:p-5 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="code-commits" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="code-commits" className="m-0 type-label">
              Commits
            </h3>
            <p className="m-0 type-micro tnum" aria-live="polite">
              {log.data ? `${grouped(commits.length)} of ${many(total, "commit", "commits")}, newest first, merges left out` : " "}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            {log.isError ? (
              <p className="m-0 px-4 py-6 text-center type-caption">The commits that touched it could not be read.</p>
            ) : !log.data ? (
              <RowsSkeleton />
            ) : commits.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center type-caption">No commit in the history read touched it.</p>
            ) : (
              <ol className="m-0 list-none divide-y divide-separator p-0">
                {commits.map((c) => (
                  <Row key={c.sha} c={c} />
                ))}
              </ol>
            )}
          </div>
          {log.hasNextPage && (
            <div className="flex justify-center pt-1">
              <Button label={`Show ${Math.min(CODE_LOG_PAGE, total - commits.length)} more`} variant="secondary" size="sm" isLoading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()} />
            </div>
          )}
        </section>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Its years and paths">
          {story ? (
            <>
              <Years story={story} />
              <Paths story={story} />
            </>
          ) : (
            <Skeleton height={160} />
          )}
        </aside>
      </div>
    </div>
  );
}
