import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FAILURE_WORDS, PRODUCT, type Lookup } from "@commitscape/data";
import { App, dataQuery, paramsOf, primaryRequest, SourceContext, toRoute, toSearch, type Route as Where } from "@commitscape/ui";
import { startBuild } from "#/functions/repos";
import { lookupQuery, reportHeadQuery, running } from "#/lib/queries";
import { siteSource } from "#/lib/source";
import { Connect } from "#/components/Connect";
import { signIn } from "#/lib/auth-client";
import { Facts } from "#/components/Facts";
import { Frame } from "#/components/Frame";
import { RepoSkeleton } from "#/components/States";

const STEPS: Record<string, string> = {
  queued: "Waiting for its turn to be read",
  reading: "Reading its history",
  uploading: "Storing its Report",
};

export const Route = createFileRoute("/gh/$owner/$repo")({
  validateSearch: (search: Record<string, unknown>) => toSearch(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps, context }) => {
    const { queryClient } = context;
    const lookup = await queryClient.ensureQueryData(lookupQuery(params.owner, params.repo));
    if (lookup.report) {
      const head = await queryClient.ensureQueryData(reportHeadQuery(params.owner, params.repo, lookup.report.at));
      const source = siteSource(params.owner, params.repo, head.at, head.meta);
      const route = toRoute(deps);
      const first = primaryRequest(route, paramsOf(route, head.meta));
      if (first) await queryClient.ensureQueryData(dataQuery(source, first[0], first[1])).catch(() => null);
    }
    return {
      name: `${lookup.owner}/${lookup.name}`,
      description: lookup.facts?.description ?? null,
      card: !!lookup.report && lookup.access === "public",
      origin: context.origin ?? "",
    };
  },
  head: ({ loaderData, params }) => {
    const title = `${loaderData?.name ?? `${params.owner}/${params.repo}`} on ${PRODUCT}`;
    const words = loaderData?.description || "Who built it, who knows which part, what is fragile, and what changes together.";
    return {
      meta: [
        { title },
        { name: "description", content: words },
        { property: "og:title", content: title },
        { property: "og:description", content: words },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: loaderData?.card ? "summary_large_image" : "summary" },
        { property: "og:url", content: `${loaderData?.origin ?? ""}/gh/${params.owner}/${params.repo}` },
        ...(loaderData?.card ? [{ property: "og:image", content: `${loaderData.origin}/api/cards/${params.owner}/${params.repo}` }] : []),
      ],
    };
  },
  pendingComponent: RepoSkeleton,
  component: Repository,
});

function Repository() {
  const { owner, repo } = Route.useParams();
  const where = toRoute(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
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
  const head = useQuery({ ...reportHeadQuery(owner, repo, lookup.report?.at ?? 0), enabled: !!lookup.report });
  const source = useMemo(() => (head.data ? siteSource(owner, repo, head.data.at, head.data.meta) : null), [owner, repo, head.data]);
  const go = (change: Partial<Where>, replace = false) => void navigate({ search: (prev) => toSearch({ ...prev, ...change }), replace });

  if (source && lookup.report) {
    const built = new Date(lookup.report.at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return (
      <SourceContext value={source}>
        <App
          route={where}
          go={go}
          home="/"
          nav={
            <>
              {running(lookup) ? <Badge label="updating…" variant="info" /> : <span className="note small">built {built}</span>}
              {!lookup.report.lines && <Badge label="lines not counted" variant="neutral" />}
              <Connect />
            </>
          }
        />
      </SourceContext>
    );
  }
  if (lookup.report) return <RepoSkeleton />;
  return <Waiting lookup={lookup} owner={owner} repo={repo} error={build.error?.message ?? null} />;
}

function Waiting({ lookup, owner, repo, error }: { lookup: Lookup; owner: string; repo: string; error: string | null }) {
  const busy = running(lookup);
  return (
    <Frame>
      <section className="repo-waiting">
        <Heading level={1}>
          <a href={`https://github.com/${owner}/${repo}`}>
            {lookup.owner}/{lookup.name}
          </a>
        </Heading>
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
            <Spinner size="sm" /> {STEPS[lookup.build?.step ?? lookup.build?.state ?? "queued"] ?? "Reading its history"}… Most
            repositories take seconds; a large one up to a minute, the first time.
          </p>
        )}
        {lookup.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason && (
          <Banner status={lookup.build.reason === "paused" ? "info" : "warning"} title={FAILURE_WORDS[lookup.build.reason]} />
        )}
        {lookup.facts && <Facts facts={lookup.facts} />}
      </section>
    </Frame>
  );
}
