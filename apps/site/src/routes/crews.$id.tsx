import { Heading } from "@astryxdesign/core/Heading";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { monthName, PRODUCT } from "@commitscape/data";
import { Figure } from "@commitscape/ui";
import { CardBox } from "#/components/CardBox";
import { Membership } from "#/components/Membership";
import { WindowTable } from "#/components/WindowTable";
import { crewQuery } from "#/lib/queries";

export const Route = createFileRoute("/crews/$id")({
  loader: async ({ params, context }) => ({ crew: await context.queryClient.ensureQueryData(crewQuery(params.id)), origin: context.origin ?? "" }),
  head: ({ loaderData, params }) => ({
    meta: [
      { title: `${loaderData?.crew.name ?? "A Crew"} · ${PRODUCT}` },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/crews/${params.id}/season.png` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CrewPage,
});

function CrewPage() {
  const { id } = Route.useParams();
  const { origin } = Route.useLoaderData();
  const { user } = useRouteContext({ from: "__root__" });
  const { data: crew } = useSuspenseQuery(crewQuery(id));
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            {crew.name}
          </Heading>
          <p className="repo-facts note small">
            <span>A Crew: its people compare themselves each Season, a calendar month, starting again on the first.</span>
          </p>
        </div>
      </header>
      <Membership kind="crew" id={id} members={crew.members} you={crew.you} signedIn={!!user} />
      <Figure title={`This Season: ${monthName(crew.season)}`} note="So far this month, from GitHub, every 15 minutes. A leader for each view, never one winner.">
        {crew.standings && crew.standings.rows.length > 0 ? <WindowTable standings={crew.standings} /> : <p className="note">Nobody has accepted yet.</p>}
      </Figure>
      {crew.last && crew.last.rows.length > 0 && (
        <>
          <Figure title={`Last Season: ${monthName(crew.last.from.slice(0, 7))}`} note="As it ended.">
            <WindowTable standings={crew.last} />
          </Figure>
          <CardBox title="The Season recap Card" about="Last Season's people, view by view." url={`${origin}/api/cards/crews/${id}/season`} alt={`${crew.name}: last Season`} link={`${origin}/crews/${id}`} share={`${crew.name}'s Season on commitscape.`} width={720} height={186 + Math.min(10, crew.last.rows.length) * 40} />
        </>
      )}
    </div>
  );
}
