import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouteContext, type ErrorComponentProps } from "@tanstack/react-router";
import { CalendarClock, Flag, Link2 } from "lucide-react";
import { PRODUCT, type RaceView } from "@commitscape/data";
import { Page, PageHead, Panel, periodWords } from "@commitscape/ui";
import { InvitationCallout, People } from "#/components/Membership";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { PageError } from "#/components/States";
import { ThemedCard } from "#/components/ThemedCard";
import { Leaders, StateBadge, WindowTable } from "#/components/WindowTable";
import { people, readAt, windowClock } from "#/lib/window";
import { raceQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/races/$id")({
  loader: async ({ params, context }) => ({ race: await context.queryClient.ensureQueryData(raceQuery(params.id)), origin: context.origin ?? "" }),
  head: ({ loaderData, params }) => ({
    meta: [
      { title: `${loaderData?.race.name ?? "A Race"} · ${PRODUCT}` },
      { property: "og:title", content: loaderData?.race.name ?? "A Race" },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/races/${params.id}/race.png` },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: NoRace,
  component: RacePage,
});

function NoRace(props: ErrorComponentProps) {
  if (props.error instanceof Error && props.error.message.startsWith("There is no Race")) return <Missing title="No Race here" words="This Race was never started, or its address is mistyped. Start one of your own, or ask whoever sent it for the link again." back={{ label: "Races", href: "/races" }} />;
  return <PageError {...props} />;
}

const cardHeight = (rows: number) => 186 + Math.min(10, rows) * 40;

function RacePage() {
  const { id } = Route.useParams();
  const { origin } = Route.useLoaderData();
  const { user } = useRouteContext({ from: "__root__" });
  const toast = useToast();
  const { data: race } = useSuspenseQuery(raceQuery(id));
  const accepted = race.members.filter((m) => m.state === "accepted").length;
  const card = race.standings && race.standings.rows.length > 0 ? { id: "race", title: race.state === "finished" ? "The finish Card" : "The Race Card", about: "Its people, view by view, with a leader for each.", url: `/api/cards/races/${id}/race`, width: 720, height: cardHeight(race.standings.rows.length), link: `/races/${id}`, share: `${race.name}: a ${PRODUCT} Race.`, alt: race.name } : null;
  return (
    <Page className="flex flex-col gap-4 pb-16">
      <PageHead
        eyebrow={
          <span className="flex flex-wrap items-center gap-2.5">
            <Link to="/races" className="inline-flex items-center gap-1.5 text-secondary no-underline hover:text-primary">
              <Flag size={14} aria-hidden /> Race
            </Link>
            <StateBadge state={race.state} />
          </span>
        }
        title={race.name}
        description={`${periodWords(race.from, race.to)} · ${people(accepted)}${race.createdBy ? ` · started by @${race.createdBy}` : ""}`}
        actions={
          <>
            <Button label="Copy link" variant="secondary" icon={<Icon icon={Link2} size="sm" />} onClick={() => void navigator.clipboard?.writeText(`${origin}/races/${id}`).then(() => toast("Link copied"))} />
            {card && <ShareButton choices={[card]} origin={origin} title={card.title} />}
          </>
        }
      />
      <InvitationCallout kind="race" id={id} you={race.you} />
      <Clock race={race} />
      {race.standings && race.standings.rows.length > 0 ? (
        <>
          <Leaders standings={race.standings} />
          <Panel padding={0} title="Standings" description={`Over the Race's days, from GitHub; read at ${readAt(race.standings)} and again every 15 minutes. A leader for each view, never one winner.`}>
            <div className="pb-2">
              <WindowTable standings={race.standings} />
            </div>
          </Panel>
        </>
      ) : (
        <Panel>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CalendarClock size={28} className="text-secondary" aria-hidden />
            <span className="font-medium">{race.state === "upcoming" ? "The Standings start on the Race's first day" : "Nobody has accepted yet"}</span>
            <span className="max-w-md text-sm text-pretty text-secondary">Each view gets its own leader: pull requests merged, reviews given, commits and contributions, from GitHub, over the Race's days only.</span>
          </div>
        </Panel>
      )}
      <div className={`grid items-start gap-4 ${card ? "lg:grid-cols-[1fr_1.15fr]" : ""}`}>
        <People kind="race" id={id} members={race.members} you={race.you} signedIn={!!user} createdBy={race.createdBy} />
        {card && (
          <Panel title={card.title} description={race.state === "finished" ? "How it ended, view by view. Post it, or put it in a README." : "The Race so far, as an image. It follows the Standings until the last day."} actions={<ShareButton choices={[card]} origin={origin} title={card.title} label="Share the Card" variant="secondary" />}>
            <ThemedCard src={card.url} alt={card.alt} width={card.width} height={card.height} />
          </Panel>
        )}
      </div>
    </Page>
  );
}

function Clock({ race }: { race: RaceView }) {
  const c = windowClock(race.from, race.to);
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-container)] border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex flex-none items-baseline gap-3">
        <span className="text-[1.6rem] leading-none font-semibold tracking-[-0.03em]">{c.words}</span>
        {race.state === "running" && <span className="text-sm text-secondary tnum">day {c.day} of {c.total}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <ProgressBar label="How far through the Race" isLabelHidden value={c.day} max={c.total} variant={race.state === "finished" ? "neutral" : "success"} />
      </div>
      <span className="flex-none text-sm text-secondary tnum">{c.total === 1 ? "1 day" : `${c.total} days`} in all</span>
    </div>
  );
}
