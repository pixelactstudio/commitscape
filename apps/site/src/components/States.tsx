import { useEffect } from "react";
import * as Sentry from "@sentry/tanstackstart-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { LinesSkeleton, ScreenSkeleton } from "@commitscape/ui";
import { Frame } from "./Frame";

export function PageSkeleton() {
  return (
    <Frame>
      <section className="flex flex-col gap-4 py-12">
        <Skeleton height={36} width="40%" radius={2} />
        <LinesSkeleton lines={4} />
      </section>
    </Frame>
  );
}

export function RepoSkeleton() {
  return (
    <Frame>
      <section className="flex flex-col gap-6 py-8">
        <Skeleton height={36} width="30%" radius={2} />
        <ScreenSkeleton />
      </section>
    </Frame>
  );
}

export function PageError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <Frame>
      <section className="flex flex-col items-start gap-4 py-12">
        <Heading level={1}>Something went wrong</Heading>
        <Banner status="error" title={(error instanceof Error && error.message) || "The Site could not answer."} />
        <Button label="Try again" variant="secondary" onClick={reset} />
      </section>
    </Frame>
  );
}

export function NotFound() {
  return (
    <Frame>
      <section className="flex flex-col items-start gap-4 py-12">
        <Heading level={1}>Nothing here</Heading>
        <p className="note">There is no page at this address.</p>
        <Button label="Home" variant="secondary" href="/" />
      </section>
    </Frame>
  );
}
