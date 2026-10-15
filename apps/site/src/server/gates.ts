import "@tanstack/react-start/server-only";
import { GATES, type Gate, type Locked } from "#/lib/gates";
import { SiteError } from "./http";
import { isMember, type ProfileViewer } from "./profiles";

/** A gate's answer for this viewer: `{ locked }` when the part is kept for people signed in and they are not, else null. */
export async function lockedFor(gate: Gate, viewer: Pick<ProfileViewer, "token" | "member">): Promise<Locked | null> {
  if (!GATES[gate].on) return null;
  return (await isMember({ login: async () => null, ...viewer })) ? null : { locked: gate };
}

/** Runs `read`, answering `{ locked }` instead of failing when it was refused for want of a sign-in. */
export async function orLocked<T>(read: () => Promise<T>): Promise<T | Locked> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof SiteError && typeof e.detail.gate === "string" && e.detail.gate in GATES) return { locked: e.detail.gate as Gate };
    throw e;
  }
}
