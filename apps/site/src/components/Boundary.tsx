import { Component, Suspense, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Locked, LockedLine } from "#/components/Locked";
import { LockedError, type Gate } from "#/lib/gates";

export type LockedAs = { title?: string; height?: number; compact?: string; hide?: boolean };

/** What a part kept for people signed in shows to everyone else: its sign-in prompt, in the size it asked for, or nothing. */
export function LockedView({ gate, as }: { gate: Gate; as?: LockedAs }) {
  if (as?.hide) return null;
  if (as?.compact) return <LockedLine gate={gate} what={as.compact} />;
  return <Locked gate={gate} title={as?.title} height={as?.height} />;
}

class Catch extends Component<{ children: ReactNode; locked?: LockedAs; quiet?: boolean; note?: string; onRetry?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const error = this.state.error;
    if (error instanceof LockedError) return <LockedView gate={error.gate} as={this.props.locked} />;
    if (error && this.props.quiet) return null;
    const retry = () => {
      this.props.onRetry?.();
      this.setState({ error: null });
    };
    if (error && this.props.note !== undefined)
      return (
        <div role="alert" className={`flex min-w-0 flex-col items-start justify-center gap-1 p-4 ${this.props.note}`}>
          <span className="type-caption text-pretty">{error.message || "This part could not be drawn."}</span>
          <button type="button" onClick={retry} className="plain-button inline-link type-caption">
            Try again
          </button>
        </div>
      );
    if (error) return <Banner status="warning" title={error.message || "This part could not be drawn."} endContent={<Button label="Try again" variant="ghost" size="sm" onClick={retry} />} />;
    return this.props.children;
  }
}

/** One slow part of a page: its skeleton until its data streams in, a sign-in prompt where it is kept for people signed in, and if it fails a banner with Try again, nothing at all (`quiet`) or, in a small slot, a short note (`note` is its classes). */
export function Section({ fallback, locked, quiet = false, note, children }: { fallback: ReactNode; locked?: LockedAs; quiet?: boolean; note?: string; children: ReactNode }) {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <Catch locked={locked} quiet={quiet} note={note} onRetry={reset}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Catch>
  );
}
