import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Calendar, compact, Face, Figure, grouped, many, Tile, TipLayer, WRAPPED_CALENDAR_CARD_SIZE, WRAPPED_CARD_SIZE } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { CardBox } from "#/components/CardBox";
import { profileLookupQuery, wrappedQuery } from "#/lib/queries";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const Route = createFileRoute("/u/$login_/wrapped/$year")({
  loader: async ({ params, context }) => ({ lookup: await context.queryClient.ensureQueryData(profileLookupQuery(params.login)), origin: context.origin ?? "" }),
  head: ({ params, loaderData }) => ({
    meta: [
      { title: `@${params.login}'s ${params.year} on ${PRODUCT}` },
      { property: "og:title", content: `@${params.login}'s ${params.year} on GitHub` },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/u/${params.login}/wrapped/${params.year}/wrapped.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WrappedPage,
});

function WrappedPage() {
  const { year } = Route.useParams();
  const { lookup } = Route.useLoaderData();
  if (lookup.status !== "ok") return <Banner status="warning" title={lookup.status === "hidden" ? "This person has chosen to stay out, so their Wrapped is hidden." : "GitHub has no person by that name."} />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <TipLayer>
      <div className="flex flex-col gap-5 pb-8">
        <header className="wrapped-head">
          <Face login={lookup.identity.login} name={name} size={64} />
          <div className="min-w-0 flex-1">
            <Heading level={1} className="repo-title">
              <a href={`/u/${lookup.identity.login}`}>{name}</a>'s year on GitHub
            </Heading>
            <p className="repo-facts note small">
              <span>@{lookup.identity.login}</span>
              <span>
                <a href={`/u/${lookup.identity.login}/wrapped/${Number(year) - 1}`}>{Number(year) - 1}</a>
              </span>
            </p>
          </div>
          <span className="wrapped-year">{year}</span>
        </header>
        <Section fallback={<Skeleton height={900} />}>
          <Body login={lookup.identity.login} year={Number(year)} name={name} />
        </Section>
      </div>
    </TipLayer>
  );
}

function Body({ login, year, name }: { login: string; year: number; name: string }) {
  const { origin } = Route.useLoaderData();
  const { data: w } = useSuspenseQuery(wrappedQuery(login, year));
  const most = Math.max(1, ...w.months);
  const languages = w.languages.reduce((n, l) => n + l.commits, 0);
  return (
    <>
      <section className="tiles profile-tiles">
        <Tile value={grouped(w.contributions)} label="contributions" note={`on ${many(w.activeDays, "day", "days")}`} />
        <Tile value={grouped(w.prsMerged)} label="pull requests merged" note={`of ${grouped(w.prsOpened)} opened`} />
        <Tile value={grouped(w.reviews)} label="reviews given" note="on others' pull requests" />
        <Tile value={grouped(w.commits)} label="commits" note="as GitHub counts them" />
        <Tile value={`+${compact(w.linesAdded)}`} label="lines added, merged" note={`and −${compact(w.linesRemoved)} removed`} />
        <Tile value={many(w.longestStreak, "day", "days")} label="longest streak" note="of days in a row" />
        <Tile value={w.busiest ? new Date(`${w.busiest.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—"} label="busiest day" note={w.busiest ? many(w.busiest.contributions, "contribution", "contributions") : "no contributions"} />
        <Tile value={w.languages[0]?.name ?? "—"} label="most written in" note={w.languages[0] ? `${Math.round((w.languages[0].commits * 100) / Math.max(1, languages))}% of commits` : "no commits"} />
      </section>
      {!w.complete && <p className="note small">Merged pull requests and their lines come from the pull requests read so far; the totals are GitHub's.</p>}
      <Figure title="The year, a square a day" note="Contributions on GitHub: commits, pull requests, reviews and issues">
        <Calendar firstDay={w.calendar.firstDay} days={w.calendar.days} unit="contributions" quantile />
      </Figure>
      <div className="two">
        <Figure title="Month by month" note="Contributions in each month">
          <ol className="months">
            {w.months.map((n, i) => (
              <li key={MONTHS[i]}>
                <span className="months-bar" style={{ height: `${(n * 100) / most}%` }} title={`${MONTHS[i]}: ${grouped(n)} contributions`} />
                <span className="note small">{MONTHS[i]}</span>
              </li>
            ))}
          </ol>
        </Figure>
        <Figure title="Where it went" note="The repositories with most of their commits this year">
          {w.repositories.length === 0 ? (
            <p className="note">No commits this year.</p>
          ) : (
            <ol className="contributors">
              {w.repositories.map((r) => (
                <li key={r.repo}>
                  <a href={`https://github.com/${r.repo}`}>{r.repo}</a>
                  <span className="num">{many(r.commits, "commit", "commits")}</span>
                  <span />
                  <span className="note small">{r.private ? "private: only you see this" : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Figure>
      </div>
      <CardBox title="Your Wrapped Card" about="The year in one image, for a post." url={`${origin}/api/cards/u/${login}/wrapped/${year}/wrapped`} alt={`${name}'s ${year}`} link={`${origin}/u/${login}/wrapped/${year}`} share={`My ${year} on GitHub: ${grouped(w.contributions)} contributions, ${grouped(w.prsMerged)} pull requests merged.`} {...WRAPPED_CARD_SIZE} />
      <CardBox title="The year's calendar Card" about="A square a day, for a README." url={`${origin}/api/cards/u/${login}/wrapped/${year}/wrapped-calendar`} alt={`${name}'s ${year}, a square a day`} link={`${origin}/u/${login}/wrapped/${year}`} share={`My ${year} on GitHub, a square a day.`} {...WRAPPED_CALENDAR_CARD_SIZE} />
    </>
  );
}
