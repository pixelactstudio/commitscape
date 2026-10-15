import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Briefcase, Eye, EyeOff, GitBranch, GitFork, GitMerge, GitPullRequest, Hash, Image as ImageIcon, Lock, Plus, Rocket, Settings, Sparkles, Star, Swords, Tag, Upload, type LucideIcon } from "lucide-react";
import type { PrivateShow } from "@commitscape/data";
import { PRODUCT } from "@commitscape/data";
import { Chip, Face, grouped, LangDot, many, Meter, Page, PageHead, Panel, PanelSkeleton, Stat, Surface } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Section } from "#/components/Boundary";
import { Lookup } from "#/components/Lookup";
import { RivalGaps } from "#/components/Rivals";
import { setPrivateWork } from "#/functions/dashboard";
import { dashboardQuery, profileQuery } from "#/lib/queries";
import { unlocked } from "#/lib/gates";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/me" });
  },
  loader: ({ context }) => void context.queryClient.prefetchQuery(dashboardQuery()),
  head: () => ({ meta: [{ title: `Dashboard · ${PRODUCT}` }] }),
  component: Dashboard,
});

const YEAR = new Date().getUTCFullYear();

type Data = Awaited<ReturnType<ReturnType<typeof dashboardQuery>["queryFn"] & {}>>;

function Dashboard() {
  const { user } = Route.useRouteContext();
  const login = user?.login ?? null;
  return (
    <Page className="flex flex-col gap-gutter pb-section">
      <PageHead
        eyebrow="Dashboard"
        title={user?.name ?? login ?? "You"}
        description="Your numbers, the repositories you let commitscape read and what happened in them, and what your Profile shows of your private work."
        media={login ? <Face login={login} name={user?.name ?? login} size={64} /> : undefined}
        actions={
          <>
            {login && <Button label="Open your Profile" variant="primary" icon={<Icon icon={Eye} size="sm" />} href={`/u/${login}`} />}
            <Button label="Settings" variant="secondary" icon={<Icon icon={Settings} size="sm" />} href="/me" />
          </>
        }
      />
      {login && (
        <Section fallback={<NumbersSkeleton />}>
          <YourNumbers login={login} />
        </Section>
      )}
      <Section fallback={null}>
        <RivalGaps />
      </Section>
      {login && <Shortcuts login={login} />}
      <Section fallback={<Skeletons />}>
        <Body />
      </Section>
    </Page>
  );
}

const NUMBERS = 5;

function NumbersSkeleton() {
  return (
    <Surface className="overflow-hidden" aria-hidden>
      <div className="-me-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: NUMBERS }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 border-e border-b border-line p-panel">
            <Skeleton height={28} width="50%" radius={2} index={i} />
            <Skeleton height={14} width="70%" radius={1} index={i} />
          </div>
        ))}
      </div>
    </Surface>
  );
}

function YourNumbers({ login }: { login: string }) {
  const profile = unlocked(useSuspenseQuery(profileQuery(login)).data);
  const t = profile.totals;
  const cells: [string, string, string][] = [
    [grouped(t.prsMerged), "Pull requests merged", t.prsOpened > 0 ? `${Math.round((t.prsMerged * 100) / t.prsOpened)}% of ${grouped(t.prsOpened)} opened` : "none opened yet"],
    [grouped(t.reviews), "Reviews given", "on other people’s pull requests"],
    [grouped(t.commits), "Commits", t.hidden > 0 ? `with ${grouped(t.hidden)} private contributions` : "as GitHub counts them"],
    [grouped(t.activeDays), "Active days", `${many(t.contributions, "contribution", "contributions")} in all`],
    [`${grouped(t.currentStreak)} ${t.currentStreak === 1 ? "day" : "days"}`, t.currentStreak > 0 ? "Streak now" : "No streak today", `longest ${many(t.longestStreak, "day", "days")}`],
  ];
  return (
    <section aria-label="Your numbers" className="flex flex-col gap-2">
      <Surface className="overflow-hidden">
        <div className="-me-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 [&>:last-child:nth-child(odd)]:col-span-2 sm:[&>:last-child:nth-child(odd)]:col-span-1">
          {cells.map(([value, label, note]) => (
            <div key={label} className="border-e border-b border-line p-panel">
              <Stat value={value} label={label} note={note} />
            </div>
          ))}
        </div>
      </Surface>
      <p className="m-0 type-caption">
        Read from GitHub {ago(profile.fetchedAt)}, {profile.scope === "self" ? "with your own sign-in, so private work counts" : "public work only"}.{" "}
        <Link to="/u/$login" params={{ login }} className="inline-link">
          Everything on your Profile
        </Link>
      </p>
    </section>
  );
}

function Shortcuts({ login }: { login: string }) {
  const items: [string, string, LucideIcon][] = [
    ["Your Cards", `/u/${login}/cards`, ImageIcon],
    ["Proof of Work", `/u/${login}/work`, Briefcase],
    [`Wrapped ${YEAR}`, `/u/${login}/wrapped/${YEAR}`, Sparkles],
    ["Versus", "/vs", Swords],
    ["Races", "/races", Rocket],
  ];
  return (
    <nav aria-label="Your pages" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>:last-child:nth-child(odd)]:max-sm:col-span-2">
      {items.map(([label, href, Glyph]) => (
        <Link key={href} to={href as "/"} preload="intent" className="group surface row-hover flex items-center gap-2.5 px-3.5 py-3 text-primary no-underline">
          <Glyph size={ICON.md} aria-hidden className="flex-none text-tertiary transition-colors group-hover:text-brand" />
          <span className="type-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Skeletons() {
  return (
    <div className="grid gap-gutter lg:grid-cols-[1.5fr_1fr]">
      <PanelSkeleton title="Your repositories" height={320} />
      <PanelSkeleton title="Lately" height={320} />
    </div>
  );
}

function Body() {
  const { data } = useSuspenseQuery(dashboardQuery());
  return (
    <>
      <div className="grid items-start gap-gutter lg:grid-cols-[1.5fr_1fr]">
        <Repositories data={data} />
        <Feed data={data} />
      </div>
      <PrivateWork data={data} />
      <Allowance data={data} />
    </>
  );
}

function Repositories({ data }: { data: Data }) {
  return (
    <Panel
      padding={0}
      title="Your repositories"
      description="The repositories you let commitscape read through its GitHub App. Pushes to them rebuild their Report on their own."
      actions={data.install ? <Button label="Add repositories" size="sm" variant="secondary" icon={<Icon icon={Plus} size="sm" />} href={data.install} target="_blank" rel="noopener" /> : undefined}
    >
      <div className="px-5 pb-4">
        <Lookup label="Read" placeholder="A repository, like react/react" />
      </div>
      {data.repositories.length === 0 ? (
        <p className="m-0 border-t border-line px-5 py-6 type-description text-secondary">No repositories yet. Install the App on the ones you want read, private ones included; nothing private is shown to anyone but you unless you choose it below.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {data.repositories.slice(0, 30).map((r) => (
            <li key={r.id}>
              <Link to="/gh/$owner/$repo" params={{ owner: r.owner, repo: r.name }} preload="intent" className="row-hover flex items-center gap-3 px-5 py-3 no-underline">
                <Face login={r.owner} name={r.owner} size={32} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate type-label text-primary">
                    <span className="text-secondary">{r.owner}/</span>
                    {r.name}
                  </span>
                  <span className="type-caption">{r.building ? "being read now" : r.builtAt ? `read ${ago(r.builtAt)}` : "not read yet: open it to start"}</span>
                </div>
                {r.private && (
                  <Chip icon={<Lock size={ICON.xs} aria-hidden />} tone="quiet">
                    private
                  </Chip>
                )}
                {r.stars !== null && r.stars > 0 && (
                  <span className="inline-flex items-center gap-1 type-caption tnum">
                    <Star size={ICON.xs} aria-hidden /> {grouped(r.stars)}
                  </span>
                )}
                {r.building && <Spinner size="sm" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Allowance({ data }: { data: Data }) {
  const a = data.allowance;
  if (!a) return null;
  const row = (label: string, l: { remaining: number; limit: number; reset: number }) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-label">{label}</span>
        <span className="type-caption tnum">
          {l.remaining.toLocaleString("en-US")} of {l.limit.toLocaleString("en-US")} left, until {new Date(l.reset * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <Meter value={l.limit > 0 ? l.remaining / l.limit : 0} label={`${label} left`} tone={l.remaining / Math.max(1, l.limit) < 0.2 ? "neutral" : "brand"} />
    </div>
  );
  return (
    <Panel title="Your GitHub allowance" description="What commitscape reads for you is read with your own sign-in, so it uses your hourly allowance, not anyone else’s.">
      <div className="flex flex-col gap-4">
        {row("REST", a.core)}
        {row("GraphQL", a.graphql)}
      </div>
    </Panel>
  );
}

const EVENT: Record<string, { icon: LucideIcon; words: (e: Data["events"][number]) => string }> = {
  push: { icon: Upload, words: (e) => `pushed ${e.count ?? 1} commit${e.count === 1 ? "" : "s"}${e.title ? `: ${e.title}` : ""}` },
  pr_opened: { icon: GitPullRequest, words: (e) => `opened ${e.title ?? "a pull request"}` },
  pr_reopened: { icon: GitPullRequest, words: (e) => `reopened ${e.title ?? "a pull request"}` },
  pr_merged: { icon: GitMerge, words: (e) => `merged ${e.title ?? "a pull request"}` },
  pr_closed: { icon: GitPullRequest, words: (e) => `closed ${e.title ?? "a pull request"}` },
  review: { icon: Eye, words: (e) => `reviewed ${e.title ?? "a pull request"}` },
  release: { icon: Tag, words: (e) => `released ${e.title ?? "a new version"}` },
  star: { icon: Star, words: (e) => `starred it${e.count ? `, star ${e.count.toLocaleString("en-US")}` : ""}` },
  fork: { icon: GitFork, words: (e) => `forked it${e.title ? ` to ${e.title}` : ""}` },
  branch_created: { icon: GitBranch, words: (e) => `made the branch ${e.title ?? ""}` },
  branch_deleted: { icon: GitBranch, words: (e) => `deleted the branch ${e.title ?? ""}` },
  tag_created: { icon: Hash, words: (e) => `tagged ${e.title ?? ""}` },
  tag_deleted: { icon: Hash, words: (e) => `deleted the tag ${e.title ?? ""}` },
};

function Feed({ data }: { data: Data }) {
  return (
    <Panel padding={0} title="Lately" description="What happened in your repositories, as GitHub tells us.">
      {data.events.length === 0 ? (
        <p className="m-0 px-5 pb-5 type-description text-secondary">Nothing yet. Pushes, pull requests, reviews, releases and stars show here as they happen.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 pb-2">
          {data.events.map((e) => {
            const kind = EVENT[e.kind] ?? { icon: Hash, words: () => e.kind };
            const Glyph = kind.icon;
            const body = (
              <>
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-secondary">
                  <Glyph size={ICON.sm} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 type-description text-primary">
                    <span className="font-medium">{e.actor ?? "someone"}</span> {kind.words(e)}
                  </span>
                  <span className="type-caption">
                    {e.repo} · {ago(e.at)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={e.id}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="row-hover flex gap-3 px-5 py-2.5 no-underline">
                    {body}
                  </a>
                ) : (
                  <div className="flex gap-3 px-5 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const SHOW: { value: PrivateShow; label: string }[] = [
  { value: "hidden", label: "Hidden" },
  { value: "counts", label: "Numbers only" },
  { value: "named", label: "Named" },
];

function PrivateWork({ data }: { data: Data }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const choose = useMutation({
    mutationFn: (v: { repo: string; show: PrivateShow }) => setPrivateWork({ data: v }),
    onSuccess: (privateWork) => {
      queryClient.setQueryData(dashboardQuery().queryKey, (d) => (d ? { ...d, privateWork } : d));
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast("Saved. Your Profile shows it at once.");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not save that."),
  });
  const shown = data.privateWork.filter((r) => r.show !== "hidden");
  return (
    <Panel
      padding={0}
      title="Private work on your Profile"
      description="Most work is private. Choose what each private repository shows to everyone else: nothing, only its numbers added beside your public ones, or its name too. Its code and commits are never shown."
      actions={
        shown.length > 0 ? (
          <Chip icon={<Eye size={ICON.xs} aria-hidden />} tone="brand">
            {shown.length} shown
          </Chip>
        ) : (
          <Chip icon={<EyeOff size={ICON.xs} aria-hidden />} tone="quiet">
            all hidden
          </Chip>
        )
      }
    >
      {data.privateWork.length === 0 ? (
        <p className="m-0 px-5 pb-5 type-description text-secondary">No private work found yet. Install the App on your private repositories, then open your Profile once so it is read with your sign-in.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {data.privateWork.map((r) => (
            <li key={r.repo} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Lock size={ICON.sm} aria-hidden className="shrink-0 text-tertiary" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate type-label text-primary">{r.repo}</span>
                  <span className="inline-flex items-center gap-1.5 type-caption tnum">
                    {r.language && <LangDot colour={r.colour} />}
                    {r.language ? `${r.language} · ` : ""}
                    {count(r.commits, "commit", "commits")} · {count(r.prsMerged, "merged pull request", "merged pull requests")}
                  </span>
                </div>
              </div>
              <SegmentedControl label={`What ${r.repo} shows`} size="md" value={r.show} onChange={(v) => choose.mutate({ repo: r.repo, show: v as PrivateShow })}>
                {SHOW.map((s) => (
                  <SegmentedControlItem key={s.value} value={s.value} label={s.label} />
                ))}
              </SegmentedControl>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function ago(at: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - at);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

