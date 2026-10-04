import { Button } from "@astryxdesign/core/Button";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Face, Figure, grouped } from "@commitscape/ui";
import { setMyRival } from "#/functions/versus";
import { rivalGapsQuery, rivalsQuery } from "#/lib/queries";

/** Compare and Rival buttons on someone else's Profile, for a signed-in viewer. */
export function RivalActions({ login }: { login: string }) {
  const queryClient = useQueryClient();
  const { data: mine } = useSuspenseQuery(rivalsQuery());
  const toggle = useMutation({
    mutationFn: (on: boolean) => setMyRival({ data: { login, on } }),
    onSuccess: (next) => {
      queryClient.setQueryData(rivalsQuery().queryKey, (old) => (old ? { ...old, logins: next.logins } : old));
      void queryClient.invalidateQueries({ queryKey: rivalGapsQuery().queryKey });
    },
  });
  if (!mine || mine.login.toLowerCase() === login.toLowerCase()) return null;
  const on = mine.logins.includes(login.toLowerCase());
  return (
    <>
      <Button label="Compare with me" variant="secondary" size="sm" href={`/vs/${mine.login}/${login}`} />
      <Button label={on ? "Your Rival" : "Make my Rival"} variant={on ? "primary" : "ghost"} size="sm" aria-pressed={on} isDisabled={toggle.isPending} onClick={() => toggle.mutate(!on)} />
    </>
  );
}

/** How far the signed-in person is from each Rival, on their own Profile. */
export function RivalGaps() {
  const { data: gaps } = useSuspenseQuery(rivalGapsQuery());
  if (gaps.length === 0) return null;
  return (
    <Figure title="Your Rivals" note="This month on GitHub's calendar, and lines that still run over all time. Rivals see nothing of this.">
      <ul className="rivals">
        {gaps.map((r) => (
          <li key={r.login}>
            <Face login={r.login} name={r.login} size={32} />
            <a href={`/u/${r.login}`} className="rival-name">
              {"hidden" in r ? `@${r.login}` : (r.name ?? r.login)}
            </a>
            {"hidden" in r ? (
              <span className="note small">has chosen to stay out of comparisons</span>
            ) : (
              <span className="rival-gaps">
                {r.gaps.map((g) => {
                  const d = g.mine - g.theirs;
                  return (
                    <span key={g.label} className={d >= 0 ? "gap-ahead" : "gap-behind"}>
                      {d === 0 ? `level on ${g.label}` : `${grouped(Math.abs(d))} ${d > 0 ? "ahead" : "behind"} on ${g.label}`}
                    </span>
                  );
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Figure>
  );
}
