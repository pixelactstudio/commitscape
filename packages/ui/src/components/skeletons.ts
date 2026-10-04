import type { ComponentType } from "react";
import type { Screen } from "../route";
import { ActivitySkeleton, CommitsSkeleton, MapSkeleton, OverviewSkeleton, PeopleSkeleton } from "./Loading";

export const SCREEN_SKELETONS: Record<Screen, ComponentType> = {
  overview: OverviewSkeleton,
  people: PeopleSkeleton,
  activity: ActivitySkeleton,
  map: MapSkeleton,
  commits: CommitsSkeleton,
};
