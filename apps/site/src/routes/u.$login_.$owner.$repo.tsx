import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { avatarUrl, Figure, StandingsTable, TilesSkeleton, YourStanding } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { profileLookupQuery, standingsQuery } from "#/lib/queries";

export const Route = createFileRoute("/u/$login_/$owner/$repo")({
  loader: async ({ params, context }) => {
    const lookup = await context.queryClient.ensureQueryData(profileLookupQuery(params.login));
    return { lookup, origin: context.origin ?? "" };
  },
  head: ({ loaderData, params }) => {
    const identity = loaderData?.lookup && "identity" in loaderData.lookup ? loaderData.lookup.identity : undefined;
    const title = `${identity?.name ?? params.login} in ${params.owner}/${params.repo} on ${PRODUCT}`;
    return { meta: [{ title }, { property: "og:title", content: title }, { property: "og:url", content: `${loaderData?.origin ?? ""}/u/${params.login}/${params.owner}/${params.repo}` }, { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/u/${params.login}/${params.owner}/${params.repo}/standing.png` }, { name: "twitter:card", content: "summary_large_image" }] };
  },
  component: PersonInRepository,
});

function PersonInRepository() {
  const { login, owner, repo } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing words="This person has chosen to stay out of comparisons." />;
  if (lookup.status !== "ok") return <Missing words="GitHub has no person by that name." />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <span className="face-pair">
          <img src={avatarUrl(lookup.identity.login, 48)} alt="" width={48} height={48} className="face-round" />
          <img src={avatarUrl(owner, 32)} alt="" width={28} height={28} className="face-round face-small" />
        </span>
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            <a href={`/u/${lookup.identity.login}`}>{name}</a> <span className="note">in</span> <a href={`/gh/${owner}/${repo}`}>{owner}/{repo}</a>
          </Heading>
          <p className="repo-facts note small">
            <span>@{lookup.identity.login}</span>
            {lookup.self && <span>this is you</span>}
          </p>
        </div>
      </header>
      <Section
        fallback={
          <>
            <TilesSkeleton count={6} className="profile-tiles" />
            <Figure title="Standings" note={<Skeleton height={14} width="40%" radius={1} />}>
              <Skeleton height={25 * 41} />
            </Figure>
          </>
        }
      >
        <Body login={lookup.identity.login} owner={owner} repo={repo} name={name} />
      </Section>
    </div>
  );
}

function Body({ login, owner, repo, name }: { login: string; owner: string; repo: string; name: string }) {
  const { data: standings } = useSuspenseQuery(standingsQuery(owner, repo, login));
  const row = standings.people.find((r) => r.login?.toLowerCase() === login.toLowerCase());
  return (
    <>
      {row ? (
        <YourStanding standings={standings} row={row} />
      ) : (
        <Banner status="info" title={`${name} has no commits, pull requests or reviews in ${owner}/${repo} that commitscape has read.`} />
      )}
      <StandingsTable standings={standings} focus={login} />
    </>
  );
}

function Missing({ words }: { words: string }) {
  const { owner, repo } = Route.useParams();
  return (
    <section className="flex flex-col items-start gap-4 py-12">
      <Heading level={1}>No Standing here</Heading>
      <Banner status="warning" title={words} />
      <Button label={`${owner}/${repo}`} variant="secondary" href={`/gh/${owner}/${repo}`} />
    </section>
  );
}
