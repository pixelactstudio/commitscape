import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, EyeOff, Minus, Swords, UserCheck, UserPlus } from "lucide-react";
import { Face, grouped, Panel } from "@commitscape/ui";
import { setMyRival } from "#/functions/versus";
import { rivalGapsQuery, rivalsQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

/** The Rival button on someone else's Profile, for a signed-in viewer: makes them a Rival, or stops. */
export function RivalActions({ login }: { login: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: mine } = useSuspenseQuery(rivalsQuery());
  const toggle = useMutation({
    mutationFn: (on: boolean) => setMyRival({ data: { login, on } }),
    onSuccess: (next, on) => {
      queryClient.setQueryData(rivalsQuery().queryKey, (old) => (old ? { ...old, logins: next.logins } : old));
      void queryClient.invalidateQueries({ queryKey: rivalGapsQuery().queryKey });
      toast(on ? `@${login} is your Rival. Your Profile shows the gap; they are not told.` : `@${login} is no longer your Rival`);
    },
    onError: (e) => toast(e.message, "error"),
  });
  if (!mine || mine.login.toLowerCase() === login.toLowerCase()) return null;
  const on = mine.logins.includes(login.toLowerCase());
  return (
    <Button
      label={on ? "Your Rival" : "Make my Rival"}
      variant="secondary"
      icon={<Icon icon={on ? UserCheck : UserPlus} size="sm" />}
      aria-pressed={on}
      tooltip={on ? "Stop measuring yourself against them" : "Measure yourself against them on your Profile; they are not told"}
      isLoading={toggle.isPending}
      onClick={() => toggle.mutate(!on)}
    />
  );
}

/** How far the signed-in person is from each Rival, on their own Profile. */
export function RivalGaps() {
  const { data: gaps } = useSuspenseQuery(rivalGapsQuery());
  const { data: mine } = useSuspenseQuery(rivalsQuery());
  if (gaps.length === 0) return null;
  return (
    <Panel padding={0} title="Your Rivals" description="This month on GitHub's calendar, and lines that still run over all time. Rivals see nothing of this.">
      <ul className="m-0 mt-1 flex list-none flex-col p-0">
        {gaps.map((r) => (
          <li key={r.login} className="flex flex-col gap-3 border-t border-line px-5 py-3.5 md:flex-row md:items-center">
            <Link to="/u/$login" params={{ login: r.login }} className="flex min-w-0 items-center gap-3 text-primary no-underline hover:underline md:w-56 md:flex-none">
              <Face login={r.login} name={r.login} size={32} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{"hidden" in r ? `@${r.login}` : (r.name ?? r.login)}</span>
                {!("hidden" in r) && r.name && <span className="truncate text-xs text-secondary">@{r.login}</span>}
              </span>
            </Link>
            {"hidden" in r ? (
              <span className="inline-flex items-center gap-1.5 type-description">
                <EyeOff size={14} aria-hidden /> has chosen to stay out of comparisons
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 flex-wrap gap-2">
                {r.gaps.map((g) => {
                  const d = g.mine - g.theirs;
                  const Glyph = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
                  return (
                    <span key={g.label} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 h-6 text-xs ${d > 0 ? "border-added/35 text-added" : d < 0 ? "border-removed/35 text-removed" : "border-line text-secondary"}`}>
                      <Glyph size={12} aria-hidden />
                      <span className="text-primary">{d === 0 ? `level on ${g.label}` : <><span className="font-semibold tnum">{grouped(Math.abs(d))}</span> {d > 0 ? "ahead" : "behind"} on {g.label}</>}</span>
                    </span>
                  );
                })}
              </span>
            )}
            {mine && <Button label="Versus" variant="ghost" size="sm" icon={<Icon icon={Swords} size="sm" />} href={`/vs/${mine.login}/${r.login}`} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
