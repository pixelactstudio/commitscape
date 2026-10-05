import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Briefcase, ExternalLink, Link2, MoreHorizontal, Share2, Sparkles } from "lucide-react";
import { PRODUCT, type Identity } from "@commitscape/data";
import {
  ArchetypePill,
  Cell,
  clockState,
  CommitClock,
  HeadlineNumbers,
  LanguagesOverTime,
  LastYear,
  OverTheYears,
  Page,
  PanelSkeleton,
  PeoplePanel,
  ProfileHeader,
  PullRequestNumbers,
  RepositoryTable,
  SurvivalPanel,
  SurvivingNumber,
  TipLayer,
  TraitsPanel,
} from "@commitscape/ui";
import { Reveal } from "@commitscape/ui/motion";
import { engineQuery, fullProfileQuery, liveEngineQuery, traitsQuery, profileLookupQuery, profileQuery } from "#/lib/queries";
import { Section } from "#/components/Boundary";
import { Compare } from "#/components/Compare";
import { Missing } from "#/components/Missing";
import { RivalActions, RivalGaps } from "#/components/Rivals";
import { useHydrated } from "#/lib/hydrated";
import { useRemember } from "#/lib/recent";
import { useToast } from "#/lib/toast";

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

const YEAR = new Date().getUTCFullYear();

function ProfilePage() {
  const { login } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  useRemember(lookup.status === "ok" ? { kind: "person", id: lookup.identity.login } : null);
  if (lookup.status === "not_found") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name. Check its spelling, or search for them." />;
  if (lookup.status === "hidden") return <Missing title="This Profile is hidden" words="This person has chosen to stay out of comparisons, so their Profile shows nothing." />;
  if (lookup.status === "organization" && lookup.identity) return <Organization identity={lookup.identity} />;
  if (lookup.status !== "ok") return null;
  const id = lookup.identity;
  return (
    <TipLayer>
      <ProfileHeader
        identity={id}
        badges={
          <>
            <Section fallback={null}>
              <Archetype login={id.login} />
            </Section>
            {lookup.self && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-secondary">you</span>}
          </>
        }
        actions={<Actions identity={id} self={lookup.self} />}
      />
      <Page className="flex flex-col gap-4 pt-6 pb-16">
        {lookup.self && lookup.hidden && <Banner status="info" title="Your Profile is hidden. Everyone else sees only that it is hidden, and you are in no one's comparisons. Change it in Settings." />}
        {lookup.self && (
          <Section fallback={null}>
            <RivalGaps />
          </Section>
        )}
        <Section fallback={<NumbersSkeleton />}>
          <Numbers login={id.login} />
        </Section>
        <Section fallback={<PanelSkeleton title="The last year" height={196} />}>
          <Year login={id.login} />
        </Section>
        <Section fallback={<YearsSkeleton />}>
          <Timeline login={id.login} />
        </Section>
        <Reveal>
          <Section fallback={null}>
            <Survival login={id.login} />
          </Section>
        </Reveal>
        <Reveal>
          <Section fallback={<PanelSkeleton title="Where their work is" height={12 * 57 + 34} />}>
            <Work login={id.login} />
          </Section>
        </Reveal>
        <Reveal>
          <Section fallback={<PanelSkeleton title="Achievements" height={360} />}>
            <Traits login={id.login} />
          </Section>
        </Reveal>
        <Reveal>
          <Section fallback={<TogetherSkeleton />}>
            <Together login={id.login} />
          </Section>
        </Reveal>
        <Section fallback={<Skeleton height={16} width={420} radius={1} />}>
          <Read login={id.login} />
        </Section>
      </Page>
    </TipLayer>
  );
}

function Actions({ identity, self }: { identity: Identity; self: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { origin } = Route.useLoaderData();
  const go = (to: string) => void router.navigate({ to: to as "/" });
  return (
    <>
      <Button label={self ? "Share my Cards" : "Cards"} variant="primary" icon={<Icon icon={Share2} size="sm" />} href={`/u/${identity.login}/cards`} />
      <Section fallback={null}>
        <RivalActions login={identity.login} />
      </Section>
      <Compare login={identity.login} />
      <DropdownMenu
        button={{ label: "More", isIconOnly: true, icon: <Icon icon={MoreHorizontal} size="sm" />, variant: "secondary", size: "md" }}
        hasChevron={false}
        alignment="end"
        menuWidth={220}
        items={[
          { label: "Proof of Work", icon: Briefcase, description: "Every merged pull request, by month", onClick: () => go(`/u/${identity.login}/work`) },
          { label: `Wrapped ${YEAR}`, icon: Sparkles, description: "Their year on GitHub", onClick: () => go(`/u/${identity.login}/wrapped/${YEAR}`) },
          { type: "divider" },
          {
            label: "Copy link",
            icon: Link2,
            onClick: () => void navigator.clipboard?.writeText(`${origin}/u/${identity.login}`).then(() => toast("Link copied")),
          },
          { label: "Open on GitHub", icon: ExternalLink, onClick: () => void window.open(`https://github.com/${identity.login}`, "_blank", "noopener") },
        ]}
      />
    </>
  );
}

function Organization({ identity }: { identity: Identity }) {
  return (
    <>
      <ProfileHeader identity={identity} />
      <Page className="py-10">
        <Banner status="info" title="This is an organization, not a person. Profiles are about people: open one of its repositories, or one of its people, instead." />
      </Page>
    </>
  );
}

function NumbersSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Cell key={i}>
            <div className="flex flex-col gap-2.5">
              <Skeleton height={36} width="55%" index={i} radius={2} />
              <Skeleton height={14} width="70%" index={i} radius={1} />
              <Skeleton height={12} width="50%" index={i} radius={1} />
            </div>
          </Cell>
        ))}
      </div>
      <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SmallSkeleton key={i} i={i} />
        ))}
      </div>
    </div>
  );
}

function SmallSkeleton({ i }: { i: number }) {
  return (
    <Cell small>
      <div className="flex flex-col gap-2">
        <Skeleton height={22} width="45%" index={i} radius={2} />
        <Skeleton height={13} width="60%" index={i} radius={1} />
        <Skeleton height={11} width="70%" index={i} radius={1} />
      </div>
    </Cell>
  );
}

function useProfile(login: string) {
  return useSuspenseQuery(profileQuery(login)).data;
}

function useFullProfile(login: string) {
  return useSuspenseQuery(fullProfileQuery(login)).data;
}

function useEngine(login: string) {
  const { data } = useSuspenseQuery(engineQuery(login));
  const mounted = useHydrated();
  const live = useQuery({ ...liveEngineQuery(login), enabled: mounted && data.counting > 0 });
  return mounted && live.data ? live.data : data;
}

function Numbers({ login }: { login: string }) {
  const profile = useProfile(login);
  return (
    <HeadlineNumbers
      profile={profile}
      surviving={
        <Section fallback={<Skeleton height={60} width="60%" radius={2} />}>
          <Surviving login={login} suggest={profile.repositories.find((r) => !r.private)} />
        </Section>
      }
      slow={
        <Section fallback={[0, 1].map((i) => <SmallSkeleton key={i} i={i} />)}>
          <PullRequestNumbers profile={useFullProfile(login)} />
        </Section>
      }
    />
  );
}

function Surviving({ login, suggest }: { login: string; suggest?: { owner: string; name: string } }) {
  return <SurvivingNumber engine={useEngine(login)} suggest={suggest ? `${suggest.owner}/${suggest.name}` : null} />;
}

function Archetype({ login }: { login: string }) {
  const { data } = useSuspenseQuery(traitsQuery(login));
  const main = data.archetypes[0];
  return main ? <ArchetypePill archetype={main} also={data.archetypes.slice(1).map((a) => a.title)} /> : null;
}

function Year({ login }: { login: string }) {
  return <LastYear profile={useProfile(login)} />;
}

function YearsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <PanelSkeleton title="Over the years" height={440} />
      <PanelSkeleton title="Languages over the years" height={440} />
    </div>
  );
}

function Timeline({ login }: { login: string }) {
  const profile = useProfile(login);
  const mounted = useHydrated();
  const full = useQuery({ ...fullProfileQuery(login), enabled: mounted });
  const years = <OverTheYears profile={profile} full={mounted ? (full.data ?? null) : null} />;
  if (profile.totals.contributions === 0 || !profile.years.some((y) => y.languages.length > 0)) return years;
  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-[1.4fr_1fr]">
      {years}
      <LanguagesOverTime profile={profile} />
    </div>
  );
}

function Survival({ login }: { login: string }) {
  return <SurvivalPanel engine={useEngine(login)} login={login} />;
}

function Work({ login }: { login: string }) {
  const profile = useFullProfile(login);
  const engine = useEngine(login);
  return <RepositoryTable profile={profile} engine={engine} />;
}

function Traits({ login }: { login: string }) {
  const router = useRouter();
  const { data } = useSuspenseQuery(traitsQuery(login));
  return <TraitsPanel archetypes={data.archetypes} achievements={data.achievements} complete={data.complete} checks={data.checks} onCard={(id) => void router.navigate({ to: "/u/$login/cards", params: { login }, search: { card: `achievement-${id}` } as never })} />;
}

function TogetherSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <PanelSkeleton title="The people they work with most" height={260} />
      <PanelSkeleton title="When they commit" height={260} />
    </div>
  );
}

function Together({ login }: { login: string }) {
  const profile = useFullProfile(login);
  const people = profile.partners.length > 0;
  const clock = clockState(profile) !== "none";
  const versus = (other: string) => `/vs/${login}/${other}`;
  if (people && clock)
    return (
      <div className={`grid items-stretch gap-4 ${profile.partners.length > 6 ? "lg:grid-cols-[1.6fr_1fr]" : "lg:grid-cols-[1fr_1fr]"}`}>
        <PeoplePanel profile={profile} versus={versus} />
        <CommitClock profile={profile} />
      </div>
    );
  if (people) return <PeoplePanel profile={profile} versus={versus} wide />;
  if (clock) return <CommitClock profile={profile} wide />;
  return null;
}

function Read({ login }: { login: string }) {
  const p = useFullProfile(login);
  const when = new Date(p.fetchedAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (
    <p className="m-0 pt-2 text-xs text-secondary">
      Read from GitHub {when} UTC{p.scope === "self" ? ", with your own sign-in: private work is shown to you alone" : ""}.{p.read.prsTotal > 0 ? ` Lines and partners come from the newest ${p.read.prs.toLocaleString("en-US")} of ${p.read.prsTotal.toLocaleString("en-US")} pull requests; the totals count them all.` : ""}
    </p>
  );
}
