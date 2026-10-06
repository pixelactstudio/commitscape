import { Component, Suspense, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Banner status="warning" title={this.state.error.message || "This part could not be drawn."} />;
    return this.props.children;
  }
}

/** One slow part of a page: its skeleton until its data streams in, and a plain message if it fails. */
export function Section({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <Catch>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Catch>
  );
}
