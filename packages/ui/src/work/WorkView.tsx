import { Badge } from "@astryxdesign/core/Badge";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { groupWork, monthName, workTotals, type Work } from "@commitscape/data";
import { Tile } from "../components/Tile";
import { Face } from "../components/Face";
import { compact, grouped, many } from "../format";

/** A Proof of Work: its numbers, then every merged pull request and commit by month and repository, with links. */
export function WorkView({ work, chosen, onChoose }: { work: Work; chosen?: Set<string>; onChoose?: (repo: string, on: boolean) => void }) {
  const t = workTotals(work.items);
  const months = groupWork(work.items);
  return (
    <div className="flex flex-col gap-5">
      <section className="tiles profile-tiles">
        <Tile value={grouped(t.prs)} label="pull requests merged" note={`from ${work.from} to ${work.to}`} />
        <Tile value={grouped(t.commits)} label="commits" note="squash-merge commits counted once" />
        <Tile value={`+${compact(t.additions)}`} label="lines added, merged" note={`and −${compact(t.deletions)} removed, in those pull requests`} />
        <Tile value={grouped(t.repositories)} label={t.repositories === 1 ? "repository" : "repositories"} note={work.filter ? `in ${work.filter}` : "everywhere on GitHub"} />
      </section>
      {work.truncated && <p className="note small">GitHub returns at most 1,000 pull requests and 1,000 commits for one search; narrow the period to see everything.</p>}
      {months.length === 0 && <p className="note">Nothing merged or committed in this period{work.scope === "public" ? " in public repositories" : ""}.</p>}
      {months.map((m) => (
        <section key={m.month} className="work-month">
          <h2 className="work-month-title">{monthName(m.month)}</h2>
          {m.repositories.map((r) => {
            const prs = r.items.filter((i) => i.kind === "pr");
            const commits = r.items.length - prs.length;
            return (
              <div key={r.repo} className="work-repo">
                <div className="work-repo-head">
                  <Face login={r.repo.split("/")[0]} name={r.repo} size={24} />
                  <a href={`https://github.com/${r.repo}`} className="work-repo-name">
                    {r.repo}
                  </a>
                  {r.private && <Badge label={chosen ? "private" : "private: only you see this"} variant="neutral" />}
                  <span className="note small">{[prs.length > 0 && many(prs.length, "pull request", "pull requests"), commits > 0 && many(commits, "commit", "commits")].filter(Boolean).join(" · ")}</span>
                  {r.private && chosen && onChoose && <CheckboxInput label="Include in the shared link" value={chosen.has(r.repo)} onChange={(on) => onChoose(r.repo, on)} />}
                </div>
                <ul className="work-items">
                  {r.items.map((i) => (
                    <li key={i.url}>
                      {i.kind === "pr" ? <span className="work-tag">#{i.number}</span> : <code className="work-tag">{(i.sha ?? "").slice(0, 7)}</code>}
                      <a href={i.url}>{i.title}</a>
                      <span className="note small work-when">{i.at.slice(0, 10)}</span>
                      {i.kind === "pr" && (
                        <span className="num small">
                          <span className="added">+{compact(i.additions ?? 0)}</span> <span className="removed">−{compact(i.deletions ?? 0)}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
