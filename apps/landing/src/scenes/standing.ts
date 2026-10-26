import { STANDING_PEOPLE } from "./data";

export const ROW = 28;

export const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

/** Where each person sits, top first, in one view. */
export function slots(view: number) {
  const order = STANDING_PEOPLE.map((p, i) => ({ i, v: p.values[view] ?? 0 })).sort((a, b) => b.v - a.v);
  const out: number[] = [];
  order.forEach((o, slot) => (out[o.i] = slot));
  return out;
}

function widest(view: number) {
  return Math.max(...STANDING_PEOPLE.map((p) => p.values[view] ?? 0));
}

/** How wide a person's bar is in one view, as a share of the widest. */
export function share(value: number, view: number) {
  return Math.max(12, (value / widest(view)) * 100);
}

export const FIRST = slots(0);
