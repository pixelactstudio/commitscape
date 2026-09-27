import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { deleteMe } from "#/functions/account";
import { authClient, signIn } from "#/lib/auth-client";
import { meQuery } from "#/lib/queries";
import { Frame } from "#/components/Frame";

export const Route = createFileRoute("/me")({
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery()),
  head: () => ({ meta: [{ title: "Your repositories · commitscape" }] }),
  component: Me,
});

function Me() {
  const { data: mine } = useSuspenseQuery(meQuery());
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
  const count = mine?.installations.reduce((n, i) => n + i.repositories.length, 0) ?? 0;
  return (
    <Frame>
      <section className="repo-waiting me">
        <Heading level={1}>Your repositories</Heading>
        {done && <Banner status="success" title={done} />}
        {remove.error && <Banner status="error" title={remove.error.message} />}
        {!mine && !done && (
          <>
            <p>Sign in with GitHub to see the repositories you let commitscape read.</p>
            <Button label="Sign in with GitHub" variant="primary" onClick={() => signIn()} />
          </>
        )}
        {mine && (
          <>
            <p className="note">
              Signed in as <strong>{mine.user.login}</strong>. These are the repositories you let commitscape's GitHub App read,
              which can only read. Each one's Report is shown only to people GitHub shows it to, checked on every visit.
            </p>
            <div className="actions">
              {mine.install && <Button label="Add repositories" variant="primary" size="sm" href={mine.install} />}
              <Button label="Sign out" variant="secondary" size="sm" onClick={() => signOut.mutate()} isDisabled={signOut.isPending} />
            </div>
            {count === 0 && <p>None yet: add some through the GitHub App.</p>}
            {mine.installations.map((i) => (
              <Card key={i.id} padding={4} className="figure">
                <Heading level={2} className="figure-title">
                  {i.account}
                </Heading>
                <ul className="facts">
                  {i.repositories.map((r) => (
                    <li key={r.name}>
                      <a href={`/gh/${r.name}`}>{r.name}</a> {r.private && <Badge label="private" variant="neutral" />}{" "}
                      {r.description && <span className="note">{r.description}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            <Card padding={4} className="figure danger-zone">
              <Heading level={2} className="figure-title">
                Delete my data
              </Heading>
              <p className="note">
                Removes your account, every session, and the Reports of the repositories you connected, at once. Removing the
                App on GitHub deletes those Reports too.
              </p>
              <Button
                label="Delete my data"
                variant="destructive"
                size="sm"
                isDisabled={remove.isPending}
                onClick={() => {
                  if (window.confirm("Delete your account, sessions and the Reports you connected?")) remove.mutate();
                }}
              />
            </Card>
          </>
        )}
      </section>
    </Frame>
  );
}
