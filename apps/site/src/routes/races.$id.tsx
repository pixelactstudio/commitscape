import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Figure } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { CardBox } from "#/components/CardBox";
import { Membership } from "#/components/Membership";
import { WindowTable } from "#/components/WindowTable";
import { raceQuery } from "#/lib/queries";

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
  component: RacePage,
});

const STATE = { upcoming: "not started", running: "running", finished: "finished" } as const;

function RacePage() {
  const { id } = Route.useParams();
  const { origin } = Route.useLoaderData();
  const { user } = useRouteContext({ from: "__root__" });
  const { data: race } = useSuspenseQuery(raceQuery(id));
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            {race.name}
          </Heading>
          <p className="repo-facts note small">
            <span>
              A Race from {race.from} to {race.to}
            </span>
            <Badge label={STATE[race.state]} variant={race.state === "running" ? "info" : "neutral"} />
          </p>
        </div>
      </header>
      <Membership kind="race" id={id} members={race.members} you={race.you} signedIn={!!user} />
      <Section fallback={<Skeleton height={300} />}>
        <Figure title="Standings" note={race.standings ? `Over the Race's days, from GitHub; read ${new Date(race.standings.at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC and again every 15 minutes. A leader for each view, never one winner.` : "The Standings start on the Race's first day."}>
          {race.standings ? <WindowTable standings={race.standings} /> : <p className="note">Not started yet.</p>}
        </Figure>
      </Section>
      {race.standings && (
        <CardBox title={race.state === "finished" ? "The finish Card" : "The Race Card"} about="Its people, view by view." url={`${origin}/api/cards/races/${id}/race`} alt={race.name} link={`${origin}/races/${id}`} share={`${race.name}: a commitscape Race.`} width={720} height={186 + Math.min(10, race.standings.rows.length) * 40} />
      )}
    </div>
  );
}
