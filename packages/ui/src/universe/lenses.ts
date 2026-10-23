export const LENSES = [
  { value: "holder", label: "Who holds it" },
  { value: "role", label: "Role" },
  { value: "stale", label: "Staleness" },
  { value: "language", label: "Language" },
] as const;

export type LensName = (typeof LENSES)[number]["value"];
