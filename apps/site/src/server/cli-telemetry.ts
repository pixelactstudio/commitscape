import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { Limit } from "./limits";

export const CLI_LIMIT: Limit = { action: "telemetry", max: 240, seconds: 3600 };

const short = z.string().trim().min(1).max(40);

const Run = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  command: z.enum(["share", "health", "surviving", "report"]),
  version: z.string().regex(/^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,24}$/),
  os: short,
  arch: short,
  outcome: z.enum(["ok", "error"]),
  seconds: z.number().min(0).max(86_400),
  ci: z.boolean(),
  terminal: z.boolean(),
  first: z.boolean(),
});

export type CliRun = z.infer<typeof Run>;

/** One run of the command as it reported itself, when it is one: an anonymous install id, the command, its version, the platform, how it ended and how long it took. Nothing else is accepted. */
export function cliRunOf(body: unknown): CliRun | null {
  const parsed = Run.safeParse(body);
  return parsed.success ? { ...parsed.data, seconds: Math.round(parsed.data.seconds * 10) / 10 } : null;
}
