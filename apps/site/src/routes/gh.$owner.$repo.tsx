import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Locked } from "#/components/Locked";
import { GATES } from "#/lib/gates";
import { Check, Download, ExternalLink, FileCode, History } from "lucide-react";
import { FAILURE_WORDS, PRODUCT, VIEWS, type GitStatus, type Lookup, type View } from "@commitscape/data";
import { App, CARDS, codeLink, dataQuery, date, GIT_SCREENS, gitKeyOf, hallOfFameCardSize, InlineLink, paramsOf, primaryRequest, pullAskOf, pullStatsAskOf, queryOf, Quiet, screensOf, REPO_CARDS, REPO_COMPACT_SIZE, REPO_STATS_SIZE, repoFacesCardSize, Leaderboard, Panel, SCREEN_SKELETONS, ScreenColumn, ScreenHeader, SourceContext, TITLES, toRoute, toSearch, Workspace, type Route as Where, type WorkspaceSlots } from "@commitscape/ui";
import { startBuild } from "#/functions/repos";
import { gitStatusQuery, lookupQuery, reportHeadQuery, running, standingsQuery } from "#/lib/queries";
import { getPull, getPulls, getPullStats } from "#/functions/pulls";
import { gitId, prefetchTree, siteGit, warmCode } from "#/lib/git-source";
import { PullConversation } from "#/components/PullConversation";
import { siteSource } from "#/lib/source";
import { signIn } from "#/lib/auth-client";
import { useHydrated } from "#/lib/hydrated";
import { useRemember } from "#/lib/recent";
import { Section } from "#/components/Boundary";
import { Chip, GitHubFacts, RepoBarName, RepoHero, RepoIdentity } from "#/components/Facts";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import type { CardChoice } from "#/components/CardStudio";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ThemedCard } from "#/components/ThemedCard";

const STEPS = [
  { id: "queued", title: "Waiting for its turn", doing: "Builds run one at a time; it starts as soon as the one before it ends." },
  { id: "cloning", title: "Fetching it from GitHub", doing: "Copying every commit of its history to the Builder." },
  { id: "reading", title: "Reading its history", doing: "Every commit, who made it, and every line each one added and removed." },
  { id: "uploading", title: "Storing its Report", doing: "Writing every screen, for every Window, ahead of time." },
] as const;

const STANDINGS_FIRST = 20;

export const Route = createFileRoute("/gh/$owner/$repo")({
  staticData: { frame: "workspace" },
  validateSearch: (search: Record<string, unknown>) => toSearch(search),
  loaderDeps: ({ search }) => ({ screen: search.screen, path: search.path, pr: search.pr, state: search.state, by: search.by, q: search.q, page: search.page, window: search.window, from: search.from, to: search.to, person: search.person, folder: search.folder, id: search.id, code: search.code, author: search.author, label: search.label, size: search.size, review: search.review, stale: search.stale, draft: search.draft }),
  loader: async ({ params, context, deps }) => {
    const lookup = await context.queryClient.ensureQueryData(lookupQuery(params.owner, params.repo));
    if (lookup.id !== `${params.owner}/${params.repo}`.toLowerCase()) throw redirect({ to: "/gh/$owner/$repo", params: { owner: lookup.owner, repo: lookup.name }, search: true, replace: true });
    if (lookup.report) await warm(context.queryClient, params.owner, params.repo, lookup.report.at, deps);
    return {
      name: `${lookup.owner}/${lookup.name}`,
      description: lookup.facts?.description ?? null,
      card: !!lookup.report && lookup.access === "public",
      origin: context.origin ?? "",
      screen: toRoute(deps).screen,
    };
  },
  head: ({ loaderData, params }) => {
    const name = loaderData?.name ?? `${params.owner}/${params.repo}`;
    const title = loaderData && loaderData.screen !== "overview" ? `${TITLES[loaderData.screen]} · ${name} · ${PRODUCT}` : `${name} on ${PRODUCT}`;
    const words = loaderData?.description || "Who built it, and how each of them stands.";
    return {
      meta: [
        { title },
        { name: "description", content: words },
        { property: "og:title", content: title },
        { property: "og:description", content: words },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:url", content: `${loaderData?.origin ?? ""}/gh/${params.owner}/${params.repo}` },
        ...(loaderData?.card ? [{ property: "og:image", content: `${loaderData.origin}/api/cards/gh/${params.owner}/${params.repo}/hall-of-fame.png` }] : []),
      ],
    };
  },
  component: Repository,
});

type Deps = Partial<Record<"screen" | "path" | "state" | "by" | "q" | "window" | "folder" | "code" | "author" | "label" | "size" | "review" | "stale" | "draft", string | undefined> & Record<"pr" | "page" | "from" | "to" | "person" | "id", number | undefined>>;

async function warm(queryClient: ReturnType<typeof useQueryClient>, owner: string, repo: string, at: number, deps: Deps): Promise<void> {
  const [status, head] = await Promise.all([queryClient.ensureQueryData(gitStatusQuery(owner, repo, at)).catch(() => null), queryClient.ensureQueryData(reportHeadQuery(owner, repo, at)).catch(() => null)]);
  if (head) {
    const route = toRoute(deps);
    const asked = primaryRequest(route, paramsOf(route, head.meta));
    if (asked) void queryClient.prefetchQuery(dataQuery(siteSource(owner, repo, head.at, head.meta, head.ranges), asked[0], asked[1]));
  }
  if (deps.screen === "people") void queryClient.prefetchQuery(standingsQuery(owner, repo, undefined, STANDINGS_FIRST));
  if (!status) return;
  const id = gitId(owner, repo, status.builtAt);
  if (deps.screen === "pulls") {
    const work =
      deps.pr !== undefined
        ? queryClient.ensureQueryData({ queryKey: gitKeyOf(id, "pull", deps.pr), queryFn: () => getPull({ data: { owner, repo, number: deps.pr as number } }), staleTime: 60_000 })
        : Promise.all([
            queryClient.ensureQueryData({ queryKey: gitKeyOf(id, "pulls", JSON.stringify(pullAskOf(deps, head?.meta.window))), queryFn: () => getPulls({ data: { owner, repo, ...pullAskOf(deps, head?.meta.window) } }), staleTime: 60_000 }),
            queryClient.ensureQueryData({ queryKey: gitKeyOf(id, "pull-stats", JSON.stringify(pullStatsAskOf(deps, head?.meta.window))), queryFn: () => getPullStats({ data: { owner, repo, ...pullStatsAskOf(deps, head?.meta.window) } }), staleTime: 60_000 }),
          ]);
    await work.catch(() => null);
  }
  if (deps.code) {
    const code = warmCode(queryClient, owner, repo, status, deps.code).catch(() => null);
    if (typeof window === "undefined") await code;
  }
}

const github = (owner: string, repo: string) => `https://github.com/${owner}/${repo}`;

function GitHubButton({ owner, repo }: { owner: string; repo: string }) {
  return <Button label="View on GitHub" variant="secondary" icon={<Icon icon={ExternalLink} size="sm" />} href={github(owner, repo)} target="_blank" rel="noopener noreferrer" />;
}

function slotsOf(lookup: Lookup, status: ReactNode): WorkspaceSlots {
  return {
    label: `${lookup.owner}/${lookup.name}`,
    identity: <RepoIdentity owner={lookup.owner} name={lookup.name} facts={lookup.facts} status={status} />,
    bar: <RepoBarName owner={lookup.owner} name={lookup.name} />,
    actions: <GitHubButton owner={lookup.owner} repo={lookup.name} />,
    link: (r) => `/gh/${lookup.owner}/${lookup.name}${queryOf(r)}`,
  };
}

function BuildState({ lookup, busy, pill = false }: { lookup: Lookup; busy: boolean; pill?: boolean }) {
  const words = lookup.report ? (busy ? "updating…" : `built ${date(lookup.report.at)}`) : busy ? "building…" : null;
  if (!words) return null;
  const title = lookup.report ? (busy ? "A newer Report is being built; this one shows meanwhile" : "When this Report was built") : "Its first Report is being built";
  const icon = busy ? <Spinner size="sm" /> : <History size={12} aria-hidden />;
  if (pill)
    return (
      <Chip icon={icon} tone={busy ? "brand" : undefined} title={title}>
        {words}
      </Chip>
    );
  return (
    <span className={`inline-flex items-center gap-1 ${busy ? "text-brand" : ""}`} title={title}>
      {icon}
      {words}
    </span>
  );
}

function Repository() {
  const { owner, repo } = Route.useParams();
  const where = toRoute(Route.useSearch());
  const queryClient = useQueryClient();
  const { data: lookup } = useSuspenseQuery(lookupQuery(owner, repo));
  const { user } = useRouteContext({ from: "__root__" });
  const mayBuild = !!user || !GATES.build.on;
  const build = useMutation({
    mutationFn: () => startBuild({ data: { owner, repo } }),
    onSuccess: (next) => queryClient.setQueryData(lookupQuery(owner, repo).queryKey, next),
  });
  const asked = useRef(false);
  useEffect(() => {
    if (lookup.canBuild && mayBuild && !asked.current) {
      asked.current = true;
      build.mutate();
    }
  }, [lookup.canBuild, mayBuild, build]);
  useRemember(lookup.status === "ok" ? { kind: "repo", id: `${lookup.owner}/${lookup.name}` } : null);
  const busy = running(lookup);
  const slots = slotsOf(lookup, <BuildState lookup={lookup} busy={busy} />);

  if (lookup.status === "not_found" && !lookup.facts) return <NotFound lookup={lookup} owner={owner} repo={repo} />;
  if (lookup.report)
    return (
      <Suspense fallback={<ReportSkeleton owner={owner} repo={repo} at={lookup.report.at} slots={slots} />}>
        <Report lookup={lookup} owner={owner} repo={repo} at={lookup.report.at} busy={busy} slots={slots} counting={!lookup.report.lines} notice={<LinesNotice counting={!lookup.report.lines} busy={busy} />} />
      </Suspense>
    );
  return (
    <Workspace slots={slots} route={where} screens={screensOf(false)} picker={null}>
      <ScreenColumn>
        <ScreenHeader title={`${lookup.owner}/${lookup.name}`} counts={busy ? "Its first Report is being built" : "It has no Report yet"} />
        {!mayBuild && !busy && !(lookup.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason === "too_big") ? (
          <div className="pt-5">
            <Locked gate="build" height={320} />
          </div>
        ) : (
          <Waiting lookup={lookup} owner={owner} repo={repo} error={build.error?.message ?? null} />
        )}
      </ScreenColumn>
    </Workspace>
  );
}

/** The note above a Report whose lines are still being counted; once they land it says so in the same place until dismissed, so the screen below does not move. */
function LinesNotice({ counting, busy }: { counting: boolean; busy: boolean }) {
  const [seen, setSeen] = useState(counting);
  const [gone, setGone] = useState(false);
  if (counting && !seen) setSeen(true);
  if (!counting && (!seen || gone)) return null;
  return (
    <div className="pt-5">
      {counting ? (
        <Banner
          status="info"
          title={busy ? "A fresh read that counts every line is under way." : "A fresh read with line counts is on its way."}
          description="This Report was written before every line was counted. Lines added, removed and still running shimmer in their places below until the new one lands; the page updates by itself."
        />
      ) : (
        <Banner status="success" title="Every line is counted now." description="Lines added, removed and still running below are from the new Report." isDismissable onDismiss={() => setGone(true)} />
      )}
    </div>
  );
}

function ReportSkeleton({ owner, repo, at, slots }: { owner: string; repo: string; at: number; slots: WorkspaceSlots }) {
  const where = toRoute(Route.useSearch());
  const Screen = SCREEN_SKELETONS[where.screen];
  const { data: git } = useQuery(gitStatusQuery(owner, repo, at));
  return (
    <Workspace slots={slots} route={where} screens={screensOf(!!git)}>
      <div aria-busy="true" aria-label="Loading the Report">
        <ScreenColumn wide={where.screen === "universe"}>
          {where.screen === "overview" ? <div className="h-(--screen-header-height)" /> : <ScreenHeader title={TITLES[where.screen]} />}
          <Screen />
        </ScreenColumn>
      </div>
    </Workspace>
  );
}

function Report({ lookup, owner, repo, at, busy, slots: base, notice, counting }: { lookup: Lookup; owner: string; repo: string; at: number; busy: boolean; slots: WorkspaceSlots; notice?: ReactNode; counting: boolean }) {
  const asked = toRoute(Route.useSearch());
  const queryClient = useQueryClient();
  const { data: status } = useQuery(gitStatusQuery(owner, repo, at));
  const git = useMemo(() => (status ? siteGit(owner, repo, status, (number) => <PullConversation owner={owner} repo={repo} number={number} />) : null), [owner, repo, status]);
  const where = git || !(GIT_SCREENS as readonly string[]).includes(asked.screen) ? asked : { ...asked, screen: "overview" as const };
  const navigate = useNavigate({ from: Route.fullPath });
  const { card } = Route.useLoaderData();
  const { data: head } = useSuspenseQuery(reportHeadQuery(owner, repo, at));
  const source = useMemo(() => siteSource(owner, repo, head.at, head.meta, head.ranges), [owner, repo, head.at, head.meta, head.ranges]);
  const logins = useMemo(() => new Map(head.logins), [head.logins]);
  const standing = useMemo(() => (login: string) => `/u/${login}/${owner}/${repo}`, [owner, repo]);
  const people = head.logins.length;
  const shareable = card && !head.private && people > 0;
  const go = (change: Partial<Where>, replace = false) => void navigate({ search: (prev) => toSearch({ ...prev, ...change }), replace, resetScroll: false });
  const actions = (
    <>
      {shareable && <HallShare owner={lookup.owner} repo={lookup.name} people={people} label="Share" variant="primary" />}
      <GitHubButton owner={lookup.owner} repo={lookup.name} />
    </>
  );
  const slots: WorkspaceSlots = {
    ...base,
    actions,
    counts: countsOf(status),
    hero: <RepoHero owner={lookup.owner} name={lookup.name} facts={lookup.facts} status={<BuildState lookup={lookup} busy={busy} pill />} actions={actions} browse={git ? <Button label="Browse code" variant="secondary" icon={<Icon icon={FileCode} size="sm" />} href={base.link(codeLink(where, "/"))} /> : undefined} />,
  };
  const extras = {
    people: (
      <Section fallback={<Fallback title="Leaderboard" height={10 * 53} />}>
        <Standings owner={owner} repo={repo} view={VIEW_IDS.includes(where.rank as View) ? (where.rank as View) : "surviving"} onView={(rank) => go({ rank }, true)} />
      </Section>
    ),
    overview: shareable ? <HallOfFame owner={owner} repo={repo} people={people} template={where.card ?? "hall-of-fame"} onTemplate={(card) => go({ card: card === "hall-of-fame" ? undefined : card }, true)} /> : undefined,
  };
  const warmCode = (e: { target: EventTarget }) => {
    if (status && e.target instanceof Element && e.target.closest('a[href*="code="]')) void prefetchTree(queryClient, owner, repo, status).catch(() => null);
  };
  return (
    <SourceContext value={source}>
      <div onPointerOver={warmCode} onFocus={warmCode}>
        <App route={where} go={go} slots={slots} logins={logins} standing={standing} extras={extras} notice={notice} counting={counting} {...(git ? { git } : {})} />
      </div>
    </SourceContext>
  );
}

function countsOf(status: GitStatus | undefined | null): WorkspaceSlots["counts"] {
  if (!status) return undefined;
  return { branches: { n: status.openBranches, noun: "open branches" }, pulls: { n: status.openPulls, noun: "open pull requests" } };
}

function Fallback({ title, height }: { title: string; height: number }) {
  return (
    <Panel title={title} description={"\u00a0"}>
      <Skeleton height={height} />
    </Panel>
  );
}

const VIEW_IDS: string[] = VIEWS.map((v) => v.id);

function Standings({ owner, repo, view, onView }: { owner: string; repo: string; view: View; onView: (v: View) => void }) {
  const [all, setAll] = useState(false);
  const { data: first } = useSuspenseQuery(standingsQuery(owner, repo, undefined, STANDINGS_FIRST));
  const everyone = useQuery({ ...standingsQuery(owner, repo), enabled: all });
  const data = all && everyone.data ? everyone.data : first;
  if (data.people.length === 0) return <Quiet>GitHub links no commits to an account in this repository yet, so there are no Standings.</Quiet>;
  return <Leaderboard standings={data} view={view} onView={onView} onAll={setAll} loadingAll={all && !everyone.data} />;
}

const TEMPLATES = REPO_CARDS.map((kind) => ({ kind, title: CARDS[kind].title, about: CARDS[kind].about }));

function repoChoices(owner: string, repo: string, people: number): CardChoice[] {
  const sizes: Record<(typeof REPO_CARDS)[number], { width: number; height: number }> = {
    "hall-of-fame": hallOfFameCardSize(people),
    "repo-compact": REPO_COMPACT_SIZE,
    "repo-stats": REPO_STATS_SIZE,
    "repo-faces": repoFacesCardSize(people),
  };
  return TEMPLATES.map((t) => ({
    id: t.kind,
    title: t.title,
    about: t.about,
    url: `/api/cards/gh/${owner}/${repo}/${t.kind}`,
    ...sizes[t.kind],
    link: `/gh/${owner}/${repo}`,
    share: `The people who built ${owner}/${repo}.`,
    alt: `${owner}/${repo}: ${t.title.toLowerCase()} Card`,
  }));
}

function HallShare({ owner, repo, people, label, variant, first = "hall-of-fame" }: { owner: string; repo: string; people: number; label: string; variant: "primary" | "secondary"; first?: string }) {
  const { origin } = Route.useLoaderData();
  const all = repoChoices(owner, repo, people);
  const choices = [...all.filter((c) => c.id === first), ...all.filter((c) => c.id !== first)];
  return <ShareButton choices={choices} origin={origin} label={label} title={`Share ${owner}/${repo}'s Card`} variant={variant} />;
}

function HallOfFame({ owner, repo, people, template, onTemplate }: { owner: string; repo: string; people: number; template: string; onTemplate: (t: string) => void }) {
  const choices = repoChoices(owner, repo, people);
  const chosen = choices.find((c) => c.id === template) ?? choices[0];
  if (!chosen) return null;
  return (
    <Panel
      title="Its Card, for a README or a post"
      description={`${chosen.about} Light and dark, refreshed every six hours.`}
      actions={
        <>
          <a href={`${chosen.url}.png`} download={`${owner}-${repo}-${chosen.id}.png`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-primary no-underline transition-colors duration-(--duration-instant) hover:bg-hover">
            <Download size={14} aria-hidden />
            Download PNG
          </a>
          <HallShare owner={owner} repo={repo} people={people} label="Put it in a README" variant="secondary" first={chosen.id} />
        </>
      }
    >
      <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
        <SegmentedControl label="Card" size="sm" value={chosen.id} onChange={onTemplate}>
          {choices.map((c) => (
            <SegmentedControlItem key={c.id} value={c.id} label={c.title} />
          ))}
        </SegmentedControl>
      </div>
      <div className="studio-stage grid min-h-[22rem] place-items-center rounded-md border border-line px-4 py-8 sm:px-8">
        <div className="w-full drop-shadow-[0_18px_40px_rgb(0_0_0/0.22)]" style={{ maxWidth: chosen.width }}>
          <ThemedCard key={chosen.id} src={chosen.url} alt={chosen.alt} width={chosen.width} height={chosen.height} />
        </div>
      </div>
    </Panel>
  );
}

function NotFound({ lookup, owner, repo }: { lookup: Lookup; owner: string; repo: string }) {
  return (
    <Missing
      title={`Nothing at ${owner}/${repo}`}
      words={FAILURE_WORDS.not_found}
      note={
        lookup.access === "signed_out" ? (
          <>
            If it is a private repository of yours, <InlineLink onClick={() => signIn(`/gh/${owner}/${repo}`)}>sign in with GitHub</InlineLink> to see it.
          </>
        ) : undefined
      }
    />
  );
}

function Waiting({ lookup, owner, repo, error }: { lookup: Lookup; owner: string; repo: string; error: string | null }) {
  const busy = running(lookup);
  const failed = lookup.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason;
  return (
    <div className="flex flex-col gap-gutter pt-5">
      {error && <Banner status="error" title={error} />}
      {lookup.status === "not_found" && (
        <Banner
          status="warning"
          title={FAILURE_WORDS.not_found}
          endContent={lookup.access === "signed_out" ? <Button label="Sign in with GitHub" variant="secondary" size="sm" onClick={() => signIn(`/gh/${owner}/${repo}`)} /> : undefined}
        />
      )}
      {lookup.status === "private" && (
        <Banner
          status="info"
          title={FAILURE_WORDS.private}
          description={
            lookup.access === "not_connected" ? (
              <span>
                You can see it on GitHub; <Link to="/me">add it through commitscape's GitHub App</Link> to let the Site read it.
              </span>
            ) : undefined
          }
        />
      )}
      {lookup.status === "ok" && busy && lookup.build && <BuildProgress build={lookup.build} name={`${lookup.owner}/${lookup.name}`} />}
      {failed && lookup.build?.reason && <Banner status={lookup.build.reason === "paused" ? "info" : "warning"} title={FAILURE_WORDS[lookup.build.reason]} />}
      {lookup.facts && (
        <section aria-label="What GitHub says" className="flex flex-col gap-3">
          {busy && <h2 className="m-0 pt-2 type-label text-secondary">Meanwhile, what GitHub says of it</h2>}
          <GitHubFacts facts={lookup.facts} />
        </section>
      )}
    </div>
  );
}

function useNow(on: boolean): number | null {
  const hydrated = useHydrated();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [on]);
  return hydrated ? now : null;
}

function elapsed(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} min ${String(r).padStart(2, "0")} s` : `${r} s`;
}

function BuildProgress({ build, name }: { build: NonNullable<Lookup["build"]>; name: string }) {
  const now = useNow(true);
  const current = build.state === "queued" ? 0 : Math.max(1, STEPS.findIndex((s) => s.id === (build.step ?? "reading")));
  const since = now === null ? null : Math.max(0, now - build.requestedAt);
  return (
    <Panel
      title={`Building ${name}'s Report`}
      description="This page fills in by itself when it is done; you can leave it open, or come back later."
      actions={
        <span className="inline-flex h-6 items-center gap-2 rounded-full border border-line px-2.5 text-xs font-medium tnum" aria-live="off">
          <Spinner size="sm" />
          <span className="text-secondary">{since === null ? " " : elapsed(since)}</span>
        </span>
      }
    >
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={now ? "step" : undefined}>
              {i < STEPS.length - 1 && <span className={`absolute start-[11px] top-7 bottom-1 w-px ${done ? "bg-brand" : "bg-line"}`} aria-hidden />}
              <span className={`relative grid size-6 flex-none place-items-center rounded-full ${done ? "bg-brand text-on-brand" : now ? "bg-brand-soft" : "border border-line"}`}>
                {done ? <Check size={14} strokeWidth={3} aria-hidden /> : now ? <Spinner size="sm" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <span className={`text-sm font-medium ${done || now ? "text-primary" : "text-secondary"}`}>
                  {s.title}
                  {done && <span className="sr-only">, done</span>}
                </span>
                {now && <span className="type-caption">{s.doing}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="m-0 rounded-md bg-sunken px-3 py-2.5 type-description">
        Most repositories take under a minute. A big one can take several minutes the first time, since every line of its history is now counted: each person's lines added and removed, merges, lockfiles and generated files left out.
      </p>
    </Panel>
  );
}
