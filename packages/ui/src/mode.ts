export const MODES = [
  ["system", "Follow the system"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;
export type Mode = (typeof MODES)[number][0];

export const MODE_COOKIE = "commitscape-theme";

export function modeOf(value: string | undefined | null): Mode {
  return MODES.some(([name]) => name === value) ? (value as Mode) : "system";
}
