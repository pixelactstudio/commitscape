import { PostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { clientEnv } from "#/lib/env";

if (typeof window !== "undefined" && clientEnv.VITE_POSTHOG_KEY) {
  posthog.init(clientEnv.VITE_POSTHOG_KEY, {
    api_host: clientEnv.VITE_POSTHOG_HOST,
    defaults: "2025-11-30",
    capture_pageview: "history_change",
    person_profiles: "identified_only",
    respect_dnt: true,
    autocapture: false,
  });
}

export function Analytics({ children }: { children: ReactNode }) {
  if (!clientEnv.VITE_POSTHOG_KEY) return <>{children}</>;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
