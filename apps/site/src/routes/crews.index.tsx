import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Start, StartHeading } from "#/components/Start";
import { myRacesQuery } from "#/lib/queries";

export const Route = createFileRoute("/crews/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(myRacesQuery()),
  head: () => ({ meta: [{ title: `Crews · ${PRODUCT}` }] }),
  component: () => (
    <div className="flex flex-col gap-5 pb-8">
      <StartHeading kind="crew" />
      <Start kind="crew" />
    </div>
  ),
});
