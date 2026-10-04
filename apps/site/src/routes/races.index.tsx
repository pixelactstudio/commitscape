import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Page, PageHead } from "@commitscape/ui";
import { Start } from "#/components/Start";
import { myRacesQuery } from "#/lib/queries";

export const Route = createFileRoute("/races/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(myRacesQuery()),
  head: () => ({ meta: [{ title: `Races · ${PRODUCT}` }] }),
  component: () => (
    <Page className="pb-16">
      <PageHead eyebrow="Race your friends" title="Races" description="Two or more people, the days you choose, live Standings view by view with a leader for each, and a finish Card at the end." />
      <Start kind="race" />
    </Page>
  ),
});
