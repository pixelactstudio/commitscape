import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Page, PageHead } from "@commitscape/ui";
import { Start } from "#/components/Start";
import { myRacesQuery } from "#/lib/queries";

export const Route = createFileRoute("/crews/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(myRacesQuery()),
  head: () => ({ meta: [{ title: `Crews · ${PRODUCT}` }] }),
  component: () => (
    <Page className="pb-16">
      <PageHead eyebrow="Every month, together" title="Crews" description="Friends or a team who compare themselves each Season, a calendar month, with a recap Card when it ends." />
      <Start kind="crew" />
    </Page>
  ),
});
