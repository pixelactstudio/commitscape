import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitMerge } from "lucide-react";
import { compact, day as dayName, Face, grouped, ICON, many, PullChip } from "@commitscape/ui";
import { dayCommitsQuery } from "#/lib/queries";

const hhmm = (at: number, offset: number) => {
  const local = (((at + offset * 60) % 86_400) + 86_400) % 86_400;
  return `${String(Math.floor(local / 3600)).padStart(2, "0")}:${String(Math.floor((local % 3600) / 60)).padStart(2, "0")}`;
};

/** A person's commits on one day of their calendar, from the repositories the Site has read, in a dialog the address can open. */
export function DayCommits({ login, day, contributions, onClose }: { login: string; day: number; contributions: number | null; onClose: () => void }) {
  const { data, error } = useQuery(dayCommitsQuery(login, day));
  const close = (open: boolean) => !open && onClose();
  return (
    <Dialog isOpen onOpenChange={close} width="min(680px, 96vw)" maxHeight="88dvh" padding={0}>
      <div className="px-5 pt-5">
        <DialogHeader
          title={dayName(day)}
          subtitle={
            data
              ? `Commits by their own clock, in the ${many(data.read, "public repository", "public repositories")} of theirs commitscape has read`
              : "Commits by their own clock, in the repositories commitscape has read"
          }
          onOpenChange={close}
        />
      </div>
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        {error ? (
          <p className="m-0 type-description">{error.message}</p>
        ) : !data ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
            <Skeleton height={16} width={260} radius={1} />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} height={40} index={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-stat">{grouped(data.total)}</span>
              <span className="type-label">{data.total === 1 ? "commit" : "commits"}</span>
              <span className="type-caption">
                in {many(data.repos.length, "repository", "repositories")}
                {data.total > data.shown ? `; the newest ${grouped(data.shown)} listed` : ""}
              </span>
            </div>
            {contributions !== null && (
              <p className="m-0 rounded-md bg-sunken px-3 py-2.5 type-description">
                GitHub counts {many(contributions, "contribution", "contributions")} that day: its count also holds pull requests, reviews and issues, commits in repositories commitscape has not read, and private ones.
                Only the commits commitscape has read are listed here.
              </p>
            )}
            {data.repos.length === 0 ? (
              <p className="m-0 py-6 text-center type-caption">No commits of theirs that day in the repositories commitscape has read.</p>
            ) : (
              data.repos.map((r) => (
                <section key={`${r.owner}/${r.name}`} className="flex flex-col overflow-hidden surface">
                  <div className="flex items-center gap-2.5 border-b border-separator bg-sunken px-3 py-2">
                    <Face login={r.owner} name={r.owner} size={20} shape="rounded" />
                    <a
                      href={`/gh/${r.owner}/${r.name}?screen=commits&who=${r.personId}&since=${day}&until=${day}`}
                      className="min-w-0 flex-1 truncate type-ui font-medium text-primary no-underline hover:underline hover:underline-offset-4"
                    >
                      <span className="text-secondary">{r.owner}/</span>
                      {r.name}
                    </a>
                    <span className="flex-none type-caption tnum">{many(r.commits.length, "commit", "commits")}</span>
                  </div>
                  <ol className="m-0 list-none p-0">
                    {r.commits.map((c) => (
                      <li key={c.sha} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-separator px-3 py-2 type-ui last:border-b-0">
                        <span className="type-caption tnum">{hhmm(c.at, c.offset)}</span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {c.merge && <GitMerge size={ICON.sm} className="flex-none text-secondary" aria-label="merge" />}
                          <span className="truncate" title={c.subject}>
                            {c.subject || "(no subject)"}
                          </span>
                          <PullChip subject={c.subject} github={`https://github.com/${r.owner}/${r.name}`} />
                        </span>
                        <span className="flex flex-none items-center gap-3">
                          {c.added !== null && (
                            <span className="hidden type-caption tnum sm:inline">
                              <span className="text-added">+{compact(c.added)}</span> <span className="text-removed">−{compact(c.removed ?? 0)}</span>
                            </span>
                          )}
                          <a
                            href={`https://github.com/${r.owner}/${r.name}/commit/${c.sha}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Open on GitHub"
                            className="mono inline-flex items-center gap-1 type-caption text-secondary no-underline hover:text-primary hover:underline hover:underline-offset-4"
                          >
                            {c.sha.slice(0, 7)}
                            <ExternalLink size={ICON.xs} aria-hidden />
                          </a>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
