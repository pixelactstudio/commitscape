import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Switch } from "@astryxdesign/core/Switch";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Face } from "@commitscape/ui";
import { deleteMe } from "#/functions/account";
import { saveMyChoices } from "#/functions/standings";
import { authClient, signIn } from "#/lib/auth-client";
import { choicesQuery, meQuery, myRacesQuery, rivalGapsQuery, rivalsQuery } from "#/lib/queries";
import { Section } from "#/components/Boundary";
import { setMyRival } from "#/functions/versus";

export const Route = createFileRoute("/me")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(meQuery()), context.queryClient.ensureQueryData(choicesQuery())]),
  head: () => ({ meta: [{ title: "Settings · commitscape" }] }),
  component: Me,
});

function Me() {
  const { data: mine } = useSuspenseQuery(meQuery());
  const { data: choices } = useSuspenseQuery(choicesQuery());
  const router = useRouter();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const after = async (words: string) => {
    setDone(words);
    queryClient.removeQueries();
    await router.invalidate();
  };
  const signOut = useMutation({ mutationFn: () => authClient.signOut(), onSuccess: () => after("Signed out.") });
  const remove = useMutation({ mutationFn: () => deleteMe(), onSuccess: () => after("Your data is deleted.") });
  const choose = useMutation({
    mutationFn: (change: { hidden?: boolean; namePrivate?: boolean }) => saveMyChoices({ data: change }),
    onSuccess: (next) => {
      queryClient.setQueryData(choicesQuery().queryKey, next);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "choices" });
    },
  });
  const count = mine?.installations.reduce((n, i) => n + i.repositories.length, 0) ?? 0;
  return (
    <section className="settings">
      <Heading level={1}>Settings</Heading>
      {done && <Banner status="success" title={done} />}
      {(remove.error || choose.error) && <Banner status="error" title={(remove.error ?? choose.error)?.message ?? ""} />}
      {!mine && !done && (
        <Card padding={5} className="figure">
          <p>Sign in with GitHub to see your own Profile with your private work, choose what others see, and connect private repositories.</p>
          <Button label="Sign in with GitHub" variant="primary" onClick={() => signIn("/me")} />
        </Card>
      )}
      {mine && (
        <>
          <Card padding={4} className="figure settings-who">
            <Face login={mine.user.login} name={mine.user.name ?? mine.user.login} size={48} />
            <div className="min-w-0 flex-1">
              <strong>{mine.user.name ?? mine.user.login}</strong>
              <div className="note small">Signed in with GitHub as @{mine.user.login}</div>
            </div>
            <Button label="Your Profile" variant="primary" size="sm" href={`/u/${mine.user.login}`} />
            <Button label="Sign out" variant="secondary" size="sm" onClick={() => signOut.mutate()} isDisabled={signOut.isPending} />
          </Card>

          <Card padding={4} className="figure">
            <Heading level={2} className="figure-title">
              What others see
            </Heading>
            <div className="settings-switches">
              <Switch
                label="Stay out of comparisons"
                description="You appear in no one else's Standings, Versus, Leaderboards, Races or Crews, and your Profile says only that it is hidden. You still see your own."
                value={choices?.hidden ?? false}
                isDisabled={choose.isPending}
                onChange={(hidden) => choose.mutate({ hidden })}
              />
              <Switch
                label="Name my private work on my Profile"
                description="Off, your private work counts in your totals and is never named. On, the repositories your own sign-in can see are listed on your Profile for everyone."
                value={choices?.namePrivate ?? false}
                isDisabled={choose.isPending}
                onChange={(namePrivate) => choose.mutate({ namePrivate })}
              />
            </div>
          </Card>

          <Section fallback={null}>
            <RivalList />
          </Section>

          <Section fallback={null}>
            <Competing />
          </Section>

          <Card padding={4} className="figure">
            <Heading level={2} className="figure-title">
              Connected repositories
            </Heading>
            <p className="note">
              Private repositories you let commitscape's GitHub App read, which can only read. Each one's Report and Standings are shown only to people GitHub shows it to,
              checked on every visit.
            </p>
            <div className="actions">{mine.install && <Button label="Add repositories" variant="secondary" size="sm" href={mine.install} />}</div>
            {mine.tokenLost && <Banner status="warning" title="GitHub no longer accepts this sign-in for reading your repositories. Sign out and in again to see them." />}
            {count === 0 && !mine.tokenLost && <p className="note">None yet.</p>}
            {mine.installations.map((i) => (
              <div key={i.id}>
                <Heading level={3} className="figure-title">
                  {i.account}
                </Heading>
                <ul className="facts">
                  {i.repositories.map((r) => (
                    <li key={r.name}>
                      <a href={`/gh/${r.name}`}>{r.name}</a> {r.private && <Badge label="private" variant="neutral" />} {r.description && <span className="note">{r.description}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>

          <Card padding={4} className="figure danger-zone">
            <Heading level={2} className="figure-title">
              Delete my data
            </Heading>
            <p className="note">
              Removes your account, every session, your choices (so you are no longer hidden), your own copy of your Profile, and the Reports of the repositories you connected, at once. Removing the App on
              GitHub deletes those Reports too.
            </p>
            <Button
              label="Delete my data"
              variant="destructive"
              size="sm"
              isDisabled={remove.isPending}
              onClick={() => {
                if (window.confirm("Delete your account, sessions, choices and the Reports you connected?")) remove.mutate();
              }}
            />
          </Card>
        </>
      )}
    </section>
  );
}

function RivalList() {
  const queryClient = useQueryClient();
  const { data: mine } = useSuspenseQuery(rivalsQuery());
  const remove = useMutation({
    mutationFn: (login: string) => setMyRival({ data: { login, on: false } }),
    onSuccess: (next) => {
      queryClient.setQueryData(rivalsQuery().queryKey, (old) => (old ? { ...old, logins: next.logins } : old));
      void queryClient.invalidateQueries({ queryKey: rivalGapsQuery().queryKey });
    },
  });
  if (!mine) return null;
  return (
    <Card padding={4} className="figure">
      <Heading level={2} className="figure-title">
        Rivals
      </Heading>
      <p className="note">The people your Profile measures you against, up to five. Add one with "Make my Rival" on their Profile; they are not told.</p>
      {mine.logins.length === 0 && <p className="note">None yet.</p>}
      <ul className="facts">
        {mine.logins.map((l) => (
          <li key={l} className="flex items-center gap-3">
            <Face login={l} name={l} size={24} />
            <a href={`/u/${l}`}>@{l}</a>
            <a href={`/vs/${mine.login}/${l}`}>versus</a>
            <Button label="Remove" variant="ghost" size="sm" isDisabled={remove.isPending} onClick={() => remove.mutate(l)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Competing() {
  const { data: mine } = useSuspenseQuery(myRacesQuery());
  if (!mine) return null;
  return (
    <Card padding={4} className="figure">
      <Heading level={2} className="figure-title">
        Races and Crews
      </Heading>
      {mine.invitations.length > 0 && (
        <p>
          {mine.invitations.length === 1 ? "An invitation is" : `${mine.invitations.length} invitations are`} waiting:{" "}
          {mine.invitations.map((i, n) => (
            <span key={i.id}>
              {n > 0 && ", "}
              <a href={`/${i.kind === "race" ? "races" : "crews"}/${i.id}`}>{i.name}</a> from @{i.invitedBy}
            </span>
          ))}
          .
        </p>
      )}
      <p className="note">
        In {mine.races.length === 1 ? "1 Race" : `${mine.races.length} Races`} and {mine.crews.length === 1 ? "1 Crew" : `${mine.crews.length} Crews`}. <a href="/races">Races</a> · <a href="/crews">Crews</a>
      </p>
    </Card>
  );
}
