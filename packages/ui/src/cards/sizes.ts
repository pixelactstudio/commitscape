import type { HallOfFameData, ProfileCardData, VersusCardData, WindowCardData } from "@commitscape/data";

export const CELL = 12;
export const GAP = 3;

export const TOTALS_SIZE = { width: 600, height: 236 };

export function repositoriesSize(data: ProfileCardData) {
  return { width: 600, height: 150 + Math.min(5, data.repositories.length) * 50 };
}

export const SURVIVAL_SIZE = { width: 600, height: 236 };

export function calendarSize() {
  return { width: 30 * 2 + 53 * (CELL + GAP), height: 236 };
}

export function languagesSize(data: ProfileCardData) {
  const years = data.years.filter((y) => y.languages.length > 0).slice(-8);
  return { width: 600, height: 168 + years.length * 26 };
}

export const STANDING_SIZE = { width: 600, height: 268 };

export function hallOfFameSize(data: HallOfFameData) {
  return { width: 720, height: 150 + Math.min(10, data.people.length) * 40 };
}

export const PREVIEW_SIZE = { width: 1200, height: 630 };

export function versusSize(data: VersusCardData) {
  return { width: 640, height: 170 + data.rows.filter((r) => r.a !== null || r.b !== null).length * 34 };
}

export const ARCHETYPE_SIZE = { width: 600, height: 268 };

export const ACHIEVEMENT_SIZE = { width: 600, height: 236 };

export function windowSize(data: WindowCardData) {
  return { width: 720, height: 186 + Math.min(10, data.rows.length) * 40 };
}

export const WRAPPED_SIZE = { width: 1200, height: 630 };

export const WRAPPED_CALENDAR_SIZE = { width: 30 * 2 + 53 * (CELL + GAP), height: 236 };
