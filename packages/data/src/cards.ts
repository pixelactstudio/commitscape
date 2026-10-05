import type { Identity, ProfileRepo, ProfileTotals, ProfileYear } from "./profile";
import type { WindowRow } from "./races";
import type { Place } from "./standings";
import type { Achievement, Archetype } from "./traits";
import type { Wrapped } from "./wrapped";
import type { VersusRow, VersusSide } from "./versus";

export type CardKind = "totals" | "repositories" | "survival" | "calendar" | "languages" | "standing" | "hall-of-fame" | "preview" | "versus" | "archetype" | "achievement" | "race" | "season" | "wrapped" | "wrapped-calendar";

export type ProfileCardData = {
  identity: Pick<Identity, "login" | "name">;
  totals: ProfileTotals;
  repositories: ProfileRepo[];
  years: ProfileYear[];
  calendar: { firstDay: number; days: number[] };
  engine: { surviving: number; added: number | null; repositories: number } | null;
  at: number;
};

export type StandingCardData = {
  identity: Pick<Identity, "login" | "name">;
  repo: { owner: string; name: string };
  places: Place[];
  people: number;
  top: string | null;
  numbers: { surviving: number | null; prsMerged: number | null; reviews: number | null; commits: number | null };
};

export type HallOfFameData = {
  repo: { owner: string; name: string; stars: number; forks?: number | null; description?: string | null; language?: string | null };
  people: { login: string | null; name: string; surviving: number | null; prsMerged: number | null; commits: number | null }[];
  total: number;
};

export type CardImages = Record<string, string>;

export type VersusCardData = { a: Pick<VersusSide, "identity">; b: Pick<VersusSide, "identity">; rows: VersusRow[] };

export type ArchetypeCardData = { identity: Pick<Identity, "login" | "name">; archetype: Archetype | null; also: string[] };

export type AchievementCardData = { identity: Pick<Identity, "login" | "name">; achievement: Achievement };

export type WindowCardData = { title: string; subtitle: string; rows: WindowRow[] };

export type WrappedCardData = Wrapped;
