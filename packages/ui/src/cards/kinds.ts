import type { ComponentType } from "react";
import type { AchievementCardData, ArchetypeCardData, CardKind, HallOfFameData, ProfileCardData, StandingCardData, VersusCardData, WindowCardData, WrappedCardData } from "@commitscape/data";

export type { CardKind };
import { AchievementCard, ArchetypeCard, CalendarCard, WindowCard, WrappedCalendarCard, WrappedCard, HallOfFameCard, LanguagesCard, PreviewCard, RepositoriesCard, StandingCard, SurvivalCard, TotalsCard, VersusCard, type CardProps } from "./Cards";
import { calendarSize, hallOfFameSize, languagesSize, PREVIEW_SIZE, repositoriesSize, STANDING_SIZE, SURVIVAL_SIZE, TOTALS_SIZE, versusSize, ARCHETYPE_SIZE, ACHIEVEMENT_SIZE, windowSize, WRAPPED_SIZE, WRAPPED_CALENDAR_SIZE } from "./sizes";

type Size = { width: number; height: number };

export type CardSpec<T> = { kind: CardKind; title: string; about: string; subject: "person" | "standing" | "repository"; size: (data: T) => Size; Card: ComponentType<CardProps<T>> };

export const STANDING_CARD_SIZE = STANDING_SIZE;
export const ARCHETYPE_CARD_SIZE = ARCHETYPE_SIZE;
export const ACHIEVEMENT_CARD_SIZE = ACHIEVEMENT_SIZE;
export const WRAPPED_CARD_SIZE = WRAPPED_SIZE;
export const WRAPPED_CALENDAR_CARD_SIZE = WRAPPED_CALENDAR_SIZE;

const person = <T>(spec: CardSpec<T>) => spec;

/** Every Card, with what it is about and how big it is. */
export const CARDS = {
  totals: person<ProfileCardData>({ kind: "totals", title: "Totals", about: "Pull requests merged, reviews, lines still running and commits.", subject: "person", size: () => TOTALS_SIZE, Card: TotalsCard }),
  survival: person<ProfileCardData>({ kind: "survival", title: "Survival", about: "How many of the lines you wrote still run.", subject: "person", size: () => SURVIVAL_SIZE, Card: SurvivalCard }),
  repositories: person<ProfileCardData>({ kind: "repositories", title: "Top repositories", about: "Where your work is.", subject: "person", size: repositoriesSize, Card: RepositoriesCard }),
  calendar: person<ProfileCardData>({ kind: "calendar", title: "Calendar", about: "The last year, a square a day.", subject: "person", size: calendarSize, Card: CalendarCard }),
  languages: person<ProfileCardData>({ kind: "languages", title: "Languages over the years", about: "What you wrote in, year by year.", subject: "person", size: languagesSize, Card: LanguagesCard }),
  preview: person<ProfileCardData>({ kind: "preview", title: "Link preview", about: "What a link to your Profile shows when posted.", subject: "person", size: () => PREVIEW_SIZE, Card: PreviewCard }),
  standing: person<StandingCardData>({ kind: "standing", title: "You in a repository", about: "Your place among a repository's people.", subject: "standing", size: () => STANDING_SIZE, Card: StandingCard }),
  versus: person<VersusCardData>({ kind: "versus", title: "Versus", about: "Two people side by side, a winner for each view.", subject: "person", size: versusSize, Card: VersusCard }),
  archetype: person<ArchetypeCardData>({ kind: "archetype", title: "Archetype", about: "How you work, by a written rule.", subject: "person", size: () => ARCHETYPE_SIZE, Card: ArchetypeCard }),
  achievement: person<AchievementCardData>({ kind: "achievement", title: "Achievement", about: "A milestone you reached.", subject: "person", size: () => ACHIEVEMENT_SIZE, Card: AchievementCard }),
  race: person<WindowCardData>({ kind: "race", title: "Race", about: "A Race's people, view by view.", subject: "person", size: windowSize, Card: WindowCard }),
  season: person<WindowCardData>({ kind: "season", title: "Season recap", about: "A Crew's Season, view by view.", subject: "person", size: windowSize, Card: WindowCard }),
  wrapped: person<WrappedCardData>({ kind: "wrapped", title: "Wrapped", about: "Your year on GitHub, for posting.", subject: "person", size: () => WRAPPED_SIZE, Card: WrappedCard }),
  "wrapped-calendar": person<WrappedCardData>({ kind: "wrapped-calendar", title: "Wrapped calendar", about: "Your year, a square a day.", subject: "person", size: () => WRAPPED_CALENDAR_SIZE, Card: WrappedCalendarCard }),
  "hall-of-fame": person<HallOfFameData>({ kind: "hall-of-fame", title: "Hall of fame", about: "A repository's people, for its README.", subject: "repository", size: hallOfFameSize, Card: HallOfFameCard }),
};

export const PERSON_CARDS = ["totals", "survival", "repositories", "calendar", "languages", "preview"] as const;
