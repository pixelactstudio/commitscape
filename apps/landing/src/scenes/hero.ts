import { app } from "../env";

export const HERO_CARDS = [
  { src: app("/api/cards/u/gaearon/repositories"), alt: "gaearon’s top repositories", width: 600, height: 400, place: "top-0 right-0 w-[80%]", turn: 5, depth: 10, chip: "In your README", chipPlace: "-top-3 left-6" },
  { src: app("/api/cards/u/gaearon/calendar"), alt: "gaearon’s last year", width: 855, height: 236, place: "top-[43%] left-0 w-[90%]", turn: -3, depth: 18, chip: "On LinkedIn", chipPlace: "-top-3 right-8" },
  { src: app("/api/cards/u/gaearon/totals"), alt: "gaearon’s totals", width: 600, height: 236, place: "bottom-0 right-[4%] w-[72%]", turn: 1.5, depth: 26, chip: "In a post on X", chipPlace: "-bottom-3 left-8" },
];

export const TURNS = HERO_CARDS.map((c) => c.turn);
