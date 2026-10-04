import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT, type Identity } from "@commitscape/data";
import { EngineRepos, Figure, Traits, LanguagesByYear, Partners, ProfileActivity, ProfileHero, ProfileTotals, PullRequestTiles, Repositories, SurvivingTile, TilesSkeleton, TipLayer, YearCalendar } from "@commitscape/ui";
import { engineQuery, fullProfileQuery, liveEngineQuery, traitsQuery, profileLookupQuery, profileQuery } from "#/lib/queries";
import { Section } from "#/components/Boundary";
import { RivalActions, RivalGaps } from "#/components/Rivals";
import { useHydrated } from "#/lib/hydrated";

export const Route = createFileRoute("/u/$login")({
  loader: async ({ params, context }) => {
    const lookup = await context.queryClient.ensureQueryData(profileLookupQuery(params.login));
    return { lookup, origin: context.origin ?? "" };
  },
  head: ({ loaderData, params }) => {
    const identity = loaderData?.lookup && "identity" in loaderData.lookup ? loaderData.lookup.identity : undefined;
    const name = identity?.name ? `${identity.name} (@${identity.login})` : `@${params.login}`;
    const title = `${name} on ${PRODUCT}`;
    const words = identity?.bio || `What ${identity?.name ?? params.login} has built, and how they stand next to the people they work with.`;
    return {
      meta: [
        { title },
        { name: "description", content: words },
        { property: "og:title", content: title },
        { property: "og:description", content: words },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: `${loaderData?.origin ?? ""}/u/${params.login}` },
        { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/u/${params.login}/preview.png` },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ProfilePage,
});

const WRAPPED_YEAR = new Date().getUTCFullYear();

function ProfilePage() {
  const { login } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "not_found") return <Missing words="GitHub has no person by that name. Check its spelling." />;
  if (lookup.status === "hidden") return <Missing words="This person has chosen to stay out of comparisons, so their Profile is hidden." />;
  if (lookup.status === "organization" && lookup.identity) {
    return (
      <div className="flex flex-col gap-4">
        <ProfileHero identity={lookup.identity} />
        <Banner status="info" title="This is an organization, not a person. Profiles are about people; open one of its repositories instead." />
      </div>
    );
  }
  if (lookup.status !== "ok") return null;
  return (
    <TipLayer>
      <div className="flex flex-col gap-5 pb-8">
        <ProfileHero
          identity={lookup.identity}
          badges={
            <>
              <Section fallback={null}>
                <ArchetypeBadge login={lookup.identity.login} />
              </Section>
              {lookup.self && <span className="note small">this is you</span>}
            </>
          }
        >
          <Button label="Cards" variant="primary" size="sm" href={`/u/${lookup.identity.login}/cards`} />
          <Button label="Proof of Work" variant="secondary" size="sm" href={`/u/${lookup.identity.login}/work`} />
          <Button label={`Wrapped ${WRAPPED_YEAR}`} variant="secondary" size="sm" href={`/u/${lookup.identity.login}/wrapped/${WRAPPED_YEAR}`} />
          <Section fallback={null}>
            <RivalActions login={lookup.identity.login} />
          </Section>
          <Button label="On GitHub" variant="ghost" size="sm" href={`https://github.com/${lookup.identity.login}`} />
        </ProfileHero>
        {lookup.self && lookup.hidden && <Banner status="info" title="Your Profile is hidden: everyone else sees only that it is hidden, and you are in no one's comparisons. Change it in Settings." />}
        {lookup.self && (
          <Section fallback={null}>
            <RivalGaps />
          </Section>
        )}
        <Section fallback={<TilesSkeleton count={7} className="profile-tiles" />}>
          <Totals identity={lookup.identity} />
        </Section>
        <div className="two">
          <Section fallback={<Placeholder title="The last year" height={262} />}>
            <Year login={lookup.identity.login} />
          </Section>
          <Section fallback={<Placeholder title="Over the years" height={262} />}>
            <Years login={lookup.identity.login} />
          </Section>
        </div>
        <Section fallback={<Placeholder title="Archetype" height={300} />}>
          <ProfileTraits login={lookup.identity.login} />
        </Section>
        <Section fallback={<Placeholder title="Where their work is" height={8 * 61 + 28} />}>
          <Work login={lookup.identity.login} />
        </Section>
        <Section fallback={null}>
          <Engine login={lookup.identity.login} />
        </Section>
        <div className="two">
          <Section fallback={<Placeholder title="Languages over the years" height={262} />}>
            <Languages login={lookup.identity.login} />
          </Section>
          <Section fallback={<Placeholder title="The people they work with most" height={262} />}>
            <People login={lookup.identity.login} />
          </Section>
        </div>
        <Section fallback={null}>
          <Read login={lookup.identity.login} />
        </Section>
      </div>
    </TipLayer>
  );
}

function Placeholder({ title, height }: { title: string; height: number }) {
  return (
    <Figure title={title} note={<Skeleton height={14} width="50%" radius={1} />}>
      <Skeleton height={height} />
    </Figure>
  );
}

function useProfile(login: string) {
  return useSuspenseQuery(profileQuery(login)).data;
}

function useFullProfile(login: string) {
  return useSuspenseQuery(fullProfileQuery(login)).data;
}

function Totals({ identity }: { identity: Identity }) {
  return (
    <ProfileTotals
      profile={useProfile(identity.login)}
      slow={
        <Section fallback={<TileSkeletons count={2} />}>
          <SlowTiles login={identity.login} />
        </Section>
      }
      extra={
        <Section fallback={<TileSkeletons count={1} />}>
          <Surviving login={identity.login} />
        </Section>
      }
    />
  );
}

function SlowTiles({ login }: { login: string }) {
  return <PullRequestTiles profile={useFullProfile(login)} />;
}

function useEngine(login: string) {
  const { data } = useSuspenseQuery(engineQuery(login));
  const mounted = useHydrated();
  const live = useQuery({ ...liveEngineQuery(login), enabled: mounted && data.counting > 0 });
  return mounted && live.data ? live.data : data;
}

function ArchetypeBadge({ login }: { login: string }) {
  const { data } = useSuspenseQuery(traitsQuery(login));
  const main = data.archetypes[0];
  return main ? (
    <span title={main.rule}>
      <Badge label={main.title} variant="info" />
    </span>
  ) : null;
}

function ProfileTraits({ login }: { login: string }) {
  const { data } = useSuspenseQuery(traitsQuery(login));
  return <Traits archetypes={data.archetypes} achievements={data.achievements} login={login} complete={data.complete} />;
}

function Surviving({ login }: { login: string }) {
  return <SurvivingTile engine={useEngine(login)} />;
}

function Engine({ login }: { login: string }) {
  return <EngineRepos engine={useEngine(login)} login={login} />;
}

function TileSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={104} index={i} />
      ))}
    </>
  );
}

function Work({ login }: { login: string }) {
  return <Repositories profile={useFullProfile(login)} />;
}

function Year({ login }: { login: string }) {
  return <YearCalendar profile={useProfile(login)} />;
}

function Languages({ login }: { login: string }) {
  return <LanguagesByYear profile={useProfile(login)} />;
}

function Years({ login }: { login: string }) {
  return <ProfileActivity profile={useProfile(login)} />;
}

function People({ login }: { login: string }) {
  return <Partners profile={useFullProfile(login)} />;
}

function Read({ login }: { login: string }) {
  const p = useFullProfile(login);
  const when = new Date(p.fetchedAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (
    <p className="note small">
      From GitHub, read {when} UTC{p.scope === "self" ? ", with your own sign-in: private work is shown to you alone" : ""}. Pull requests: the newest {p.read.prs.toLocaleString("en-US")} of {p.read.prsTotal.toLocaleString("en-US")} read for
      lines and partners; totals count them all.
    </p>
  );
}

function Missing({ words }: { words: string }) {
  return (
    <section className="flex flex-col items-start gap-4 py-12">
      <Heading level={1}>No Profile here</Heading>
      <Banner status="warning" title={words} />
    </section>
  );
}
