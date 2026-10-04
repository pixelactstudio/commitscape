import { useEffect } from "react";
import * as Sentry from "@sentry/tanstackstart-react";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlert, Compass } from "lucide-react";
import { Page } from "@commitscape/ui";
import { Lookup } from "#/components/Lookup";

/** What a page shows while its data is on its way: the shape of a page header and its first panels. */
export function PageSkeleton() {
  return (
    <Page className="flex flex-col gap-6 py-10">
      <div className="flex items-center gap-4">
        <Skeleton width={72} height={72} radius="rounded" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton height={30} width="34%" radius={2} />
          <Skeleton height={14} width="52%" radius={1} />
        </div>
      </div>
      <Skeleton height={190} radius={4} index={1} />
      <Skeleton height={260} radius={4} index={2} />
    </Page>
  );
}

/** A page that failed: what went wrong, and a way to try again. */
export function PageError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  const words = (error instanceof Error && error.message) || "The Site could not answer.";
  return (
    <Page width="narrow" className="py-20">
      <EmptyState
        title="Something went wrong"
        description={words}
        headingLevel={1}
        icon={<CircleAlert size={32} />}
        actions={
          <>
            <Button label="Try again" variant="primary" onClick={reset} />
            <Button label="Home" variant="secondary" href="/" />
          </>
        }
      />
    </Page>
  );
}

/** An address with no page behind it. */
export function NotFound() {
  return (
    <Page width="narrow" className="flex flex-col items-center gap-8 py-20">
      <EmptyState title="Nothing here" description="There is no page at this address. Look someone up instead." headingLevel={1} icon={<Compass size={32} />} />
      <div className="w-full max-w-lg">
        <Lookup label="Look" />
      </div>
    </Page>
  );
}
