import { YEAR } from "./data";

export const YEARS = Array.from({ length: 8 }, (_, i) => YEAR - 7 + i);

/** How far up the year counter is moved to show the year at an index. */
export const at = (i: number) => -(i * 100) / YEARS.length;
