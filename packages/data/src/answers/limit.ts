import type { Params } from "../source";

const LISTS = new Set(["/api/people", "/api/overview"]);

const ASKED = ["window", "from", "to", "id", "path", "top"];

export const TOP_MAX = 1000;

/** How many of an answer's people a request asks for, or null for all of them. */
export function topOf(params: Params): number | null {
  const raw = params.top;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= TOP_MAX ? n : null;
}

/** A request's params without its `top`, as a Report holds the answer. */
export function withoutTop(params: Params): Params {
  const { top: _, ...rest } = params;
  return rest;
}

/** A request's params with only those an answer depends on, so one question has one key. */
export function askedOf(params: Params): Params {
  const out: Params = {};
  for (const k of ASKED) if (params[k] !== undefined && params[k] !== null && params[k] !== "") out[k] = params[k];
  return out;
}

/** An answer cut to its first `top` people, with `count` saying how many it listed; other answers, and every answer when `top` is null, as they are. */
export function limited(path: string, top: number | null, value: unknown): unknown {
  if (top === null || !LISTS.has(path) || value === null || typeof value !== "object") return value;
  const people = (value as { people?: unknown }).people;
  if (!Array.isArray(people)) return value;
  return { ...value, people: people.slice(0, top), count: people.length };
}
