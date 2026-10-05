import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Closing } from "#/home/Closing";
import { Features } from "#/home/Features";
import { Hero } from "#/home/Hero";
import { Install } from "#/home/Install";
import { Rails } from "#/home/layout";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: `${PRODUCT}: what you have built, in numbers worth sharing` }] }),
  component: Landing,
});

function Landing() {
  return (
    <Rails>
      <Hero />
      <Features />
      <Install />
      <Closing />
    </Rails>
  );
}
