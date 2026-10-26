import type { Choice, Level } from "@commitscape/data/analytics";

export const SETTINGS_GLOBAL = "__COMMITSCAPE_ANALYTICS__";

export type LandingSettings = { key: string; region: string; choice: Choice | null; level: Level };
