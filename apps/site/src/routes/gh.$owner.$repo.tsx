import { Suspense, useEffect, useMemo, useRef } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FAILURE_WORDS, PRODUCT, type Lookup } from "@commitscape/data";
import { App, ScreenSkeleton, SourceContext, toRoute, toSearch, type Route as Where } from "@commitscape/ui";
import { startBuild } from "#/functions/repos";
import { lookupQuery, reportHeadQuery, running } from "#/lib/queries";
import { siteSource } from "#/lib/source";
import { signIn } from "#/lib/auth-client";
import { CardBox } from "#/components/CardBox";
import { Facts, RepoHeader } from "#/components/Facts";

const STEPS: Record<string, string> = {
  queued: "Waiting for its turn to be read",
  reading: "Reading its history",
  uploading: "Storing its Report",
};

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
  const built = lookup.report ? new Date(lookup.report.at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <div className="flex flex-col gap-2">
      <RepoHeader lookup={lookup}>
        {lookup.report && (running(lookup) ? <Badge label="updating…" variant="info" /> : <span className="note small">built {built}</span>)}
        {lookup.report && !lookup.report.lines && <Badge label="lines not counted" variant="neutral" />}
      </RepoHeader>
      {lookup.report ? (
        <Suspense fallback={<ScreenSkeleton />}>
          <Report owner={owner} repo={repo} at={lookup.report.at} />
        </Suspense>
      ) : (
        <Waiting lookup={lookup} owner={owner} repo={repo} error={build.error?.message ?? null} />
      )}
    </div>
  );
}

function Report({ owner, repo, at }: { owner: string; repo: string; at: number }) {
  const where = toRoute(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: head } = useSuspenseQuery(reportHeadQuery(owner, repo, at));
  const source = useMemo(() => siteSource(owner, repo, head.at, head.meta), [owner, repo, head.at, head.meta]);
  const logins = useMemo(() => new Map(head.logins), [head.logins]);
  const go = (change: Partial<Where>, replace = false) => void navigate({ search: (prev) => toSearch({ ...prev, ...change }), replace, resetScroll: false });
  return (
    <SourceContext value={source}>
      <App route={where} go={go} logins={logins} />
      {where.screen === "overview" && !head.private && <HallOfFame owner={owner} repo={repo} />}
    </SourceContext>
  );
}

function HallOfFame({ owner, repo }: { owner: string; repo: string }) {
  const { origin } = Route.useLoaderData();
  return (
    <CardBox
      title="A hall of fame for your README"
      about="The people who built it, with their faces and numbers. Light and dark; refreshed every six hours."
      url={`${origin}/api/cards/gh/${owner}/${repo}/hall-of-fame`}
      alt={`The people who built ${owner}/${repo}`}
      link={`${origin}/gh/${owner}/${repo}`}
      share={`The people who built ${owner}/${repo}.`}
      width={720}
      height={550}
    />
  );
}

function Waiting({ lookup, owner, repo, error }: { lookup: Lookup; owner: string; repo: string; error: string | null }) {
  const busy = running(lookup);
  return (
    <section className="flex flex-col gap-4 py-4">
      {error && <Banner status="error" title={error} />}
      {lookup.status === "not_found" && (
        <>
          <Banner status="warning" title={FAILURE_WORDS.not_found} />
          {lookup.access === "signed_out" && (
            <p>
              If it is a private repository of yours,{" "}
              <button type="button" className="link" onClick={() => signIn(`/gh/${owner}/${repo}`)}>
                sign in with GitHub
              </button>{" "}
              to see it.
            </p>
          )}
        </>
      )}
      {lookup.status === "private" && (
        <>
          <Banner status="info" title={FAILURE_WORDS.private} />
          {lookup.access === "not_connected" && (
            <p>
              You can see it on GitHub; <a href="/me">add it through commitscape's GitHub App</a> to let the Site read it.
            </p>
          )}
        </>
      )}
      {lookup.status === "ok" && busy && (
        <p className="build-step">
          <Spinner size="sm" /> {STEPS[lookup.build?.step ?? lookup.build?.state ?? "queued"] ?? "Reading its history"}… Most repositories take seconds; a large one up to a
          minute, the first time.
        </p>
      )}
      {lookup.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason && (
        <Banner status={lookup.build.reason === "paused" ? "info" : "warning"} title={FAILURE_WORDS[lookup.build.reason]} />
      )}
      {lookup.facts && <Facts facts={lookup.facts} />}
    </section>
  );
}
