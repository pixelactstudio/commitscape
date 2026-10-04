import { useState, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookMarked, Trophy } from "lucide-react";
import { PRODUCT, type View } from "@commitscape/data";
import { avatarUrl, compact, date, Leaderboard, NextUp, Page, PlaceCards, STANDING_CARD_SIZE, topLine, placesFor, viewsOf } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, standingsQuery } from "#/lib/queries";

export const Route = createFileRoute("/u/$login_/$owner/$repo")({
  loader: async ({ params, context }) => {
    const lookup = await context.queryClient.ensureQueryData(profileLookupQuery(params.login));
    return { lookup, origin: context.origin ?? "" };
  },
  head: ({ loaderData, params }) => {
    const identity = loaderData?.lookup && "identity" in loaderData.lookup ? loaderData.lookup.identity : undefined;
    const title = `${identity?.name ?? params.login} in ${params.owner}/${params.repo} · ${PRODUCT}`;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:url", content: `${loaderData?.origin ?? ""}/u/${params.login}/${params.owner}/${params.repo}` },
        { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/u/${params.login}/${params.owner}/${params.repo}/standing.png` },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: PersonInRepository,
});

function PersonInRepository() {
  const { login, owner, repo } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing title="No Standing here" words="This person has chosen to stay out of comparisons." back={{ label: `${owner}/${repo}`, href: `/gh/${owner}/${repo}` }} />;
  if (lookup.status !== "ok") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name." back={{ label: `${owner}/${repo}`, href: `/gh/${owner}/${repo}` }} />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <>
      <section className="face-backdrop relative overflow-hidden border-b border-line" style={{ "--face": `url(${avatarUrl(lookup.identity.login, 64)})` } as CSSProperties}>
        <Page className="flex flex-col gap-6 pt-10 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <span className="relative flex-none">
              <img src={avatarUrl(lookup.identity.login, 96)} alt="" width={96} height={96} className="size-[5rem] rounded-full bg-muted shadow-[0_0_0_4px_var(--color-background-body)] sm:size-[6rem]" />
              <img src={avatarUrl(owner, 48)} alt="" width={40} height={40} className="absolute -end-1 -bottom-1 size-9 rounded-lg bg-muted shadow-[0_0_0_3px_var(--color-background-body)] sm:size-10" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm text-secondary">
                <Link to="/u/$login" params={{ login: lookup.identity.login }} className="font-medium text-secondary no-underline hover:text-primary">
                  {name}
                </Link>{" "}
                in
              </span>
              <h1 className="m-0 truncate text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.035em]">
                <Link to="/gh/$owner/$repo" params={{ owner, repo }} className="text-primary no-underline hover:underline">
                  <span className="text-secondary">{owner}/</span>
                  {repo}
                </Link>
              </h1>
              <Section fallback={<Skeleton height={26} width={300} radius={4} />}>
                <Headline login={lookup.identity.login} owner={owner} repo={repo} />
              </Section>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Section fallback={null}>
              <Share login={lookup.identity.login} name={name} owner={owner} repo={repo} />
            </Section>
            <Button label="Repository" variant="secondary" icon={<Icon icon={BookMarked} size="sm" />} href={`/gh/${owner}/${repo}`} />
          </div>
        </Page>
      </section>
      <Page className="flex flex-col gap-4 py-8">
        <Section fallback={<BodySkeleton />}>
          <Body login={lookup.identity.login} owner={owner} repo={repo} name={name} />
        </Section>
      </Page>
    </>
  );
}

function Headline({ login, owner, repo }: { login: string; owner: string; repo: string }) {
  const { data: standings } = useSuspenseQuery(standingsQuery(owner, repo, login));
  const row = standings.people.find((r) => r.login?.toLowerCase() === login.toLowerCase());
  const top = row ? topLine(standings, placesFor(standings, row.key)) : null;
  if (!top) return null;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
      <Trophy size={14} aria-hidden /> {top}
    </span>
  );
}

function Share({ login, name, owner, repo }: { login: string; name: string; owner: string; repo: string }) {
  const { origin } = Route.useLoaderData();
  const { data: standings } = useSuspenseQuery(standingsQuery(owner, repo, login));
  const row = standings.people.find((r) => r.login?.toLowerCase() === login.toLowerCase());
  if (!row || standings.repo.private) return null;
  return (
    <ShareButton
      origin={origin}
      title="Share where they stand"
      choices={[
        { id: "standing", title: "Standing", about: "Their place in each view.", url: `/api/cards/u/${login}/${owner}/${repo}/standing`, ...STANDING_CARD_SIZE, link: `/u/${login}/${owner}/${repo}`, share: `Where I stand in ${owner}/${repo}.`, alt: `${name} in ${owner}/${repo}` },
        { id: "hall", title: "Hall of fame", about: "The repository's people.", url: `/api/cards/gh/${owner}/${repo}/hall-of-fame`, width: 720, height: 150 + Math.min(10, standings.people.length) * 40, link: `/gh/${owner}/${repo}`, share: `The people who built ${owner}/${repo}.`, alt: `The people who built ${owner}/${repo}` },
      ]}
    />
  );
}

function BodySkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={150} index={i} radius={4} />
        ))}
      </div>
      <Skeleton height={72} radius={4} />
      <Skeleton height={20 * 53 + 120} radius={4} />
    </>
  );
}

function Body({ login, owner, repo, name }: { login: string; owner: string; repo: string; name: string }) {
  const { data: standings } = useSuspenseQuery(standingsQuery(owner, repo, login));
  const row = standings.people.find((r) => r.login?.toLowerCase() === login.toLowerCase());
  const [view, setView] = useState<View>(() => viewsOf(standings)[0]?.id ?? "commits");
  return (
    <>
      {row ? (
        <>
          <PlaceCards standings={standings} row={row} />
          <NextUp standings={standings} row={row} view={view} />
          <p className="m-0 text-xs text-secondary">
            {row.first ? `First commit ${date(row.first)}, last ${date(row.last ?? row.first)}. ` : ""}
            {row.linesAdded !== null ? `+${compact(row.linesAdded)} −${compact(row.linesRemoved ?? 0)} lines changed, lockfiles, generated files and bulk commits left out.` : ""}
          </p>
        </>
      ) : (
        <div className="rounded-[var(--radius-container)] border border-dashed border-line px-5 py-8 text-center text-sm text-secondary">
          {name} has no commits, pull requests or reviews in {owner}/{repo} that commitscape has read.
        </div>
      )}
      <Leaderboard standings={standings} focus={login} view={view} onView={setView} />
    </>
  );
}
