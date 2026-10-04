import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouteContext, type ErrorComponentProps } from "@tanstack/react-router";
import { History, Link2, Users } from "lucide-react";
import { monthName, PRODUCT, seasonDates } from "@commitscape/data";
import { Page, PageHead, Panel } from "@commitscape/ui";
import { InvitationCallout, People } from "#/components/Membership";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { PageError } from "#/components/States";
import { ThemedCard } from "#/components/ThemedCard";
import { Leaders, WindowTable } from "#/components/WindowTable";
import { people, readAt, windowClock } from "#/lib/window";
import { crewQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/crews/$id")({
  loader: async ({ params, context }) => ({ crew: await context.queryClient.ensureQueryData(crewQuery(params.id)), origin: context.origin ?? "" }),
  head: ({ loaderData, params }) => ({
    meta: [
      { title: `${loaderData?.crew.name ?? "A Crew"} · ${PRODUCT}` },
      { property: "og:title", content: loaderData?.crew.name ?? "A Crew" },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/crews/${params.id}/season.png` },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: NoCrew,
  component: CrewPage,
});

function NoCrew(props: ErrorComponentProps) {
  if (props.error instanceof Error && props.error.message.startsWith("There is no Crew")) return <Missing title="No Crew here" words="This Crew was never started, or its address is mistyped. Start one of your own, or ask whoever sent it for the link again." back={{ label: "Crews", href: "/crews" }} />;
  return <PageError {...props} />;
}

function CrewPage() {
  const { id } = Route.useParams();
  const { origin } = Route.useLoaderData();
  const { user } = useRouteContext({ from: "__root__" });
  const toast = useToast();
  const { data: crew } = useSuspenseQuery(crewQuery(id));
  const accepted = crew.members.filter((m) => m.state === "accepted").length;
  const season = seasonDates(crew.season);
  const clock = windowClock(season.from, season.to);
  const lastName = crew.last ? monthName(crew.last.from.slice(0, 7)) : "";
  const card = crew.last && crew.last.rows.length > 0 ? { id: "season", title: "The Season recap Card", about: `${lastName}: its people, view by view.`, url: `/api/cards/crews/${id}/season`, width: 720, height: 186 + Math.min(10, crew.last.rows.length) * 40, link: `/crews/${id}`, share: `${crew.name}'s Season on ${PRODUCT}.`, alt: `${crew.name}: ${lastName}` } : null;
  return (
    <Page className="flex flex-col gap-4 pb-16">
      <PageHead
        eyebrow={
          <Link to="/crews" className="inline-flex items-center gap-1.5 text-secondary no-underline hover:text-primary">
            <Users size={14} aria-hidden /> Crew
          </Link>
        }
        title={crew.name}
        description={`Compares itself every Season, a calendar month, starting again on the first · ${people(accepted)}${crew.createdBy ? ` · started by @${crew.createdBy}` : ""}`}
        actions={
          <>
            <Button label="Copy link" variant="secondary" icon={<Icon icon={Link2} size="sm" />} onClick={() => void navigator.clipboard?.writeText(`${origin}/crews/${id}`).then(() => toast("Link copied"))} />
            {card && <ShareButton choices={[card]} origin={origin} title={card.title} label="Share the recap" />}
          </>
        }
      />
      <InvitationCallout kind="crew" id={id} you={crew.you} />
      <div className="flex flex-col gap-3 rounded-[var(--radius-container)] border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-none flex-col">
          <span className="text-xs font-medium text-secondary">This Season</span>
          <span className="text-[1.6rem] leading-none font-semibold tracking-[-0.03em]">{monthName(crew.season)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <ProgressBar label="How far through the Season" isLabelHidden value={clock.day} max={clock.total} variant="success" />
        </div>
        <span className="flex-none text-sm text-secondary tnum">
          {clock.words}, day {clock.day} of {clock.total}
        </span>
      </div>
      {crew.standings && crew.standings.rows.length > 0 ? (
        <>
          <Leaders standings={crew.standings} />
          <Panel padding={0} title={`This Season: ${monthName(crew.season)}`} description={`So far this month, from GitHub; read at ${readAt(crew.standings)} and again every 15 minutes. A leader for each view, never one winner.`}>
            <div className="pb-2">
              <WindowTable standings={crew.standings} label="This Season" />
            </div>
          </Panel>
        </>
      ) : (
        <Panel>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users size={28} className="text-secondary" aria-hidden />
            <span className="font-medium">Nobody has accepted yet</span>
            <span className="max-w-md text-sm text-pretty text-secondary">This Season's Standings appear as soon as people accept: pull requests merged, reviews given, commits and contributions, each with its own leader.</span>
          </div>
        </Panel>
      )}
      <div className={`grid items-start gap-4 ${card ? "lg:grid-cols-[1fr_1.15fr]" : ""}`}>
        <People kind="crew" id={id} members={crew.members} you={crew.you} signedIn={!!user} createdBy={crew.createdBy} />
        {card && (
          <Panel title={card.title} description={`How ${lastName} ended, view by view. Post it, or put it in a README.`} actions={<ShareButton choices={[card]} origin={origin} title={card.title} label="Share the Card" variant="secondary" />}>
            <ThemedCard src={card.url} alt={card.alt} width={card.width} height={card.height} />
          </Panel>
        )}
      </div>
      {crew.last && crew.last.rows.length > 0 && (
        <Panel padding={0} title={`Last Season: ${lastName}`} description="As it ended." actions={<History size={16} className="text-secondary" aria-hidden />}>
          <div className="pb-2">
            <WindowTable standings={crew.last} label="Last Season" />
          </div>
        </Panel>
      )}
    </Page>
  );
}
