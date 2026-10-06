import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, GitMerge, Lock } from "lucide-react";
import { PRODUCT, type Wrapped } from "@commitscape/data";
import { AreaTrend, compact, Donut, Face, grouped, many, Outcomes, Page, Panel, RepoTiles, StackedColumns, Stat, TipLayer, WeekBars, WRAPPED_CALENDAR_CARD_SIZE, WRAPPED_CARD_SIZE, YearGrid, type Slice } from "@commitscape/ui";
import { Nothing, Reveal } from "@commitscape/ui/motion";
import { ICON } from "@commitscape/ui/design";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, wrappedQuery } from "#/lib/queries";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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
              <Face login={id.login} name={name} size={56} ring="var(--stage-cell-2)" />
              <span className="flex flex-col">
                <span className="type-panel">{name}</span>
                <span className="text-xs text-on-stage-2">@{id.login}'s year on GitHub</span>
              </span>
            </Link>
            <div className="flex items-center gap-1">
              {y > joined && <Button label={String(y - 1)} variant="ghost" size="sm" icon={<Icon icon={ChevronLeft} size="sm" />} href={`/u/${id.login}/wrapped/${y - 1}`} />}
              {y < THIS_YEAR && <Button label={String(y + 1)} variant="ghost" size="sm" endContent={<Icon icon={ChevronRight} size="sm" />} href={`/u/${id.login}/wrapped/${y + 1}`} />}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[clamp(5rem,18vw,12rem)] leading-[0.82] font-bold tracking-[-0.07em]">{y}</span>
            <span className="text-lg text-on-stage-2">{y === THIS_YEAR ? "So far, and still going." : "The whole year, day by day."}</span>
          </div>
          <Section fallback={<Skeleton height={36} width={360} radius={4} />}>
            <Headline login={id.login} year={y} />
          </Section>
        </Page>
      </section>
      <Page className="flex flex-col gap-gutter pt-10 pb-16">
        <Section fallback={<BodySkeleton />}>
          <Body login={id.login} year={y} name={name} origin={origin} joined={joined} />
        </Section>
      </Page>
    </TipLayer>
  );
}

function Headline({ login, year }: { login: string; year: number }) {
  const { data: w } = useSuspenseQuery(wrappedQuery(login, year));
  if (w.contributions === 0) return <p className="m-0 max-w-3xl text-2xl leading-snug font-medium text-pretty text-white">A quiet year on GitHub: nothing public to count.</p>;
  return (
    <p className="m-0 max-w-3xl text-2xl leading-snug font-medium text-pretty text-white">
      {grouped(w.contributions)} contributions on {many(w.activeDays, "day", "days")}, {grouped(w.prsMerged)} pull requests merged and {grouped(w.reviews)} reviews given{w.languages[0] ? `, mostly in ${w.languages[0].name}` : ""}.
    </p>
  );
}

function BodySkeleton() {
  return (
    <>
      <Skeleton height={36} width={240} radius={2} />
      <Skeleton height={250} radius={4} />
      <Skeleton height={230} radius={4} />
      <div className="grid gap-gutter lg:grid-cols-2">
        <Skeleton height={300} radius={4} />
        <Skeleton height={300} radius={4} />
      </div>
    </>
  );
}

const DAY = 86_400_000;
const TINTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const OTHER = "var(--other)";
const when = (iso: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });

function Body({ login, year, name, origin, joined }: { login: string; year: number; name: string; origin: string; joined: number }) {
  const { data: w } = useSuspenseQuery(wrappedQuery(login, year));
  if (w.contributions === 0)
    return (
      <Panel>
        <Nothing
          title={year < joined ? `${name} joined GitHub in ${joined}` : `Nothing public in ${year}`}
          words={year < joined ? `So ${year} has nothing to show yet.` : `GitHub shows no contributions from ${name} this year.`}
          action={<Button label={`See ${year < joined ? joined : THIS_YEAR}`} variant="secondary" href={`/u/${login}/wrapped/${year < joined ? joined : THIS_YEAR}`} />}
        />
      </Panel>
    );
  const languages = w.languages.reduce((n, l) => n + l.commits, 0);
  const busiest = w.busiest ? when(w.busiest.day) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 type-heading">The numbers</h2>
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
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
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
          <div key={i} className="min-w-0 bg-surface p-panel">
            {s}
          </div>
        ))}
      </div>
      {!w.complete && <p className="m-0 type-caption">Merged pull requests and their lines come from the pull requests read so far; the other totals are GitHub's.</p>}
      <Story w={w} year={year} />
    </>
  );
}

function Story({ w, year }: { w: Wrapped; year: number }) {
  const last = year === THIS_YEAR ? w.calendar.days.findLastIndex((n) => n > 0) + 1 : w.calendar.days.length;
  const running = w.calendar.days.slice(0, Math.max(1, last)).reduce<number[]>((list, n) => [...list, (list.at(-1) ?? 0) + n], []);
  const sum = running.at(-1) ?? 0;
  const points = running.map((total, i) => {
    const iso = new Date((w.calendar.firstDay + i) * DAY).toISOString().slice(0, 10);
    return { key: iso, label: when(iso), tick: iso.endsWith("-01") ? MONTHS[Number(iso.slice(5, 7)) - 1] : undefined, total };
  });
  const half = points.find((p) => p.total >= sum / 2);
  const mix: Slice[] = [
    { key: "commits", label: "Commits", value: w.commits, colour: "var(--s1)" },
    { key: "prs", label: "Pull requests", value: w.prsOpened, colour: "var(--s2)" },
    { key: "reviews", label: "Reviews", value: w.reviews, colour: "var(--s3)" },
    { key: "issues", label: "Issues", value: w.issues, colour: "var(--s4)" },
  ].sort((a, b) => b.value - a.value);
  const top = w.languages.slice(0, 5);
  const rest = w.languages.slice(5).reduce((n, l) => n + l.commits, 0);
  const langs: Slice[] = [...top.map((l, i) => ({ key: l.name, label: l.name, value: l.commits, colour: l.colour ?? TINTS[i] ?? OTHER })), ...(rest > 0 ? [{ key: "other", label: "Other", value: rest, colour: OTHER }] : [])];
  const opened = w.opened.merged + w.opened.closed + w.opened.open;
  const busiestMonth = w.months.indexOf(Math.max(...w.months));
  return (
    <>
      <Reveal>
        <Panel title="The year, a square a day" description={w.busiest ? `The busiest day was ${when(w.busiest.day)}, with ${many(w.busiest.contributions, "contribution", "contributions")}. The longest run lasted ${many(w.longestStreak, "day", "days")}.` : "Contributions on GitHub: commits, pull requests, reviews and issues"}>
          <YearGrid firstDay={w.calendar.firstDay} days={w.calendar.days} unit="contributions" label={`Contributions a day in ${year}`} table={false} />
        </Panel>
      </Reveal>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Reveal>
          <Months w={w} busiest={busiestMonth} />
        </Reveal>
        <Reveal delay={0.08}>
          <Panel title="How it added up" description={half ? `Half of the year's contributions were in by ${half.label}.` : "Contributions so far, day by day"}>
            <AreaTrend points={points} series={{ key: "total", label: "Contributions so far", colour: "var(--brand)" }} unit="contributions so far" height={220} title={(p) => `By ${p.label}`} />
          </Panel>
        </Reveal>
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Reveal>
          <Panel title="What it was made of" description="The year's contributions by kind, as GitHub counts them">
            <Donut slices={mix} unit="contributions" />
          </Panel>
        </Reveal>
        <Reveal delay={0.08}>
          <Panel title="Languages" description="The languages of the year's commits, by the repositories they went into">
            {langs.length > 0 ? <Donut slices={langs} unit="commits" /> : <Nothing compact title="No languages to show" words="GitHub names no language for this year's commits." />}
          </Panel>
        </Reveal>
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Reveal>
          <Panel title="The week" description="Contributions on each day of the week, all year">
            <WeekBars days={w.weekdays} />
          </Panel>
        </Reveal>
        <Reveal delay={0.08}>
          <Panel title="Pull requests" description={`What became of the pull requests opened in ${year}`}>
            {opened > 0 ? (
              <div className="flex flex-col gap-5">
                <Outcomes merged={w.opened.merged} closed={w.opened.closed} open={w.opened.open} />
                {w.biggest && <Biggest b={w.biggest} />}
              </div>
            ) : (
              <Nothing compact title="No pull requests opened" words={`None of the pull requests read so far were opened in ${year}.`} />
            )}
          </Panel>
        </Reveal>
      </div>
      {w.repositories.length > 0 ? (
        <Reveal>
          <Panel title="Where it went" description={`The repositories with most of the year's commits, sized by them${w.repositories.length > 8 ? `: the top 8 of ${w.repositories.length}` : ""}`}>
            <RepoTiles repositories={w.repositories} link={(repo) => `/gh/${repo}`} />
          </Panel>
        </Reveal>
      ) : (
        w.mergedIn.length > 0 && (
          <Reveal>
            <Panel title="Where it went" description={`The repositories with most of the year's merged pull requests, sized by them${w.mergedIn.length > 8 ? `: the top 8 of ${w.mergedIn.length}` : ""}`}>
              <RepoTiles repositories={w.mergedIn.map((r) => ({ repo: r.repo, commits: r.prs, private: r.private }))} link={(repo) => `/gh/${repo}`} unit={["pull request merged", "pull requests merged"]} />
            </Panel>
          </Reveal>
        )
      )}
    </>
  );
}

function Months({ w, busiest }: { w: Wrapped; busiest: number }) {
  const [show, setShow] = useState<"contributions" | "merges">("contributions");
  const values = show === "contributions" ? w.months : w.merges;
  const best = values.indexOf(Math.max(...values));
  return (
    <Panel
      title="Month by month"
      description={show === "contributions" ? `${MONTH_NAMES[busiest]} was the busiest month, with ${many(w.months[busiest] ?? 0, "contribution", "contributions")}.` : w.prsMerged > 0 ? `Most pull requests were merged in ${MONTH_NAMES[best]}: ${grouped(w.merges[best] ?? 0)}.` : "No pull requests merged this year."}
      actions={
        <SegmentedControl label="Show" size="sm" value={show} onChange={(v) => setShow(v as "contributions" | "merges")}>
          <SegmentedControlItem value="contributions" label="Contributions" />
          <SegmentedControlItem value="merges" label="Merged" />
        </SegmentedControl>
      }
    >
      <StackedColumns
        points={values.map((n, i) => ({ key: MONTHS[i] ?? "", label: MONTHS[i] ?? "", value: n }))}
        series={[{ key: "value", label: show === "contributions" ? "Contributions" : "Pull requests merged", colour: show === "contributions" ? "var(--brand)" : "var(--s7)" }]}
        unit={show === "contributions" ? "contributions" : "merged"}
        height={220}
      />
    </Panel>
  );
}

function Biggest({ b }: { b: NonNullable<Wrapped["biggest"]> }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line p-3">
      <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--s7)_18%,transparent)] text-[var(--s7)]">
        <GitMerge size={ICON.sm} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-caption">The biggest merged pull request</span>
        {b.private ? (
          <span className="inline-flex items-center gap-1.5 type-label">
            <Lock size={ICON.xs} aria-hidden /> In a private repository
          </span>
        ) : (
          <a href={`https://github.com/${b.repo}/pull/${b.number}`} className="type-label no-underline [overflow-wrap:anywhere] hover:underline">
            {b.title}
          </a>
        )}
        <span className="type-caption tnum">
          {b.private ? "" : `${b.repo} #${b.number} · `}
          <span className="text-added">+{compact(b.additions)}</span> <span className="text-removed">−{compact(b.deletions)}</span>
        </span>
      </div>
    </div>
  );
}
