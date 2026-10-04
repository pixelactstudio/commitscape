import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Start, StartHeading } from "#/components/Start";
import { myRacesQuery } from "#/lib/queries";

export const Route = createFileRoute("/races/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(myRacesQuery()),
  head: () => ({ meta: [{ title: `Races · ${PRODUCT}` }] }),
  component: () => (
    <div className="flex flex-col gap-5 pb-8">
      <StartHeading kind="race" />
      <Start kind="race" />
    </div>
  ),
});
