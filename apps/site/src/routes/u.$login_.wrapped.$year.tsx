import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { PRODUCT, type Wrapped } from "@commitscape/data";
import { avatarUrl, compact, grouped, many, Page, Panel, StackedColumns, Stat, TipLayer, WRAPPED_CALENDAR_CARD_SIZE, WRAPPED_CARD_SIZE, YearGrid } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, wrappedQuery } from "#/lib/queries";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const THIS_YEAR = new Date().getUTCFullYear();

export const Route = createFileRoute("/u/$login_/wrapped/$year")({
  loader: async ({ params, context }) => ({ lookup: await context.queryClient.ensureQueryData(profileLookupQuery(params.login)), origin: context.origin ?? "" }),
  head: ({ params, loaderData }) => ({
    meta: [
      { title: `@${params.login}'s ${params.year} · ${PRODUCT}` },
      { property: "og:title", content: `@${params.login}'s ${params.year} on GitHub` },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/u/${params.login}/wrapped/${params.year}/wrapped.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WrappedPage,
});

function WrappedPage() {
  const { year } = Route.useParams();
  const { lookup, origin } = Route.useLoaderData();
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2008 || y > THIS_YEAR) return <Missing title="No such year" words={`Wrapped covers the years from 2008 to ${THIS_YEAR}.`} />;
  if (lookup.status === "hidden") return <Missing title="This Wrapped is hidden" words="This person has chosen to stay out, so their Wrapped is hidden." />;
  if (lookup.status !== "ok") return <Missing title="No one by that name" words="GitHub has no person by that name." />;
  const id = lookup.identity;
  const name = id.name ?? id.login;
  const joined = new Date(id.createdAt).getUTCFullYear();
  return (
    <TipLayer>
      <section className="wrapped-hero relative overflow-hidden border-b border-line text-white">
        <Page className="relative flex flex-col gap-8 pt-10 pb-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link to="/u/$login" params={{ login: id.login }} className="flex items-center gap-3 text-white no-underline">
              <img src={avatarUrl(id.login, 56)} alt="" width={56} height={56} className="size-14 rounded-full shadow-[0_0_0_3px_rgb(255_255_255/0.25)]" />
              <span className="flex flex-col">
                <span className="text-lg font-semibold">{name}</span>
                <span className="text-sm text-white/70">@{id.login}'s year on GitHub</span>
              </span>
            </Link>
            <div className="flex items-center gap-1">
              {y > joined && <Button label={String(y - 1)} variant="ghost" size="sm" icon={<Icon icon={ChevronLeft} size="sm" />} href={`/u/${id.login}/wrapped/${y - 1}`} />}
              {y < THIS_YEAR && <Button label={String(y + 1)} variant="ghost" size="sm" endContent={<Icon icon={ChevronRight} size="sm" />} href={`/u/${id.login}/wrapped/${y + 1}`} />}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[clamp(5rem,18vw,12rem)] leading-[0.82] font-bold tracking-[-0.07em]">{y}</span>
            <span className="text-lg text-white/80">{y === THIS_YEAR ? "So far, and still going." : "The whole year, day by day."}</span>
          </div>
          <Section fallback={<Skeleton height={36} width={360} radius={4} />}>
            <Headline login={id.login} year={y} />
          </Section>
        </Page>
      </section>
      <Page className="flex flex-col gap-4 py-8">
        <Section fallback={<BodySkeleton />}>
          <Body login={id.login} year={y} name={name} origin={origin} />
        </Section>
      </Page>
    </TipLayer>
  );
}

function Headline({ login, year }: { login: string; year: number }) {
  const { data: w } = useSuspenseQuery(wrappedQuery(login, year));
  return (
    <p className="m-0 max-w-3xl text-[clamp(1.2rem,2.4vw,1.6rem)] leading-snug font-medium text-pretty text-white">
      {grouped(w.contributions)} contributions on {many(w.activeDays, "day", "days")}, {grouped(w.prsMerged)} pull requests merged and {grouped(w.reviews)} reviews given{w.languages[0] ? `, mostly in ${w.languages[0].name}` : ""}.
    </p>
  );
}

function BodySkeleton() {
  return (
    <>
      <Skeleton height={230} radius={4} />
      <Skeleton height={250} radius={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton height={300} radius={4} />
        <Skeleton height={300} radius={4} />
      </div>
    </>
  );
}

function Body({ login, year, name, origin }: { login: string; year: number; name: string; origin: string }) {
  const { data: w } = useSuspenseQuery(wrappedQuery(login, year));
  const languages = w.languages.reduce((n, l) => n + l.commits, 0);
  const busiest = w.busiest ? new Date(`${w.busiest.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold tracking-tight">The numbers</h2>
        <ShareButton
          origin={origin}
          label="Share my year"
          title={`Share ${name}'s ${year}`}
          choices={[
            { id: "wrapped", title: "Wrapped", about: "The year in one image.", url: `/api/cards/u/${login}/wrapped/${year}/wrapped`, ...WRAPPED_CARD_SIZE, link: `/u/${login}/wrapped/${year}`, share: `My ${year} on GitHub: ${grouped(w.contributions)} contributions, ${grouped(w.prsMerged)} pull requests merged.`, alt: `${name}'s ${year}` },
            { id: "wrapped-calendar", title: "The year's calendar", about: "A square a day.", url: `/api/cards/u/${login}/wrapped/${year}/wrapped-calendar`, ...WRAPPED_CALENDAR_CARD_SIZE, link: `/u/${login}/wrapped/${year}`, share: `My ${year} on GitHub, a square a day.`, alt: `${name}'s ${year}, a square a day` },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-container)] border border-line bg-[var(--color-border)] lg:grid-cols-4">
        {[
          <Stat key="c" size="lg" tone="brand" value={grouped(w.contributions)} label="Contributions" note={`on ${many(w.activeDays, "day", "days")}`} />,
          <Stat key="p" size="lg" value={grouped(w.prsMerged)} label="Pull requests merged" note={`of ${grouped(w.prsOpened)} opened`} />,
          <Stat key="r" size="lg" value={grouped(w.reviews)} label="Reviews given" note="on others' pull requests" />,
          <Stat key="m" size="lg" value={grouped(w.commits)} label="Commits" note="as GitHub counts them" />,
          <Stat key="l" size="md" value={`+${compact(w.linesAdded)}`} label="Lines added, merged" note={`and −${compact(w.linesRemoved)} removed`} />,
          <Stat key="s" size="md" value={many(w.longestStreak, "day", "days")} label="Longest streak" note="days in a row" />,
          <Stat key="b" size="md" value={busiest ?? "—"} label="Busiest day" note={w.busiest ? many(w.busiest.contributions, "contribution", "contributions") : "no contributions"} />,
          <Stat key="g" size="md" value={w.languages[0]?.name ?? "—"} label="Most written in" note={w.languages[0] ? `${Math.round((w.languages[0].commits * 100) / Math.max(1, languages))}% of commits` : "no commits"} />,
        ].map((s, i) => (
          <div key={i} className="bg-surface px-5 py-5">
            {s}
          </div>
        ))}
      </div>
      {!w.complete && <p className="m-0 text-xs text-secondary">Merged pull requests and their lines come from the pull requests read so far; the other totals are GitHub's.</p>}
      <Panel title="The year, a square a day" description="Contributions on GitHub: commits, pull requests, reviews and issues">
        <YearGrid firstDay={w.calendar.firstDay} days={w.calendar.days} unit="contributions" label={`Contributions a day in ${year}`} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Month by month" description="Contributions in each month">
          <StackedColumns points={w.months.map((n, i) => ({ key: MONTHS[i] ?? "", label: MONTHS[i] ?? "", contributions: n }))} series={[{ key: "contributions", label: "Contributions", colour: "var(--brand)" }]} unit="contributions" height={220} />
        </Panel>
        <Panel title="Where it went" description="The repositories with most of their commits this year">
          <Repositories w={w} />
        </Panel>
      </div>
    </>
  );
}

function Repositories({ w }: { w: Wrapped }) {
  if (w.repositories.length === 0) return <p className="m-0 py-8 text-center text-sm text-secondary">No commits this year.</p>;
  const most = Math.max(1, ...w.repositories.map((r) => r.commits));
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {w.repositories.slice(0, 8).map((r) => (
        <li key={r.repo} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            {r.private ? (
              <span className="inline-flex items-center gap-1.5 text-secondary">
                <Lock size={12} /> {r.repo || "a private repository"}
              </span>
            ) : (
              <Link to="/gh/$owner/$repo" params={{ owner: r.repo.split("/")[0] ?? "", repo: r.repo.split("/")[1] ?? "" }} className="truncate font-medium text-primary no-underline hover:underline">
                {r.repo}
              </Link>
            )}
            <span className="flex-none text-xs text-secondary tnum">{many(r.commits, "commit", "commits")}</span>
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--color-track)]">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.commits * 100) / most}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
