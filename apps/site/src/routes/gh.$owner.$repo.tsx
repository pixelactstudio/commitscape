import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Download, ExternalLink, History, Share2 } from "lucide-react";
import { FAILURE_WORDS, PRODUCT, type Lookup, type View } from "@commitscape/data";
import { App, Leaderboard, Page, Panel, ScreenSkeleton, SourceContext, toRoute, toSearch, type Route as Where } from "@commitscape/ui";
import { startBuild } from "#/functions/repos";
import { lookupQuery, reportHeadQuery, running, standingsQuery } from "#/lib/queries";
import { siteSource } from "#/lib/source";
import { signIn } from "#/lib/auth-client";
import { useHydrated } from "#/lib/hydrated";
import { useRemember } from "#/lib/recent";
import { Section } from "#/components/Boundary";
import { Chip, GitHubFacts, RepoHero } from "#/components/Facts";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { ThemedCard } from "#/components/ThemedCard";

const STEPS = [
  { id: "queued", title: "Waiting for its turn", doing: "Builds run one at a time; it starts as soon as the one before it ends." },
  { id: "cloning", title: "Fetching it from GitHub", doing: "Copying every commit of its history to the Builder." },
  { id: "reading", title: "Reading its history", doing: "Every commit, who made it, and every line each one added and removed." },
  { id: "uploading", title: "Storing its Report", doing: "Writing every screen, for every Window, ahead of time." },
] as const;

const built = (at: number) => new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const Route = createFileRoute("/gh/$owner/$repo")({
  validateSearch: (search: Record<string, unknown>) => toSearch(search),
  loader: async ({ params, context }) => {
    const lookup = await context.queryClient.ensureQueryData(lookupQuery(params.owner, params.repo));
    return {
      name: `${lookup.owner}/${lookup.name}`,
      description: lookup.facts?.description ?? null,
      card: !!lookup.report && lookup.access === "public",
      origin: context.origin ?? "",
    };
  },
  head: ({ loaderData, params }) => {
    const title = `${loaderData?.name ?? `${params.owner}/${params.repo}`} on ${PRODUCT}`;
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

function Repository() {
  const { owner, repo } = Route.useParams();
  const { card } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const { data: lookup } = useSuspenseQuery(lookupQuery(owner, repo));
  const build = useMutation({
    mutationFn: () => startBuild({ data: { owner, repo } }),
    onSuccess: (next) => queryClient.setQueryData(lookupQuery(owner, repo).queryKey, next),
  });
  const asked = useRef(false);
  useEffect(() => {
    if (lookup.canBuild && !asked.current) {
      asked.current = true;
      build.mutate();
    }
  }, [lookup.canBuild, build]);
  useRemember(lookup.status === "ok" ? { kind: "repo", id: `${lookup.owner}/${lookup.name}` } : null);

  if (lookup.status === "not_found" && !lookup.facts) return <NotFound lookup={lookup} owner={owner} repo={repo} />;
  const busy = running(lookup);
  const status = lookup.report ? (
    busy ? (
      <Chip icon={<Spinner size="sm" />} tone="brand" title="A newer Report is being built; this one shows meanwhile">
        updating…
      </Chip>
    ) : (
      <Chip icon={<History size={13} aria-hidden />} title="When this Report was built">
        built {built(lookup.report.at)}
      </Chip>
    )
  ) : busy ? (
    <Chip icon={<Spinner size="sm" />} tone="brand" title="Its first Report is being built">
      building…
    </Chip>
  ) : null;
  const github = `https://github.com/${lookup.owner}/${lookup.name}`;
  return (
    <>
      <RepoHero
        owner={lookup.owner}
        name={lookup.name}
        facts={lookup.facts}
        status={status}
        actions={
          <>
            {card && (
              <Section fallback={<Button label="Share" variant="primary" icon={<Icon icon={Share2} size="sm" />} isDisabled />}>
                <HallShare owner={lookup.owner} repo={lookup.name} label="Share" variant="primary" />
              </Section>
            )}
            <Button label="View on GitHub" variant="secondary" icon={<Icon icon={ExternalLink} size="sm" />} href={github} target="_blank" rel="noopener noreferrer" />
          </>
        }
      />
      <Page className="pb-6">
        {lookup.report ? (
          <>
            {!lookup.report.lines && (
              <div className="pt-5 pb-2">
                <Banner
                  status="info"
                  title={busy ? "A fresh read that counts every line is under way." : "A fresh read with line counts is on its way."}
                  description="This Report was written before every line was counted, so lines added, removed and still running are left out below until the new one lands. The page updates by itself."
                />
              </div>
            )}
            <Suspense fallback={<ReportSkeleton />}>
              <Report owner={owner} repo={repo} at={lookup.report.at} />
            </Suspense>
          </>
        ) : (
          <Waiting lookup={lookup} owner={owner} repo={repo} error={build.error?.message ?? null} />
        )}
      </Page>
    </>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the Report">
      <div className="-mx-4 flex h-[37px] items-center gap-6 border-b border-line px-4 sm:-mx-6 sm:px-6">
        {[64, 52, 58, 36, 64].map((w, i) => (
          <Skeleton key={i} height={14} width={w} radius={1} index={i} />
        ))}
      </div>
      <ScreenSkeleton />
    </div>
  );
}

function Report({ owner, repo, at }: { owner: string; repo: string; at: number }) {
  const where = toRoute(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const { card } = Route.useLoaderData();
  const { data: head } = useSuspenseQuery(reportHeadQuery(owner, repo, at));
  const source = useMemo(() => siteSource(owner, repo, head.at, head.meta), [owner, repo, head.at, head.meta]);
  const logins = useMemo(() => new Map(head.logins), [head.logins]);
  const standing = useMemo(() => (login: string) => `/u/${login}/${owner}/${repo}`, [owner, repo]);
  const go = (change: Partial<Where>, replace = false) => void navigate({ search: (prev) => toSearch({ ...prev, ...change }), replace, resetScroll: false });
  const extras = {
    people: (
      <Section fallback={<Fallback title="Leaderboard" height={10 * 53} />}>
        <Standings owner={owner} repo={repo} />
      </Section>
    ),
    overview:
      card && !head.private ? (
        <Section fallback={<Fallback title="A hall of fame for your README" height={330} />}>
          <HallOfFame owner={owner} repo={repo} />
        </Section>
      ) : undefined,
  };
  return (
    <SourceContext value={source}>
      <App route={where} go={go} logins={logins} standing={standing} extras={extras} />
    </SourceContext>
  );
}

function Fallback({ title, height }: { title: string; height: number }) {
  return (
    <Panel title={title} description={"\u00a0"}>
      <Skeleton height={height} />
    </Panel>
  );
}

function Standings({ owner, repo }: { owner: string; repo: string }) {
  const { data } = useSuspenseQuery(standingsQuery(owner, repo));
  const [view, setView] = useState<View>("surviving");
  if (data.people.length === 0) return null;
  return <Leaderboard standings={data} view={view} onView={setView} />;
}

function hallSize(people: number) {
  return { width: 720, height: 150 + Math.min(10, people) * 40 };
}

function HallShare({ owner, repo, label, variant }: { owner: string; repo: string; label: string; variant: "primary" | "secondary" }) {
  const { origin } = Route.useLoaderData();
  const { data } = useSuspenseQuery(standingsQuery(owner, repo));
  const choice = {
    id: "hall-of-fame",
    title: "Hall of fame",
    about: "The people who built it, with their faces and numbers.",
    url: `/api/cards/gh/${owner}/${repo}/hall-of-fame`,
    ...hallSize(data.people.length),
    link: `/gh/${owner}/${repo}`,
    share: `The people who built ${owner}/${repo}.`,
    alt: `The people who built ${owner}/${repo}`,
  };
  return <ShareButton choices={[choice]} origin={origin} label={label} title={`Share ${owner}/${repo}'s hall of fame`} variant={variant} />;
}

function HallOfFame({ owner, repo }: { owner: string; repo: string }) {
  const { data } = useSuspenseQuery(standingsQuery(owner, repo));
  if (data.people.length === 0) return null;
  const size = hallSize(data.people.length);
  const src = `/api/cards/gh/${owner}/${repo}/hall-of-fame`;
  return (
    <Panel
      title="A hall of fame for your README"
      description="The people who built it, with their faces and numbers; light and dark, refreshed every six hours."
      actions={
        <>
          <a href={`${src}.png`} download={`${owner}-${repo}-hall-of-fame.png`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-element)] px-2.5 text-sm font-medium text-primary no-underline transition-colors hover:bg-[var(--color-overlay-hover)]">
            <Download size={14} aria-hidden />
            Download PNG
          </a>
          <HallShare owner={owner} repo={repo} label="Put it in a README" variant="secondary" />
        </>
      }
    >
      <div className="studio-stage flex justify-center rounded-[var(--radius-element)] border border-line px-4 py-8 sm:px-8">
        <div className="w-full drop-shadow-[0_18px_40px_rgb(0_0_0/0.22)]" style={{ maxWidth: size.width }}>
          <ThemedCard src={src} alt={`The people who built ${owner}/${repo}`} width={size.width} height={size.height} />
        </div>
      </div>
    </Panel>
  );
}

function NotFound({ lookup, owner, repo }: { lookup: Lookup; owner: string; repo: string }) {
  return (
    <>
      <Missing title={`Nothing at ${owner}/${repo}`} words={FAILURE_WORDS.not_found} />
      {lookup.access === "signed_out" && (
        <p className="-mt-12 pb-16 text-center text-sm text-secondary">
          If it is a private repository of yours,{" "}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-medium text-primary underline underline-offset-[3px]" onClick={() => signIn(`/gh/${owner}/${repo}`)}>
            sign in with GitHub
          </button>{" "}
          to see it.
        </p>
      )}
    </>
  );
}

function Waiting({ lookup, owner, repo, error }: { lookup: Lookup; owner: string; repo: string; error: string | null }) {
  const busy = running(lookup);
  const failed = lookup.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason;
  return (
    <div className="flex flex-col gap-4 pt-6">
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
          {busy && <h2 className="m-0 pt-2 text-sm font-medium text-secondary">Meanwhile, what GitHub says of it</h2>}
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
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-line px-3 text-sm tnum" aria-live="off">
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
              {i < STEPS.length - 1 && <span className={`absolute start-[11px] top-7 bottom-1 w-px ${done ? "bg-brand" : "bg-[var(--color-border)]"}`} aria-hidden />}
              <span className={`relative grid size-6 flex-none place-items-center rounded-full ${done ? "bg-brand text-[var(--color-background-body)]" : now ? "bg-brand-soft" : "border border-line"}`}>
                {done ? <Check size={14} strokeWidth={3} aria-hidden /> : now ? <Spinner size="sm" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <span className={`text-sm font-medium ${done || now ? "text-primary" : "text-secondary"}`}>
                  {s.title}
                  {done && <span className="sr-only">, done</span>}
                </span>
                {now && <span className="text-sm text-secondary">{s.doing}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="m-0 rounded-[var(--radius-element)] bg-[var(--color-background-muted)] px-3 py-2.5 text-sm text-pretty text-secondary">
        Most repositories take under a minute. A big one can take several minutes the first time, since every line of its history is now counted: each person's lines added and removed, merges, lockfiles and generated files left out.
      </p>
    </Panel>
  );
}
