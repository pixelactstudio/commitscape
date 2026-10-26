import { useState, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Switch } from "@astryxdesign/core/Switch";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Briefcase, FolderGit2, Image as ImageIcon, Lock, LogOut, Plus, Trash2, User } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Face, Page, PageHead, Panel } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { deleteMe } from "#/functions/account";
import { saveMyChoices } from "#/functions/standings";
import { signOut as endSession } from "#/lib/auth-client";
import { forgetViewer } from "#/lib/viewer";
import { choicesQuery, meQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/me")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(meQuery()), context.queryClient.ensureQueryData(choicesQuery())]),
  head: () => ({ meta: [{ title: `Settings · ${PRODUCT}` }] }),
  component: Me,
});

const SECTIONS = [
  ["profile", "Profile"],
  ["privacy", "Privacy"],
  ["repositories", "Connected repositories"],
  ["danger", "Delete my data"],
] as const;

function Me() {
  const { data: mine } = useSuspenseQuery(meQuery());
  const router = useRouter();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const after = async (words: string) => {
    setDone(words);
    forgetViewer();
    queryClient.removeQueries();
    await router.invalidate();
  };
  const signOut = useMutation({ mutationFn: () => endSession(), onSuccess: () => after("Signed out.") });
  return (
    <Page className="pb-16">
      <PageHead title="Settings" description={mine ? (mine.user.login ? `Signed in with GitHub as @${mine.user.login}. Every choice here takes effect at once.` : "Signed in with GitHub. Every choice here takes effect at once.") : "What others see of you, and the repositories you let us read."} />
      {done && (
        <div className="pb-4">
          <Banner status="success" title={done} />
        </div>
      )}
      {!mine ? null : (
        <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-[calc(var(--chrome-top)+1.5rem)] lg:flex lg:flex-col lg:gap-0.5">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={`row-hover rounded-md px-3 py-1.5 type-ui no-underline ${id === "danger" ? "text-removed" : "text-secondary hover:text-primary"}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="flex min-w-0 flex-col gap-gutter">
            <Panel id="profile" title="Profile" description="Who you are signed in as.">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {mine.user.login ? <Face login={mine.user.login} name={mine.user.name ?? mine.user.login} size={60} /> : <Avatar src={mine.user.avatar ?? undefined} name={mine.user.name ?? ""} size="lg" />}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate type-panel">{mine.user.name ?? mine.user.login ?? "Signed in"}</span>
                    {mine.user.login ? <span className="type-caption">@{mine.user.login} on GitHub</span> : <span className="type-caption">GitHub has not told us your username yet.</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mine.user.login && (
                    <>
                      <Button label="Your Profile" variant="secondary" icon={<Icon icon={User} size="sm" />} href={`/u/${mine.user.login}`} />
                      <Button label="Your Cards" variant="secondary" icon={<Icon icon={ImageIcon} size="sm" />} href={`/u/${mine.user.login}/cards`} />
                      <Button label="Proof of Work" variant="secondary" icon={<Icon icon={Briefcase} size="sm" />} href={`/u/${mine.user.login}/work`} />
                    </>
                  )}
                  <Button label="Sign out" variant="ghost" icon={<Icon icon={LogOut} size="sm" />} onClick={() => signOut.mutate()} isLoading={signOut.isPending} />
                </div>
              </div>
            </Panel>
            <Choices />
            <Repositories installations={mine.installations} install={mine.install} tokenLost={mine.tokenLost} />
            <Danger onDone={() => void after("Your data is deleted. Everything listed is gone, and you are signed out.")} />
          </div>
        </div>
      )}
    </Page>
  );
}

function Choices() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: choices } = useSuspenseQuery(choicesQuery());
  const choose = useMutation({
    mutationFn: (change: { hidden?: boolean; namePrivate?: boolean }) => saveMyChoices({ data: change }),
    onSuccess: (next) => {
      queryClient.setQueryData(choicesQuery().queryKey, next);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "choices" });
      toast("Saved");
    },
  });
  return (
    <Panel id="privacy" title="Privacy" description="What others see of you. Both take effect at once.">
      {choose.error && <Banner status="error" title={choose.error.message} />}
      <div className="flex flex-col">
        <div className="pb-4">
          <Switch
            label="Stay out of comparisons"
            description="You appear in no one else’s Standings or Versus, and your Profile says only that it is hidden. You still see your own."
            value={choices?.hidden ?? false}
            isDisabled={choose.isPending}
            onChange={(hidden) => choose.mutate({ hidden })}
            labelPosition="start"
            labelSpacing="spread"
            width="100%"
          />
        </div>
        <div className="border-t border-line pt-4">
          <Switch
            label="Name my private work on my Profile"
            description="Off, your private work counts in your totals and is never named. On, the repositories your own sign-in can see are listed on your Profile for everyone."
            value={choices?.namePrivate ?? false}
            isDisabled={choose.isPending}
            onChange={(namePrivate) => choose.mutate({ namePrivate })}
            labelPosition="start"
            labelSpacing="spread"
            width="100%"
          />
        </div>
      </div>
    </Panel>
  );
}

type Installation = { id: number; account: string; repositories: { name: string; private: boolean; description: string | null }[] };

function Repositories({ installations, install, tokenLost }: { installations: Installation[]; install: string | null; tokenLost: boolean }) {
  const count = installations.reduce((n, i) => n + i.repositories.length, 0);
  return (
    <Panel
      id="repositories"
      title="Connected repositories"
      description="Private repositories you let commitscape’s GitHub App read, which can only read. Each one’s Report and Standings show only to people GitHub shows it to, checked on every visit."
      actions={install ? <Button label="Add repositories" variant="secondary" size="sm" icon={<Icon icon={Plus} size="sm" />} href={install} target="_blank" /> : undefined}
    >
      {tokenLost && <Banner status="warning" title="GitHub no longer accepts this sign-in for reading your repositories. Sign out and in again to see them." />}
      {count === 0 && !tokenLost && <NoneYet icon={FolderGit2} words="None yet. Choose repositories in the GitHub App to see their Reports here." />}
      {installations.map((i) => (
        <div key={i.id} className="flex flex-col gap-2">
          <span className="flex items-center gap-2 type-caption font-medium">
            <Face login={i.account} name={i.account} size={16} shape="rounded" />
            {i.account}
          </span>
          <List>
            {i.repositories.map((r) => {
              const [owner = "", name = r.name] = r.name.split("/");
              return (
                <li key={r.name} className="border-t border-line first:border-t-0">
                  <Link to="/gh/$owner/$repo" params={{ owner, repo: name }} className="flex items-center gap-3 py-2.5 text-primary no-underline hover:underline">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-label">
                        <span className="font-normal text-secondary">{owner}/</span>
                        {name}
                      </span>
                      {r.description && <span className="truncate type-caption">{r.description}</span>}
                    </span>
                    {r.private && <Badge label="private" icon={<Lock size={ICON.xs} aria-hidden />} variant="neutral" />}
                  </Link>
                </li>
              );
            })}
          </List>
        </div>
      ))}
    </Panel>
  );
}

function Danger({ onDone }: { onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteMe(),
    onSuccess: () => {
      setAsking(false);
      onDone();
    },
  });
  return (
    <section id="danger" className="surface scroll-mt-(--chrome-top) border-removed/45! p-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 max-w-2xl flex-col gap-1">
          <h2 className="m-0 type-panel text-removed">Delete my data</h2>
          <p className="m-0 type-description">
            Removes your account, every session, your choices (so you are no longer hidden), your own copy of your Profile, and the Reports of the repositories you connected, at once. Removing the App on GitHub deletes those Reports too.
          </p>
        </div>
        <div className="flex-none">
          <Button label="Delete my data" variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => setAsking(true)} />
        </div>
      </div>
      <AlertDialog
        isOpen={asking}
        onOpenChange={setAsking}
        title="Delete your data?"
        description={remove.error ? remove.error.message : "Your account, sessions, choices, your own copy of your Profile and the Reports you connected are deleted now. This cannot be undone; signing in again starts afresh."}
        actionLabel="Delete everything"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate()}
        width={440}
      />
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-none flex-col p-0">{children}</ul>;
}

function NoneYet({ icon: Glyph, words }: { icon: typeof FolderGit2; words: string }) {
  return (
    <p className="m-0 flex items-center gap-2.5 rounded-md border border-dashed border-strong px-4 py-3 type-description">
      <Glyph size={ICON.md} aria-hidden className="flex-none" />
      {words}
    </p>
  );
}
