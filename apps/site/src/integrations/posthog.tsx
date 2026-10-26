import { PostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { applyLevel, recording, startAnalytics, track, UNRECORDED, type Person } from "#/lib/analytics";
import { consentCookie, levelOf, regionById, sharedCookieDomain, type Choice, type Level, type Region } from "@commitscape/data/analytics";
import { publicEnv } from "#/lib/env";

export type AnalyticsState = { on: boolean; region: Region; choice: Choice | null; level: Level; choose: (c: Choice) => void };

const AnalyticsContext = createContext<AnalyticsState | null>(null);

/** The visitor's analytics region, choice and level, and a way to change their choice. */
export function useAnalytics(): AnalyticsState | null {
  return useContext(AnalyticsContext);
}

/** Runs PostHog for the visitor at the level their region and choice allow, and gives the page their choice. */
export function Analytics({ children, on, region: regionId, choice: chosen, level: first, person }: { children: ReactNode; on: boolean; region: string | undefined; choice: Choice | null | undefined; level: Level | undefined; person: Person | null }) {
  const region = regionById(regionId);
  const [choice, setChoice] = useState<Choice | null>(chosen ?? null);
  const level = choice ? levelOf(region, choice, false) : (first ?? region.before);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    startAnalytics(region, level, person !== null);
    applyLevel(level, person);
  }, [region, level, person]);
  useEffect(() => {
    if (!recording(level)) return;
    if (UNRECORDED.test(path)) posthog.stopSessionRecording();
    else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
  }, [path, level]);
  const choose = useCallback(
    (c: Choice) => {
      const landing = publicEnv.PUBLIC_LANDING_URL ? new URL(publicEnv.PUBLIC_LANDING_URL).hostname : null;
      document.cookie = consentCookie(c, sharedCookieDomain(window.location.hostname, landing), window.location.protocol === "https:");
      applyLevel(levelOf(region, c, false), person);
      track("analytics choice made", { choice: c, region: region.id });
      setChoice(c);
    },
    [region, person, setChoice],
  );
  const state = useMemo(() => ({ on, region, choice, level, choose }), [on, region, choice, level, choose]);
  return <AnalyticsContext value={state}>{on ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : children}</AnalyticsContext>;
}
