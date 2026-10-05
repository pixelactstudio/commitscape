import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, BookMarked, Hourglass, Play, Trophy, UserRound } from "lucide-react";
import { FAILURE_WORDS, PRODUCT, type Lookup, type View } from "@commitscape/data";
import { avatarUrl, compact, date, hallOfFameCardSize, Leaderboard, NextUp, Page, Panel, PlaceCards, STANDING_CARD_SIZE, topLine, placesFor, viewsOf } from "@commitscape/ui";
import { Nothing } from "@commitscape/ui/motion";
import { startBuild } from "#/functions/repos";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { useHydrated } from "#/lib/hydrated";
import { lookupQuery, profileLookupQuery, running, standingsQuery } from "#/lib/queries";

export const Route = createFileRoute("/u/$login_/$owner/$repo")({
  loader: async ({ params, context }) => {
    const [lookup, repo] = await Promise.all([
      context.queryClient.ensureQueryData(profileLookupQuery(params.login)),
      context.queryClient.ensureQueryData(lookupQuery(params.owner, params.repo)).catch(() => null),
    ]);
    if (repo && repo.id !== `${params.owner}/${params.repo}`.toLowerCase()) {
      throw redirect({ to: "/u/$login/$owner/$repo", params: { login: params.login, owner: repo.owner, repo: repo.name }, replace: true });
    }
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

type Where = { login: string; owner: string; repo: string; name: string };

function PersonInRepository() {
  const { login, owner, repo } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing title="No Standing here" words="This person has chosen to stay out of comparisons." back={{ label: `${owner}/${repo}`, href: `/gh/${owner}/${repo}` }} />;
  if (lookup.status !== "ok") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name." back={{ label: `${owner}/${repo}`, href: `/gh/${owner}/${repo}` }} />;
  const where = { login: lookup.identity.login, owner, repo, name: lookup.identity.name ?? lookup.identity.login };
  return (
    <>
      <section className="face-backdrop relative overflow-hidden border-b border-line" style={{ "--face": `url(${avatarUrl(where.login, 64)})` } as CSSProperties}>
        <Page className="flex flex-col gap-6 pt-10 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <span className="relative flex-none">
              <img src={avatarUrl(where.login, 96)} alt="" width={96} height={96} className="size-[5rem] rounded-full bg-muted shadow-[0_0_0_4px_var(--color-background-body)] sm:size-[6rem]" />
              <img src={avatarUrl(owner, 48)} alt="" width={40} height={40} className="absolute -end-1 -bottom-1 size-9 rounded-lg bg-muted shadow-[0_0_0_3px_var(--color-background-body)] sm:size-10" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm text-secondary">
                <Link to="/u/$login" params={{ login: where.login }} className="font-medium text-secondary no-underline hover:text-primary">
                  {where.name}
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
                <Headline {...where} />
              </Section>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Section fallback={null}>
              <Share {...where} />
            </Section>
            <Button label="Repository" variant="secondary" icon={<Icon icon={BookMarked} size="sm" />} href={`/gh/${owner}/${repo}`} />
          </div>
        </Page>
      </section>
      <Page className="flex flex-col gap-4 py-8">
        <Section fallback={<BodySkeleton />}>
          <Standing {...where} />
        </Section>
      </Page>
    </>
  );
}

function useRepository(owner: string, repo: string): Lookup {
  return useSuspenseQuery(lookupQuery(owner, repo)).data;
}

function Headline(where: Where) {
  const found = useRepository(where.owner, where.repo);
  if (found.report) return <Place {...where} />;
  if (running(found))
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
        <Spinner size="sm" /> Reading its history now
      </span>
    );
  if (found.status !== "ok") return null;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm text-secondary">
      <Hourglass size={14} aria-hidden /> Not read by {PRODUCT} yet
    </span>
  );
}

function Place({ login, owner, repo }: Where) {
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

function Share(where: Where) {
  const found = useRepository(where.owner, where.repo);
  return found.report ? <ShareStanding {...where} /> : null;
}

function ShareStanding({ login, name, owner, repo }: Where) {
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
        { id: "hall", title: "Hall of fame", about: "The repository's people.", url: `/api/cards/gh/${owner}/${repo}/hall-of-fame`, ...hallOfFameCardSize(standings.people.length), link: `/gh/${owner}/${repo}`, share: `The people who built ${owner}/${repo}.`, alt: `The people who built ${owner}/${repo}` },
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

function Standing(where: Where) {
  const found = useRepository(where.owner, where.repo);
  if (found.report) return <Body {...where} />;
  return <NotRead found={found} {...where} />;
}

function WayOut({ login, name, owner, repo, tone = "secondary" }: Where & { tone?: "secondary" | "ghost" }) {
  return (
    <>
      <Button label={`${name}'s profile`} variant={tone} icon={<Icon icon={UserRound} size="sm" />} href={`/u/${login}`} />
      <Button label={`${owner}/${repo}`} variant={tone} icon={<Icon icon={BookMarked} size="sm" />} href={`/gh/${owner}/${repo}`} />
    </>
  );
}

const STEP_WORDS: Record<string, string> = {
  queued: "Waiting for its turn: Builds run one at a time.",
  cloning: "Fetching its history from GitHub.",
  reading: "Reading every commit, who made it, and the lines each one changed.",
  uploading: "Storing its Report.",
};

function NotRead({ found, ...where }: Where & { found: Lookup }) {
  const { owner, repo, name } = where;
  const queryClient = useQueryClient();
  const build = useMutation({
    mutationFn: () => startBuild({ data: { owner, repo } }),
    onSuccess: (next) => queryClient.setQueryData(lookupQuery(owner, repo).queryKey, next),
  });
  const full = `${owner}/${repo}`;
  const profile = <Button label={`${name}'s profile`} variant="secondary" icon={<Icon icon={UserRound} size="sm" />} href={`/u/${where.login}`} />;
  if (found.status === "not_found")
    return (
      <Boxed>
        <Nothing title={`GitHub shows no repository called ${full}`} words={`${FAILURE_WORDS.not_found} There is nothing to rank ${name} in.`} action={<Actions>{profile}</Actions>} />
      </Boxed>
    );
  if (found.status === "private")
    return (
      <Boxed>
        <Nothing title={`${full} is private`} words={FAILURE_WORDS.private} action={<Actions><WayOut {...where} /></Actions>} />
      </Boxed>
    );
  if (running(found) && found.build) return <Building build={found.build} {...where} />;
  const failed = found.build?.state === "failed" && found.build.reason ? found.build.reason : null;
  return (
    <div className="flex flex-col gap-4">
      {build.error && <Banner status="error" title={build.error.message} />}
      {failed && !found.canBuild && <Banner status={failed === "paused" ? "info" : "warning"} title={FAILURE_WORDS[failed]} />}
      <Boxed>
        <Nothing
          title={`${PRODUCT} has not read ${full} yet`}
          words={`Once its history is read, ${name}'s place in it shows here: commits, lines changed, pull requests merged, reviews and the lines of theirs that still run. Most repositories take under a minute.`}
          action={
            <Actions>
              {found.canBuild && <Button label={`Read ${full}`} variant="primary" icon={<Icon icon={Play} size="sm" />} isLoading={build.isPending} onClick={() => build.mutate()} />}
              <WayOut {...where} />
            </Actions>
          }
        />
      </Boxed>
    </div>
  );
}

function Boxed({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--radius-container)] border border-line px-4">{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-2 pt-1">{children}</div>;
}

function useSince(from: number): number | null {
  const hydrated = useHydrated();
  const [at, setAt] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setAt(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return hydrated ? Math.max(0, at - from) : null;
}

function Building({ build, ...where }: Where & { build: NonNullable<Lookup["build"]> }) {
  const { owner, repo, name } = where;
  const since = useSince(build.requestedAt);
  const step = build.state === "queued" ? "queued" : (build.step ?? "reading");
  return (
    <Panel
      title={`Reading ${owner}/${repo}`}
      description={`${name}'s place in it shows here by itself when it is done; you can leave this page open.`}
      actions={
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-line px-3 text-sm tnum" aria-live="off">
          <Spinner size="sm" />
          <span className="text-secondary">{since === null ? " " : since >= 60 ? `${Math.floor(since / 60)} min ${String(since % 60).padStart(2, "0")} s` : `${since} s`}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 flex items-center gap-2 text-sm text-primary" aria-live="polite">
          {STEP_WORDS[step] ?? STEP_WORDS.reading}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button label="Watch it on the repository page" variant="secondary" icon={<Icon icon={ArrowRight} size="sm" />} href={`/gh/${owner}/${repo}`} />
          <Button label={`${name}'s profile`} variant="ghost" icon={<Icon icon={UserRound} size="sm" />} href={`/u/${where.login}`} />
        </div>
      </div>
    </Panel>
  );
}

function Body(where: Where) {
  const { login, owner, repo, name } = where;
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
        <Boxed>
          <Nothing
            compact
            title={`${name} has no commits, pull requests or reviews in ${standings.repo.owner}/${standings.repo.name} that ${PRODUCT} has read`}
            words={`Read ${date(standings.repo.builtAt)}. Commits are tied to @${login} through the email GitHub knows for them; ones made under another email show under that name below.`}
            action={
              <Actions>
                <WayOut {...where} tone="ghost" />
              </Actions>
            }
          />
        </Boxed>
      )}
      {standings.people.length > 0 && <Leaderboard standings={standings} focus={login} view={view} onView={setView} />}
    </>
  );
}
