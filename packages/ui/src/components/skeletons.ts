import type { ComponentType } from "react";
import type { Screen } from "../route";
import { ActivitySkeleton } from "../screens/Activity";
import { BranchesSkeleton } from "../screens/Branches";
import { CodeSkeleton } from "../screens/Code";
import { CommitsLoading } from "../screens/Commits";
import { MapSkeleton } from "../screens/Map";
import { OverviewSkeleton } from "../screens/Overview";
import { PeopleSkeleton } from "../screens/People";
import { PullsSkeleton } from "../screens/Pulls";
import { UniverseSkeleton } from "../screens/Universe";

export const SCREEN_SKELETONS: Record<Screen, ComponentType> = {
  overview: OverviewSkeleton,
  people: PeopleSkeleton,
  activity: ActivitySkeleton,
  map: MapSkeleton,
  universe: UniverseSkeleton,
  commits: CommitsLoading,
  code: CodeSkeleton,
  branches: BranchesSkeleton,
  pulls: PullsSkeleton,
};
