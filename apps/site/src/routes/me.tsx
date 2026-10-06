import { useState, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Switch } from "@astryxdesign/core/Switch";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Briefcase, EyeOff, Flag, FolderGit2, Image as ImageIcon, Lock, LogIn, LogOut, Plus, Swords, Trash2, User, Users, X } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Face, Page, PageHead, Panel } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { Section } from "#/components/Boundary";
import { deleteMe } from "#/functions/account";
import { saveMyChoices } from "#/functions/standings";
import { setMyRival } from "#/functions/versus";
import { signIn, signOut as endSession } from "#/lib/auth-client";
import { forgetViewer } from "#/lib/viewer";
import { choicesQuery, meQuery, myRacesQuery, rivalGapsQuery, rivalsQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/me")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(meQuery()), context.queryClient.ensureQueryData(choicesQuery())]),
  head: () => ({ meta: [{ title: `Settings · ${PRODUCT}` }] }),
  component: Me,
});

const SECTIONS = [
  ["profile", "Profile"],
  ["privacy", "Privacy"],
  ["rivals", "Rivals"],
  ["competing", "Races and Crews"],
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
      <PageHead title="Settings" description={mine ? `Signed in with GitHub as @${mine.user.login}. Every choice here takes effect at once.` : "What others see of you, who you measure yourself against, and the repositories you let us read."} />
      {done && (
        <div className="pb-4">
          <Banner status="success" title={done} />
        </div>
      )}
      {!mine ? (
        <SignedOut />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-0.5">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={`rounded-md px-3 py-1.5 text-sm no-underline transition-colors hover:bg-overlay-hover ${id === "danger" ? "text-removed" : "text-secondary hover:text-primary"}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="flex min-w-0 flex-col gap-gutter">
            <Panel id="profile" title="Profile" description="Who you are signed in as.">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Face login={mine.user.login} name={mine.user.name ?? mine.user.login} size={60} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate type-panel">{mine.user.name ?? mine.user.login}</span>
                    <span className="type-caption">@{mine.user.login} on GitHub</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button label="Your Profile" variant="secondary" icon={<Icon icon={User} size="sm" />} href={`/u/${mine.user.login}`} />
                  <Button label="Your Cards" variant="secondary" icon={<Icon icon={ImageIcon} size="sm" />} href={`/u/${mine.user.login}/cards`} />
                  <Button label="Proof of Work" variant="secondary" icon={<Icon icon={Briefcase} size="sm" />} href={`/u/${mine.user.login}/work`} />
                  <Button label="Sign out" variant="ghost" icon={<Icon icon={LogOut} size="sm" />} onClick={() => signOut.mutate()} isLoading={signOut.isPending} />
                </div>
              </div>
            </Panel>
            <Choices />
            <Section fallback={<PanelSkeletonOf id="rivals" title="Rivals" />}>
              <RivalList />
            </Section>
            <Section fallback={<PanelSkeletonOf id="competing" title="Races and Crews" />}>
              <Competing />
            </Section>
            <Repositories installations={mine.installations} install={mine.install} tokenLost={mine.tokenLost} />
            <Danger onDone={() => void after("Your data is deleted. Everything listed is gone, and you are signed out.")} />
          </div>
        </div>
      )}
    </Page>
  );
}

function SignedOut() {
  const perks: [typeof User, string, string][] = [
    [Lock, "Your private work, counted", "Your own Profile read with your sign-in, so private contributions count. Named to you alone."],
    [EyeOff, "Choose what others see", "Stay out of every comparison, or name your private repositories, with one switch."],
    [Swords, "Rivals, Races and Crews", "Keep the people you measure yourself against, and compete with friends view by view."],
    [FolderGit2, "Connect private repositories", "Let the GitHub App read them, and see their Reports. Only people GitHub lets see them can."],
  ];
  return (
    <div className="flex flex-col gap-gutter">
      <div className="grid gap-gutter sm:grid-cols-2">
        {perks.map(([Glyph, title, words]) => (
          <div key={title} className="flex gap-3 rounded-lg border border-line bg-surface p-panel">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-md bg-brand-soft text-brand">
              <Glyph size={ICON.md} aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="type-label">{title}</span>
              <span className="type-description">{words}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="cta-backdrop flex flex-col items-start gap-4 rounded-lg border border-line p-panel sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="type-panel">Sign in with GitHub to see your settings</span>
          <span className="type-description">
            Read-only. What is kept, and for how long, is on{" "}
            <Link to="/privacy" className="text-primary">
              What we keep
            </Link>
            .
          </span>
        </div>
        <Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn("/me")} />
      </div>
    </div>
  );
}

function PanelSkeletonOf({ id, title }: { id: string; title: string }) {
  return (
    <Panel id={id} title={title} description={<Skeleton height={13} width={260} radius={1} />}>
      <div className="flex flex-col gap-3">
        <Skeleton height={32} radius={2} />
        <Skeleton height={32} radius={2} index={1} />
      </div>
    </Panel>
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
            description="You appear in no one else's Standings, Versus, Leaderboards, Races or Crews, and your Profile says only that it is hidden. You still see your own."
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

function RivalList() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: mine } = useSuspenseQuery(rivalsQuery());
  const remove = useMutation({
    mutationFn: (login: string) => setMyRival({ data: { login, on: false } }),
    onSuccess: (next, login) => {
      queryClient.setQueryData(rivalsQuery().queryKey, (old) => (old ? { ...old, logins: next.logins } : old));
      void queryClient.invalidateQueries({ queryKey: rivalGapsQuery().queryKey });
      toast(`@${login} is no longer your Rival`);
    },
  });
  if (!mine) return null;
  return (
    <Panel id="rivals" title="Rivals" description={`The people your Profile measures you against: ${mine.logins.length} of 5. They are not told.`}>
      {mine.logins.length === 0 ? (
        <Quiet icon={Swords} words={'None yet. Open someone\'s Profile and choose "Make my Rival".'} />
      ) : (
        <List>
          {mine.logins.map((l) => (
            <li key={l} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
              <Face login={l} name={l} size={32} />
              <Link to="/u/$login" params={{ login: l }} className="min-w-0 flex-1 truncate type-label no-underline hover:underline">
                @{l}
              </Link>
              <Button label="Versus" variant="ghost" size="sm" icon={<Icon icon={Swords} size="sm" />} href={`/vs/${mine.login}/${l}`} />
              <Button label={`Remove @${l}`} isIconOnly variant="ghost" size="sm" icon={<Icon icon={X} size="sm" />} tooltip="Remove" isDisabled={remove.isPending} onClick={() => remove.mutate(l)} />
            </li>
          ))}
        </List>
      )}
    </Panel>
  );
}

function Competing() {
  const { data: mine } = useSuspenseQuery(myRacesQuery());
  if (!mine) return null;
  const links: [typeof Flag, string, string, number, number][] = [
    [Flag, "/races", "Races", mine.races.length, mine.invitations.filter((i) => i.kind === "race").length],
    [Users, "/crews", "Crews", mine.crews.length, mine.invitations.filter((i) => i.kind === "crew").length],
  ];
  return (
    <Panel id="competing" title="Races and Crews" description="Where you compare yourself with friends. You join only by accepting, and leave at any time.">
      <div className="grid gap-gutter sm:grid-cols-2">
        {links.map(([Glyph, to, label, n, waiting]) => (
          <Link key={to} to={to as "/races"} className="flex items-center gap-3 rounded-md border border-line p-4 text-primary no-underline transition-colors hover:border-line-strong">
            <Glyph size={ICON.md} className="text-brand" aria-hidden />
            <span className="flex flex-1 flex-col">
              <span className="type-label">{label}</span>
              <span className="type-caption tnum">{n === 0 ? "none yet" : `in ${n}`}</span>
            </span>
            {waiting > 0 && <Badge label={waiting === 1 ? "1 invitation" : `${waiting} invitations`} variant="success" />}
          </Link>
        ))}
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
      description="Private repositories you let commitscape's GitHub App read, which can only read. Each one's Report and Standings show only to people GitHub shows it to, checked on every visit."
      actions={install ? <Button label="Add repositories" variant="secondary" size="sm" icon={<Icon icon={Plus} size="sm" />} href={install} target="_blank" /> : undefined}
    >
      {tokenLost && <Banner status="warning" title="GitHub no longer accepts this sign-in for reading your repositories. Sign out and in again to see them." />}
      {count === 0 && !tokenLost && <Quiet icon={FolderGit2} words="None yet. Choose repositories in the GitHub App to see their Reports here." />}
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
    <section id="danger" className="scroll-mt-20 rounded-lg border border-removed/45 p-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="m-0 type-panel text-removed">Delete my data</h2>
          <p className="m-0 type-description">
            Removes your account, every session, your choices (so you are no longer hidden), your own copy of your Profile, and the Reports of the repositories you connected, at once. Removing the App on GitHub deletes those Reports too.
          </p>
        </div>
        <Button label="Delete my data" variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => setAsking(true)} />
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

function Quiet({ icon: Glyph, words }: { icon: typeof Flag; words: string }) {
  return (
    <p className="m-0 flex items-center gap-2.5 rounded-md border border-dashed border-line px-4 py-3 type-description">
      <Glyph size={ICON.md} aria-hidden className="flex-none" />
      {words}
    </p>
  );
}
