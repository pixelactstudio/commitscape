import { useEffect } from "react";
import * as Sentry from "@sentry/tanstackstart-react";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { Page } from "@commitscape/ui";
import { Lookup } from "#/components/Lookup";
import { Notice } from "#/components/Notice";

/** What a page shows while its data is on its way: the shape of a page header and its first panels. */
export function PageSkeleton() {
  return (
    <Page className="flex flex-col gap-gutter pt-page-top pb-section">
      <div className="flex flex-col gap-3 pb-3">
        <Skeleton height={32} width={280} radius={2} />
        <Skeleton height={16} width="min(34rem, 80%)" radius={1} index={1} />
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
    <Notice
      eyebrow="Error"
      title="Something went wrong"
      words={words}
      actions={
        <>
          <Button label="Try again" variant="primary" onClick={reset} />
          <Button label="Go home" variant="secondary" href="/" />
        </>
      }
    />
  );
}

/** An address with no page behind it, with the answer git would give. */
export function NotFound() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Notice
      eyebrow="404"
      title="There is no page at this address"
      words="It may have moved, or the address may have a typo. Look someone up, or go on from here."
      ways
      aside={
        <div aria-hidden className="terminal hidden overflow-hidden rounded-xl border border-line shadow-lg lg:block">
          <div className="flex items-center gap-1.5 border-b terminal-line px-4 py-2.5">
            {["close", "min", "max"].map((c) => (
              <span key={c} className={`terminal-${c} size-2.5 rounded-full`} />
            ))}
            <span className="terminal-dim ms-3 text-2xs">~/commitscape</span>
          </div>
          <div className="flex flex-col gap-2 p-5 font-mono text-sm leading-relaxed [overflow-wrap:anywhere]">
            <div>
              <span className="terminal-go">$ </span>
              <span>git show {path}</span>
            </div>
            <div className="terminal-soft">fatal: ambiguous argument '{path}': unknown revision or path not in the working tree.</div>
            <div>
              <span className="terminal-go">$ </span>
              <span className="terminal-caret" />
            </div>
          </div>
        </div>
      }
    >
      <code className="mono w-fit max-w-full rounded-md border border-line bg-sunken px-2.5 py-1 type-caption text-primary [overflow-wrap:anywhere] lg:hidden">{path}</code>
      <div className="w-full max-w-lg pt-1">
        <Lookup label="Look" />
      </div>
    </Notice>
  );
}
